import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { type Db, queryOne, queryRows } from "@/db/client";
import { memoryDb as isolatedDb, closeTestDb } from "@/db/testing";
import { afterEach } from "vitest";
const databases: Db[] = [];
async function memoryDb() { const db = await isolatedDb(); databases.push(db); return db; }
afterEach(async () => { for (const db of databases.splice(0))
    await closeTestDb(db); });
import { users } from "@/db/schema";
import { addDaysIso } from "@/i18n/jalali";
import { appendEvent } from "./store";
import { ledgerSnapshot, replayAll, xpSummary } from "./projections";
async function setup(): Promise<{
    db: Db;
    userId: string;
}> {
    const db = (await memoryDb());
    const now = new Date().toISOString();
    (await db.insert(users).values({ id: "u1", username: "u", name: "U", passwordHash: "x", createdAt: now, updatedAt: now }));
    return { db, userId: "u1" };
}
const day0 = "2026-11-21";
type Op = {
    k: "focus";
    d: number;
    m: number;
    surge: boolean;
} | {
    k: "test";
    d: number;
    c: number;
    w: number;
} | {
    k: "error";
    d: number;
} | {
    k: "close";
    d: number;
    pen: number;
} | {
    k: "undo";
    i: number;
} | {
    k: "dup";
    i: number;
};
const opArb: fc.Arbitrary<Op> = fc.oneof(fc.record({ k: fc.constant("focus" as const), d: fc.integer({ min: 0, max: 9 }), m: fc.integer({ min: 1, max: 200 }), surge: fc.boolean() }), fc.record({ k: fc.constant("test" as const), d: fc.integer({ min: 0, max: 9 }), c: fc.integer({ min: 0, max: 60 }), w: fc.integer({ min: 0, max: 30 }) }), fc.record({ k: fc.constant("error" as const), d: fc.integer({ min: 0, max: 9 }) }), fc.record({ k: fc.constant("close" as const), d: fc.integer({ min: 0, max: 9 }), pen: fc.integer({ min: -40, max: 0 }) }), fc.record({ k: fc.constant("undo" as const), i: fc.nat() }), fc.record({ k: fc.constant("dup" as const), i: fc.nat() }));
async function apply(db: Db, userId: string, ops: Op[]) {
    // Remember exactly what was sent, so a "dup" op can retry the SAME request (a different payload under a used
    // key is a conflict by design, see store.pg.test.ts).
    const sent: { id: string; day: string; args: Parameters<typeof appendEvent>[1] }[] = [];
    for (const [i, o] of ops.entries()) {
        const req = `r${i}`;
        if (o.k === "undo" || o.k === "dup") {
            const t = sent[o.i % Math.max(1, sent.length)];
            if (!t)
                continue;
            if (o.k === "undo")
                await appendEvent(db, { userId, type: "event.undone", payload: { targetId: t.id, targetDay: t.day } });
            else
                expect((await appendEvent(db, t.args)).duplicate).toBe(true);
            continue;
        }
        const day = addDaysIso(day0, o.d);
        // out-of-order occurredAt (manual / late entries) must not change the outcome
        const at = `${day}T${String(5 + (i % 17)).padStart(2, "0")}:00:00Z`;
        const args: Parameters<typeof appendEvent>[1] = o.k === "focus"
            ? { userId, type: "focus.stopped", payload: { minutes: o.m, surge: o.surge }, gameDay: day, occurredAt: at, clientRequestId: req }
            : o.k === "test"
                ? { userId, type: "test.logged", payload: { testLogId: `t${i}`, correct: o.c, wrong: o.w }, gameDay: day, occurredAt: at, clientRequestId: req }
                : o.k === "error"
                    ? { userId, type: "error.logged", payload: { analyzed: true }, gameDay: day, occurredAt: at, clientRequestId: req }
                    : { userId, type: "day.closed", payload: { penalties: [{ amount: o.pen, ruleKey: "ss.miss.core", reason: "x", capApplied: false }], gold: [{ amount: 10, reason: "std" }] }, gameDay: day, occurredAt: at, clientRequestId: req };
        const r = await appendEvent(db, args);
        sent.push({ id: r.id, day, args });
    }
}
describe("event store + projections (T-R1-05 / F-CORE-10)", () => {
    it("property: incremental projection == full replay", { timeout: 180000 }, async () => {
        (await fc.assert(fc.asyncProperty(fc.array(opArb, { maxLength: 25 }), async (ops) => {
            const { db, userId } = (await setup());
            (await apply(db, userId, ops));
            const incremental = (await ledgerSnapshot(db, userId));
            (await replayAll(db, userId));
            expect((await ledgerSnapshot(db, userId))).toEqual(incremental);
            // invariants: XP never negative, daily focus cap respected
            const caps = (await queryRows(db, sql.raw("SELECT game_day, sum(amount) s FROM xp_ledger WHERE rule_key LIKE 'xp.focus%' GROUP BY game_day"))) as {
                s: number;
            }[];
            expect(caps.every((c) => c.s <= 72 + 1e-9)).toBe(true);
            const neg = (await queryOne(db, sql.raw("SELECT count(*) n FROM xp_ledger WHERE amount < 0"))) as {
                n: number;
            };
            expect(neg.n).toBe(0);
        }), { numRuns: 20 }));
    });
    it("doc 04 §12 scenario 1: 30 min + 10 tests (7/2/1) + 2 analyses = 12.4 XP", async () => {
        const { db, userId } = (await setup());
        const gameDay = "2026-11-22";
        (await appendEvent(db, { userId, type: "focus.stopped", payload: { minutes: 30 }, gameDay }));
        (await appendEvent(db, { userId, type: "test.logged", payload: { testLogId: "a", correct: 7, wrong: 2, blank: 1 }, gameDay }));
        (await appendEvent(db, { userId, type: "error.logged", payload: {}, gameDay }));
        (await appendEvent(db, { userId, type: "error.logged", payload: {}, gameDay }));
        expect((await xpSummary(db, userId, gameDay)).todayXp).toBe(12.4);
    });
    it("idempotent on client_request_id; undo and deleted tests drop XP; import gives none", async () => {
        const { db, userId } = (await setup());
        const gameDay = "2026-11-22";
        const a = (await appendEvent(db, { userId, type: "test.logged", payload: { testLogId: "x", correct: 10, wrong: 0 }, gameDay, clientRequestId: "same" }));
        const b = (await appendEvent(db, { userId, type: "test.logged", payload: { testLogId: "x", correct: 10, wrong: 0 }, gameDay, clientRequestId: "same" }));
        expect(b).toEqual({ id: a.id, duplicate: true });
        expect((await xpSummary(db, userId, gameDay)).todayXp).toBe(6);
        (await appendEvent(db, { userId, type: "test.deleted", payload: { testLogId: "x" }, gameDay }));
        expect((await xpSummary(db, userId, gameDay)).todayXp).toBe(0);
        const f = (await appendEvent(db, { userId, type: "focus.stopped", payload: { minutes: 50 }, gameDay }));
        expect((await xpSummary(db, userId, gameDay)).todayXp).toBe(10);
        (await appendEvent(db, { userId, type: "event.undone", payload: { targetId: f.id, targetDay: gameDay } }));
        expect((await xpSummary(db, userId, gameDay)).todayXp).toBe(0);
        (await appendEvent(db, { userId, type: "focus.stopped", payload: { minutes: 50 }, gameDay, source: "import" }));
        expect((await xpSummary(db, userId, gameDay)).todayXp).toBe(0);
    });
    it("weekly study share: pillar XP above 30% becomes gold; SS = study XP + penalties", async () => {
        const { db, userId } = (await setup());
        const gameDay = "2026-11-22";
        (await appendEvent(db, { userId, type: "focus.stopped", payload: { minutes: 35 }, gameDay })); // 7 study XP
        for (let i = 0; i < 3; i++)
            (await appendEvent(db, { userId, type: "habit.logged", payload: { habitId: `h${i}`, tier: "standard", xp: 10, pillar: "body" }, gameDay }));
        const s = (await xpSummary(db, userId, gameDay));
        expect(s.rawXp).toBe(37);
        expect(s.levelXp).toBe(10); // 7 + 3 (= 30 %)
        expect(s.gold).toBe(27);
        (await appendEvent(db, { userId, type: "day.closed", payload: { penalties: [{ amount: -20, ruleKey: "ss.miss.core", reason: "x", capApplied: false }], gold: [] }, gameDay }));
        expect((await xpSummary(db, userId, gameDay)).weekSs).toBe(-13);
    });
});
