import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/testing";
import { appendEvent } from "@/events/store";
import { claimReward, ClaimDenied, shopView } from "./shop";
import { replaySync } from "./sync";

const today = "2026-11-21";
let test: TestDb;

beforeEach(async () => { test = await createTestDb({ label: "domain" }); });
afterEach(async () => { if (test) await test.close(); });

async function player(id: string) {
  await test.query(`INSERT INTO users (id, username, name, password_hash, created_at, updated_at) VALUES ($1, $1, $1, 'test-only', now(), now())`, [id]);
  await test.query(`INSERT INTO rewards (id, user_id, title, gold_cost, money_cost, enabled, created_at) VALUES ($1, $2, 'A break', 80, 0, true, now())`, [`reward-${id}`, id]);
  await appendEvent(test.db, { userId: id, type: "board.claimed", payload: { gold: 100 }, gameDay: today });
}

describe("PostgreSQL domain transactions", () => {
  it("serializes reward claims before reading the gold balance", async () => {
    await player("race");
    const results = await Promise.allSettled([
      claimReward(test.db, "race", "reward-race", today),
      claimReward(test.db, "race", "reward-race", today),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason instanceof ClaimDenied).toBe(true);
    const view = await shopView(test.db, "race", today);
    expect(view.gold).toBe(20);
    expect(view.claims).toHaveLength(1);
  });

  it("rolls back the reward claim and event when the gold projection fails", async () => {
    await player("rollback");
    await test.query(`CREATE FUNCTION reject_reward_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = 'rollback' AND NEW.amount < 0 THEN RAISE EXCEPTION 'projection rejected'; END IF; RETURN NEW; END $$`);
    await test.query(`CREATE TRIGGER reject_reward_projection BEFORE INSERT ON gold_ledger FOR EACH ROW EXECUTE FUNCTION reject_reward_projection()`);
    try {
      await expect(claimReward(test.db, "rollback", "reward-rollback", today)).rejects.toThrow();
      const view = await shopView(test.db, "rollback", today);
      expect(view.gold).toBe(100);
      expect(view.claims).toHaveLength(0);
      const events = await test.query(`SELECT id FROM events WHERE user_id = 'rollback' AND type = 'reward.claimed'`);
      expect(events.rows).toHaveLength(0);
    } finally {
      await test.query(`DROP TRIGGER reject_reward_projection ON gold_ledger`);
      await test.query(`DROP FUNCTION reject_reward_projection()`);
    }
    await claimReward(test.db, "rollback", "reward-rollback", today);
    expect((await shopView(test.db, "rollback", today)).gold).toBe(20);
  });

  it("acknowledges a retried wellness replay without rewriting the check-in", async () => {
    await player("sync");
    const input = { items: [{ id: "wellness-retry", kind: "wellness" as const, body: { mood: 4, energy: 3 }, createdAt: `${today}T12:00:00Z` }] };
    const first = await replaySync(test.db, "sync", input, { today });
    const retry = await replaySync(test.db, "sync", input, { today });
    expect(first.applied).toBe(1);
    expect(retry.duplicates).toBe(1);
    expect(retry.conflicts).toBe(0);
    const logged = await test.query(`SELECT id FROM events WHERE user_id = 'sync' AND type = 'wellness.logged'`);
    expect(logged.rows).toHaveLength(1);
  });
});
