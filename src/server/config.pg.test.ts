import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/testing";
import { dailyCheckins } from "@/db/schema";
import { createUser } from "./auth";
import { ensureDefaultConfig, currentConfig, getConfigVersion, importConfig, listConfigVersions, rollbackConfig, updateConfig } from "./config";
import { CheckinLocked, getCheckin, saveCheckin } from "./checkins";
import { getKv, setKv } from "./kv";
import { logTest } from "./tests";
import { listEvents } from "@/events/store";
import { xpSummary } from "@/events/projections";

let fixture: TestDb;
let userId: string;
beforeEach(async () => {
  fixture = await createTestDb({ label: "config" });
  userId = await createUser(fixture.db, { username: "config", name: "Config", password: "local test password" });
});
afterEach(async () => { await fixture?.close(); });

describe("PostgreSQL config, check-ins and settings", () => {
  it("serializes config versions without dropping independent patches", async () => {
    const db = fixture.db;
    await Promise.all([ensureDefaultConfig(db, userId), ensureDefaultConfig(db, userId)]);
    await Promise.all([updateConfig(db, userId, { xp: { testCorrect: 0.7 } }, "raise test XP"), updateConfig(db, userId, { gold: { weeklyBossDefeated: 30 } }, "raise boss gold")]);
    expect((await listConfigVersions(db, userId)).map((v) => v.version)).toEqual([1, 2, 3]);
    expect((await currentConfig(db, userId)).xp.testCorrect).toBe(0.7);
    expect((await currentConfig(db, userId)).gold.weeklyBossDefeated).toBe(30);
    expect((await rollbackConfig(db, userId, 1, "restore defaults")).version).toBe(4);
    expect((await importConfig(db, userId, { xp: { testCorrect: 0.8 } }, "import tuning")).version).toBe(5);
    expect((await getConfigVersion(db, userId, 1))?.config.xp.testCorrect).toBe(0.6);
  });

  it("rolls back config and its event if replay fails", async () => {
    const db = fixture.db;
    await ensureDefaultConfig(db, userId);
    await logTest(db, userId, { correct: 10, wrong: 0 }, { now: new Date("2026-11-14T10:00:00Z") });
    await db.execute(sql`ALTER TABLE xp_ledger ADD CONSTRAINT reject_replay CHECK (amount < 0) NOT VALID`);
    await expect(updateConfig(db, userId, { xp: { testCorrect: 0.7 } }, "raise XP")).rejects.toThrow();
    expect(await listConfigVersions(db, userId)).toHaveLength(1);
    expect(await listEvents(db, userId, "config.changed")).toEqual([]);
    expect((await xpSummary(db, userId, "2026-11-14")).todayXp).toBe(6);
  });

  it("upserts a single check-in under races and enforces Tehran edit deadline", async () => {
    const db = fixture.db;
    const now = new Date("2026-11-16T00:29:59Z");
    await Promise.all(Array.from({ length: 5 }, (_, i) => saveCheckin(db, userId, { date: "2026-11-14", energyNight: i + 1, classAttended: true }, { now })));
    expect(await db.select().from(dailyCheckins)).toHaveLength(1);
    expect((await getCheckin(db, userId, "2026-11-14"))?.classAttended).toBe(true);
    await expect(saveCheckin(db, userId, { date: "2026-11-14" }, { now: new Date("2026-11-16T00:30:00Z") })).rejects.toThrow(CheckinLocked);
  });

  it("persists JSON settings and returns the supplied fallback", async () => {
    const db = fixture.db;
    expect(await getKv(db, userId, "goal", 10)).toBe(10);
    await setKv(db, userId, "goal", { minutes: 40, enabled: true });
    expect(await getKv(db, userId, "goal", null)).toEqual({ minutes: 40, enabled: true });
    await setKv(db, userId, "goal", 20);
    expect(await getKv(db, userId, "goal", 10)).toBe(20);
  });
});
