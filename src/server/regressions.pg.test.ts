import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/testing";
import { queryOne, queryRows } from "@/db/client";
import { contractSettlements, events, focusSessions, testLogs, users } from "@/db/schema";
import { createUser } from "./auth";
import { ensureDefaultConfig } from "./config";
import { listHabits, logHabit, seedDefaultHabits } from "./habits";
import { setKv } from "./kv";
import { closeDay } from "./quests";
import { importSubjects, loadSubjectsFile } from "./seed";
import { replaySync } from "./sync";
import { logTest } from "./tests";
import { UndoDenied, undoEvent, undoable } from "./undo";
import { startFocus, stopFocus } from "./focus";
import { localToUtc } from "@/lib/time";

/** Regression tests for defects found while converting the application from SQLite to PostgreSQL. */

let fixture: TestDb;
beforeEach(async () => { fixture = await createTestDb({ label: "regress" }); });
afterEach(async () => { await fixture?.close(); });

describe("PostgreSQL driver contract", () => {
  it("returns count()/sum() of integers as numbers, never strings", async () => {
    const row = await queryOne<{ n: number; s: number; avg: number }>(fixture.db, sql`SELECT count(*) AS n, sum(x)::bigint AS s, avg(x) AS avg FROM (VALUES (1), (2), (4)) t(x)`);
    expect(row).toEqual({ n: 3, s: 7, avg: 7 / 3 });
    expect(typeof row?.n).toBe("number");
    // The original symptom: "3" + 1 === "31".
    expect((row?.n ?? 0) + 1).toBe(4);
  });
});

describe("habit contracts (an async filter used to penalise habits that WERE logged)", () => {
  it("settles only the contract habits that have no log for the day", async () => {
    const db = fixture.db;
    const now = new Date().toISOString();
    await db.insert(users).values({ id: "u1", username: "u", name: "U", passwordHash: "x", createdAt: now, updatedAt: now });
    await importSubjects(db, loadSubjectsFile());
    await ensureDefaultConfig(db, "u1");
    await setKv(db, "u1", "baseline.confirmed", { on: "2026-11-14" });
    await seedDefaultHabits(db, "u1", "2026-11-14");
    const pair = (await listHabits(db, "u1")).slice(0, 2);
    expect(pair).toHaveLength(2);
    const [done, missed] = pair as [typeof pair[number], typeof pair[number]];
    await db.execute(sql`UPDATE habits SET status = 'active', contract_ss = -4, days_per_week = 7, started_on = '2026-11-14' WHERE id IN (${done.id}, ${missed.id})`);
    const day = "2026-12-05";
    await logHabit(db, "u1", done.id, day, "standard");
    await closeDay(db, "u1", day, { now: localToUtc("2026-12-06", "10:00") });
    const settled = await db.select().from(contractSettlements).where(eq(contractSettlements.userId, "u1"));
    expect(settled.map((s) => s.habitId)).toEqual([missed.id]);
  });
});

describe("offline replay", () => {
  it("applies one item exactly once when the same replay arrives concurrently", async () => {
    const db = fixture.db;
    const userId = await createUser(db, { username: "sync", name: "Sync", password: "local test password" });
    await ensureDefaultConfig(db, userId);
    const input = { items: [{ id: "req-1", kind: "test" as const, body: { correct: 7, wrong: 2, blank: 1 }, createdAt: "2026-11-14T08:00:00Z" }] };
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => replaySync(db, userId, input, { today: "2026-11-14" })));
    expect([a!, b!, c!].reduce((n, r) => n + r.applied, 0)).toBe(1);
    expect([a!, b!, c!].reduce((n, r) => n + r.duplicates, 0)).toBe(2);
    expect(await db.select().from(testLogs)).toHaveLength(1);
    expect(await queryRows(db, sql`SELECT id FROM events WHERE type = 'test.logged'`)).toHaveLength(1);
  });

  it("keeps a failing item from poisoning the rest of the batch", async () => {
    const db = fixture.db;
    const userId = await createUser(db, { username: "sync", name: "Sync", password: "local test password" });
    await ensureDefaultConfig(db, userId);
    const r = await replaySync(db, userId, {
      items: [
        { id: "bad", kind: "test", body: { correct: -5, wrong: 0 }, createdAt: "2026-11-14T08:00:00Z" },
        { id: "good", kind: "test", body: { correct: 5, wrong: 1 }, createdAt: "2026-11-14T08:01:00Z" },
      ],
    }, { today: "2026-11-14" });
    expect(r.results.map((x) => x.status)).toEqual(["invalid", "applied"]);
    expect(await db.select().from(testLogs)).toHaveLength(1);
  });
});

describe("undo", () => {
  it("cannot reverse the same action twice, even when requested concurrently", async () => {
    const db = fixture.db;
    const userId = await createUser(db, { username: "undo", name: "Undo", password: "local test password" });
    await ensureDefaultConfig(db, userId);
    const now = new Date();
    await logTest(db, userId, { correct: 5, wrong: 0 }, { now });
    const target = (await undoable(db, userId, now))[0]!;
    const results = await Promise.allSettled([undoEvent(db, userId, target.id, now), undoEvent(db, userId, target.id, now), undoEvent(db, userId, target.id, now)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof UndoDenied)).toBe(true);
    expect(await queryRows(db, sql`SELECT id FROM events WHERE type = 'event.undone'`)).toHaveLength(1);
    expect(await db.select().from(testLogs)).toEqual([]);
  });
});

describe("re-entrant user transactions", () => {
  it("keeps partial rollback semantics when a nested operation fails", async () => {
    const db = fixture.db;
    const userId = await createUser(db, { username: "nest", name: "Nest", password: "local test password" });
    await ensureDefaultConfig(db, userId);
    const day = "2026-11-14";
    const start = localToUtc(day, "10:00");
    await startFocus(db, userId, { kind: "video" }, { now: start });
    // Manual entries replayed while a live session is running: every item must apply in its own savepoint.
    const r = await replaySync(db, userId, {
      items: [
        { id: "m1", kind: "focus", body: { day, start: "12:00", minutes: 20 }, createdAt: "2026-11-14T13:00:00Z" },
        { id: "m2", kind: "focus", body: { day, start: "13:00", minutes: 20 }, createdAt: "2026-11-14T14:00:00Z" },
      ],
    }, { today: day });
    expect(r.applied).toBe(2);
    await stopFocus(db, userId, new Date(start.getTime() + 25 * 60_000));
    expect(await db.select().from(focusSessions)).toHaveLength(3);
    expect((await db.select().from(events)).length).toBeGreaterThan(3);
  });
});
