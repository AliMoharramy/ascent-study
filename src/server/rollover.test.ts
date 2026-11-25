import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { type Db, queryOne, queryRows } from "@/db/client";
import { memoryDb as isolatedDb, closeTestDb } from "@/db/testing";
import { afterEach } from "vitest";
const databases: Db[] = [];
async function memoryDb() { const db = await isolatedDb(); databases.push(db); return db; }
afterEach(async () => { for (const db of databases.splice(0))
    await closeTestDb(db); });
import { dayCloses, quests, users } from "@/db/schema";
import { addDaysIso, diffDaysIso } from "@/i18n/jalali";
import { PROJECT_START } from "@/lib/campaign";
import { localToUtc } from "@/lib/time";
import { setKv } from "./kv";
import { importSubjects, loadSubjectsFile } from "./seed";
import { startFocus, stopFocus } from "./focus";
import { FOCUS_BLOCK_MINUTES } from "@/domain/timer";
import { logTest } from "./tests";
import { closeDay, declareLifeEvent, generateDay, questsForDay, refreshProgress, rollover, useShield } from "./quests";
import { ensureDefaultConfig } from "./config";
import { listHabits, logHabit } from "./habits";
async function setup(): Promise<{
    db: Db;
    userId: string;
}> {
    const db = (await memoryDb());
    const now = new Date().toISOString();
    (await db.insert(users).values({ id: "u1", username: "u", name: "U", passwordHash: "x", createdAt: now, updatedAt: now }));
    (await importSubjects(db, loadSubjectsFile()));
    (await ensureDefaultConfig(db, "u1"));
    return { db, userId: "u1" };
}
async function study(db: Db, userId: string, day: string, minutes: number, chapterId: string | null, subjectId: string | null = null) {
    const start = localToUtc(day, "10:00");
    let elapsedMinutes = 0;
    while (elapsedMinutes < minutes) {
        const blockMinutes = Math.min(FOCUS_BLOCK_MINUTES, minutes - elapsedMinutes);
        const blockStart = new Date(start.getTime() + elapsedMinutes * 60000);
        (await startFocus(db, userId, { kind: "video", chapterId, subjectId }, { now: blockStart }));
        (await stopFocus(db, userId, new Date(blockStart.getTime() + blockMinutes * 60000)));
        elapsedMinutes += blockMinutes;
    }
}
describe("rollover + quests (T-R1-09)", () => {
    // 175 simulated days of real round-trips to PostgreSQL: slow by design (~1–2 min), not a performance problem.
    it("simulates 25 weeks without errors; ≤ 5 active quests; floors hold; core comes from the planner", { timeout: 300_000 }, async () => {
        const { db, userId } = (await setup());
        (await setKv(db, userId, "baseline.confirmed", { on: "2026-11-20" }));
        let seed = 7;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
        let day = "2026-11-14";
        for (let i = 0; i < 175; i++) {
            (await rollover(db, userId, day, localToUtc(day, "04:30")));
            const qs = (await questsForDay(db, userId, day));
            expect(qs.filter((q) => q.status === "open").length).toBeLessThanOrEqual(5);
            const core = qs.find((q) => q.kind === "core")!;
            const r = rnd();
            if (r > 0.25)
                (await study(db, userId, day, Math.round(20 + rnd() * 150), core.refId));
            if (r > 0.5)
                (await logTest(db, userId, { subjectId: "foundations", correct: 7, wrong: 2, blank: 1 }, { day, now: localToUtc(day, "12:00") }));
            if (r > 0.7)
                (await logHabit(db, userId, (await listHabits(db, userId)).find((h) => h.pillar === "body")!.id, day, "standard"));
            (await refreshProgress(db, userId, day));
            day = addDaysIso(day, 1);
        }
        (await rollover(db, userId, day));
        const closes = (await db.select().from(dayCloses).where(eq(dayCloses.userId, userId)));
        // 175 simulated days from 14 Nov; days before PROJECT_START (the real study start) are never closed.
        expect(closes.length).toBeGreaterThanOrEqual(175 - diffDaysIso(PROJECT_START, "2026-11-14"));
        const weeks = (await queryRows(db, sql.raw("SELECT week_id, sum(amount) s FROM score_ledger WHERE user_id = 'u1' AND rule_key LIKE 'ss.miss.%' GROUP BY week_id"))) as {
            s: number;
        }[];
        expect(weeks.every((w) => w.s >= -120)).toBe(true);
        const days = (await queryRows(db, sql.raw("SELECT game_day, sum(amount) s FROM score_ledger WHERE user_id = 'u1' AND rule_key LIKE 'ss.miss.%' GROUP BY game_day"))) as {
            s: number;
        }[];
        expect(days.every((d) => d.s >= -40)).toBe(true);
        const plannedCores = (await db.select().from(quests).where(and(eq(quests.userId, userId), eq(quests.kind, "core"), eq(quests.refType, "chapter"))));
        expect(plannedCores.length).toBeGreaterThan(50);
        // baseline week never penalised
        const wk1 = (await queryOne<{
            v: number | null;
        }>(db, sql `SELECT sum(amount) AS v FROM score_ledger WHERE user_id = 'u1' AND game_day < '2026-11-21' AND amount < 0`));
        expect(wk1?.v ?? 0).toBe(0);
    });
    it("miss → comeback quest next day; seed is not a miss; shield forgives within 24h; life event", async () => {
        const { db, userId } = (await setup());
        (await setKv(db, userId, "baseline.confirmed", { on: "2026-11-20" }));
        const d1 = "2026-11-23";
        (await generateDay(db, userId, d1));
        const c1 = (await closeDay(db, userId, d1));
        expect(c1.missedCore).toBe(true);
        expect(c1.penaltyTotal).toBeLessThan(0);
        const d2 = addDaysIso(d1, 1);
        expect((await generateDay(db, userId, d2)).some((q) => q.kind === "comeback")).toBe(true);
        (await study(db, userId, d2, 6, null));
        const core2 = (await questsForDay(db, userId, d2)).find((q) => q.kind === "core")!;
        (await refreshProgress(db, userId, d2));
        expect((await questsForDay(db, userId, d2)).find((q) => q.id === core2.id)!.tierDone).toBe("seed");
        // shield: give one, use on d2 shortly after it ends
        (await queryRows(db, sql.raw("INSERT INTO shields (id, user_id, earned_on, created_at) VALUES ('s1','u1','2026-11-22','2026-11-22T10:00:00Z')")));
        (await closeDay(db, userId, d2));
        (await useShield(db, userId, d2, localToUtc(addDaysIso(d2, 1), "10:00")));
        const c2 = (await db.select().from(dayCloses).where(and(eq(dayCloses.userId, userId), eq(dayCloses.date, d2))).limit(1))[0]!;
        expect(c2.shieldUsed).toBe(true);
        expect(c2.penaltyTotal).toBe(0);
        const ss = (await queryOne<{
            v: number | null;
        }>(db, sql `SELECT sum(amount) AS v FROM score_ledger WHERE user_id = 'u1' AND game_day = ${d2} AND rule_key LIKE 'ss.miss.%'`));
        expect(ss?.v ?? 0).toBe(0);
        const d3 = addDaysIso(d2, 1);
        (await generateDay(db, userId, d3));
        (await declareLifeEvent(db, userId, d3, "sick today"));
        expect((await closeDay(db, userId, d3)).penaltyTotal).toBe(0);
        (await expect(declareLifeEvent(db, userId, addDaysIso(d3, 1), "trip")).resolves.not.toBeInstanceOf(Error));
        (await expect(declareLifeEvent(db, userId, addDaysIso(d3, 2), "more")).rejects.toThrow());
    });
});
