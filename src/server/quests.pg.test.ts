import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/testing";
import { quests } from "@/db/schema";
import { listEvents } from "@/events/store";
import { createUser } from "./auth";
import { QuestActionDenied, setQuestTier } from "./quests";

let fixture: TestDb;
let userId: string;
const now = new Date("2026-11-14T00:29:00Z").toISOString();

beforeEach(async () => {
  fixture = await createTestDb({ label: "quest-actions" });
  userId = await createUser(fixture.db, { username: "quest-actions", name: "Quest Actions", password: "local test password" });
});
afterEach(async () => { await fixture?.close(); });

describe("manual quest actions", () => {
  it("allows manual completion only for habits and check-type quests", async () => {
    const insertQuest = async (id: string, metric: "minutes" | "check") => {
      await fixture.db.insert(quests).values({
        id,
        userId,
        date: "2026-11-13",
        kind: "core",
        title: id,
        tiersJson: JSON.stringify({ seed: "Seed", standard: "Standard", stretch: "Stretch" }),
        targetJson: JSON.stringify({ metric, seed: 1, standard: 2, stretch: 3 }),
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
    };

    await insertQuest("tracked-minutes", "minutes");
    await expect(setQuestTier(fixture.db, userId, "tracked-minutes", "standard")).rejects.toBeInstanceOf(QuestActionDenied);
    expect(await fixture.db.select().from(quests)).toMatchObject([{ id: "tracked-minutes", tierDone: null }]);

    await insertQuest("manual-check", "check");
    const input = { questId: "manual-check", tier: "standard" as const };
    await setQuestTier(fixture.db, userId, input.questId, input.tier, "manual-check-done");
    await setQuestTier(fixture.db, userId, input.questId, input.tier, "manual-check-done");
    const tiers = new Map((await fixture.db.select({ id: quests.id, tierDone: quests.tierDone }).from(quests)).map((row) => [row.id, row.tierDone]));
    expect(tiers).toEqual(new Map([["manual-check", "standard"], ["tracked-minutes", null]]));
    expect(await listEvents(fixture.db, userId, "quest.progress")).toMatchObject([
      { clientRequestId: "manual-check-done", payload: { request: input } },
    ]);
  });
});
