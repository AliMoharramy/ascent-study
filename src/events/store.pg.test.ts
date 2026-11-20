import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/testing";
import { withUserTransaction } from "@/db/client";
import { events, testLogs, xpLedger } from "@/db/schema";
import { createUser } from "@/server/auth";
import { logTest, deleteTestLog, testsForDay } from "@/server/tests";
import { undoEvent } from "@/server/undo";
import { appendEvent, dayFor, listEvents } from "./store";
import { ledgerSnapshot, replayAll, xpSummary } from "./projections";

let fixture: TestDb;
let userId: string;
const now = new Date("2026-11-14T08:00:00Z");
beforeEach(async () => {
  fixture = await createTestDb({ label: "core" });
  userId = await createUser(fixture.db, { username: "core", name: "Core", password: "local test password" });
});
afterEach(async () => { await fixture?.close(); });

describe("PostgreSQL event transaction core", () => {
  it("serializes same-day writes and duplicate study requests without losing XP", async () => {
    const db = fixture.db;
    const logs = await Promise.all(Array.from({ length: 12 }, (_, i) => logTest(db, userId, { correct: 10, wrong: 0, clientRequestId: `study-${i % 6}` }, { now })));
    expect(new Set(logs.map((r) => r.id)).size).toBe(6);
    expect((await testsForDay(db, userId, "2026-11-14")).count).toBe(60);
    expect(await listEvents(db, userId, "test.logged")).toHaveLength(6);
    expect((await xpSummary(db, userId, "2026-11-14")).todayXp).toBe(36);
    const snapshot = await ledgerSnapshot(db, userId);
    await replayAll(db, userId);
    expect(await ledgerSnapshot(db, userId)).toEqual(snapshot);
    await expect(logTest(db, userId, { correct: 11, wrong: 0, clientRequestId: "study-0" }, { now })).rejects.toThrow(/request/i);
    expect(await db.select().from(testLogs)).toHaveLength(6);
  });

  it("rolls back the domain row, event and ledger when projection insertion fails", async () => {
    const db = fixture.db;
    await db.execute(sql`ALTER TABLE xp_ledger ADD CONSTRAINT reject_projection CHECK (amount < 0)`);
    await expect(logTest(db, userId, { correct: 10, wrong: 0 }, { now })).rejects.toThrow();
    expect(await db.select().from(testLogs)).toEqual([]);
    expect(await db.select().from(events)).toEqual([]);
    expect(await db.select().from(xpLedger)).toEqual([]);
    await expect(appendEvent(db, { userId, type: "focus.manual", payload: { minutes: 10 }, occurredAt: now.toISOString() })).rejects.toThrow();
    expect(await listEvents(db, userId)).toEqual([]);
  });

  it("scopes request keys and test reads/deletes to their user", async () => {
    const db = fixture.db;
    // Only this disposable schema permits multiple users to exercise tenant boundaries.
    await db.execute(sql`DROP INDEX uq_users_singleton`);
    const other = await createUser(db, { username: "other", name: "Other", password: "local test password" });
    const a = await logTest(db, userId, { correct: 10, wrong: 0, clientRequestId: "shared" }, { now });
    const b = await logTest(db, other, { correct: 2, wrong: 0, clientRequestId: "shared" }, { now });
    expect(a.id).not.toBe(b.id);
    expect((await testsForDay(db, other, "2026-11-14")).count).toBe(2);
    expect(await deleteTestLog(db, other, a.id)).toBe(false);
    await expect(appendEvent(db, { userId, type: "focus.started", payload: {}, clientRequestId: "shared" })).rejects.toThrow(/request/i);
    expect(await db.select().from(testLogs)).toHaveLength(2);
  });

  it("compares JSON payloads independently of key order and rejects changed content", async () => {
    const db = fixture.db;
    const first = await appendEvent(db, { userId, type: "idea.parked", payload: { a: 1, b: { c: 2 } }, clientRequestId: "json" });
    expect(await appendEvent(db, { userId, type: "idea.parked", payload: { b: { c: 2 }, a: 1 }, clientRequestId: "json" })).toEqual({ id: first.id, duplicate: true });
    await expect(appendEvent(db, { userId, type: "idea.parked", payload: { a: 2, b: { c: 2 } }, clientRequestId: "json" })).rejects.toThrow(/request/i);
  });

  it("reprojects the old target day on deletion and undo", async () => {
    const db = fixture.db;
    const first = await logTest(db, userId, { correct: 10, wrong: 0 }, { now });
    const second = await logTest(db, userId, { correct: 5, wrong: 0 }, { now });
    expect(await deleteTestLog(db, userId, first.id)).toBe(true);
    expect((await xpSummary(db, userId, "2026-11-14")).todayXp).toBe(3);
    const event = (await listEvents(db, userId, "test.logged")).find((e) => e.payload.testLogId === second.id)!;
    await undoEvent(db, userId, event.id);
    expect((await xpSummary(db, userId, "2026-11-14")).todayXp).toBe(0);
    expect(await db.select().from(testLogs)).toEqual([]);
    await expect(undoEvent(db, userId, event.id)).rejects.toThrow();
  });

  it("takes the replay snapshot after acquiring the shared user lock", async () => {
    const db = fixture.db;
    let replay!: ReturnType<typeof replayAll>;
    await withUserTransaction(db, userId, async (tx) => {
      replay = replayAll(db, userId);
      await logTest(tx, userId, { correct: 10, wrong: 0 }, { now });
    });
    await replay;
    expect((await xpSummary(db, userId, "2026-11-14")).todayXp).toBe(6);
    expect(await db.select().from(xpLedger)).toHaveLength(1);
  });

  it("uses canonical ISO timestamps and Saturday weeks at Tehran rollover", async () => {
    const db = fixture.db;
    expect(await dayFor(db, userId, "2026-11-14T00:29:59Z")).toBe("2026-11-13");
    expect(await dayFor(db, userId, "2026-11-14T00:30:00Z")).toBe("2026-11-14");
    await appendEvent(db, { userId, type: "focus.manual", payload: { minutes: 10 }, occurredAt: "2026-11-14T04:00:00+03:30" });
    const rows = await db.select().from(xpLedger).where(eq(xpLedger.userId, userId));
    expect(rows[0]).toMatchObject({ gameDay: "2026-11-14", weekId: "2026-11-14", occurredAt: "2026-11-14T00:30:00.000Z", capApplied: false });
    // 10 manual focus minutes at the default 0.2 XP/min.
    expect((await xpSummary(db, userId, "2026-11-14")).weekSs).toBe(2);
  });
});
