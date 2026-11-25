import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { type Db, queryOne, queryRows } from "@/db/client";
import { memoryDb as isolatedDb, closeTestDb } from "@/db/testing";
import { afterEach } from "vitest";
const databases: Db[] = [];
async function memoryDb() { const db = await isolatedDb(); databases.push(db); return db; }
afterEach(async () => { for (const db of databases.splice(0))
    await closeTestDb(db); });
import { errorItems, reviewCards, testLogs, users } from "@/db/schema";
import { replayAll, xpSummary } from "@/events/projections";
import { localToUtc } from "@/lib/time";
import { ensureDefaultConfig, updateConfig, currentConfig } from "./config";
import { importSubjects, loadSubjectsFile } from "./seed";
import { answerReview, dueCards, listErrors, logError, saveArtifact, updateChapterState } from "./forge";
import { logTest } from "./tests";
import { manualFocus, startFocus, stopFocus } from "./focus";
import { undoable, undoEvent } from "./undo";
import { logDetour, parkIdea, listIdeas, detourLedger } from "./ideas";
import { ensureWeekBosses, logBossResult, listMocks, logMock, rivalView, settleDuels } from "./arena";
import { claimReward, ClaimDenied, shopView, achievementsView, anomalyLog } from "./shop";
import { listDecisions, readDoc, recordDecision, searchDocs } from "./codex";
import { setKv } from "./kv";
import { baselineReport, confirmBaseline, goalView, saveNightly, getNightly, setGoal, saveCouncil, councilData } from "./reviews";
import { generatePlan, overrideTier, planView, resetWeek, ResetWeekDenied, triage } from "./plan";
import { logSleep, programView } from "./rest";
import { listHabits, saveHabit, HabitLimit } from "./habits";
import { generateDay, refreshProgress } from "./quests";
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
describe("R1/R2 services", () => {
    it("error analysis: 6 causes, XP 1.0 (cap 40), each error makes a review card; SM-2 answers give XP", async () => {
        const { db, userId } = (await setup());
        const day = "2026-11-24";
        (await expect(logError(db, userId, { cause: "concept", takeaway: "" }, day)).rejects.toThrow());
        for (const cause of ["concept", "calc", "time", "unread", "forgot", "careless"] as const)
            (await logError(db, userId, { cause, chapterId: "ai-3", takeaway: `lesson ${cause}` }, day));
        expect((await listErrors(db, userId)).length).toBe(6);
        expect((await listErrors(db, userId, { cause: "calc" })).length).toBe(1);
        expect((await listErrors(db, userId, { q: "forgot" })).length).toBe(1);
        expect((await db.select().from(reviewCards)).length).toBe(6);
        expect((await xpSummary(db, userId, day)).todayXp).toBe(6);
        const due = (await dueCards(db, userId, "2026-11-25"));
        expect(due.length).toBe(6);
        (await answerReview(db, userId, due[0]!.id, "good", "2026-11-25"));
        expect((await xpSummary(db, userId, "2026-11-25")).todayXp).toBe(2);
        (await saveArtifact(db, userId, { title: "AI ch3 sheet", bodyMd: "# Search\nBFS is complete" }, "2026-11-25"));
        expect((await xpSummary(db, userId, "2026-11-25")).todayXp).toBe(10);
    });
    it("undo within 10 min reverses focus/test; manual late entry earns 50%", async () => {
        const { db, userId } = (await setup());
        const now = localToUtc("2026-11-24", "12:00");
        (await logTest(db, userId, { correct: 10, wrong: 0 }, { now }));
        expect((await xpSummary(db, userId, "2026-11-24")).todayXp).toBe(6);
        const u = (await undoable(db, userId, new Date(Date.now() + 1000)));
        expect(u.length).toBe(1);
        (await undoEvent(db, userId, u[0]!.id, new Date(Date.now() + 1000)));
        expect((await db.select().from(testLogs)).length).toBe(0);
        expect((await xpSummary(db, userId, "2026-11-24")).todayXp).toBe(0);
        (await expect(undoEvent(db, userId, u[0]!.id)).rejects.toThrow());
        const r = (await manualFocus(db, userId, { day: "2026-11-20", start: "10:00", minutes: 60, kind: "video" }, { now: localToUtc("2026-11-24", "12:00") }));
        expect(r!.late).toBe(true);
        expect((await xpSummary(db, userId, "2026-11-20")).todayXp).toBe(6); // 12 × 0.5
        const r2 = (await manualFocus(db, userId, { day: "2026-11-24", start: "08:00", minutes: 60, kind: "video" }, { now: localToUtc("2026-11-24", "12:00") }));
        expect(r2!.late).toBe(false);
        expect((await xpSummary(db, userId, "2026-11-24")).todayXp).toBe(12);
    });
    it("chapter clear → XP with tier factor; once only", async () => {
        const { db, userId } = (await setup());
        (await queryRows(db, sql.raw("UPDATE chapters SET tier = 'M' WHERE id = 'ai-3'")));
        (await logTest(db, userId, { chapterId: "ai-3", correct: 8, wrong: 1, blank: 1 }, { day: "2026-12-01", now: localToUtc("2026-12-01", "12:00") }));
        expect((await updateChapterState(db, userId, "ai-3")).cleared).toBe(false);
        (await logTest(db, userId, { chapterId: "ai-3", correct: 9, wrong: 0, blank: 1 }, { day: "2026-12-04", now: localToUtc("2026-12-04", "12:00") }));
        expect((await updateChapterState(db, userId, "ai-3")).cleared).toBe(true);
        expect((await updateChapterState(db, userId, "ai-3")).cleared).toBe(false);
        const xp = (await queryOne<{
            v: number;
        }>(db, sql `SELECT sum(amount) v FROM xp_ledger WHERE rule_key = 'xp.chapter.clear'`))!.v;
        expect(xp).toBe(60);
    });
    it("ideas park, detour friction needs a reason for 'later', ledger sums", async () => {
        const { db, userId } = (await setup());
        (await parkIdea(db, userId, { text: "fitoloc landing page", tags: "fitoloc", value: 5, effort: "S" }));
        (await parkIdea(db, userId, { text: "rewrite blog", value: 2, effort: "L" }));
        expect((await listIdeas(db, userId))[0]!.text).toBe("fitoloc landing page");
        (await expect(logDetour(db, userId, { kind: "coding", choice: "later" }, "2026-11-24")).rejects.toThrow());
        (await logDetour(db, userId, { kind: "coding", choice: "continue", minutes: 40 }, "2026-11-24"));
        (await logDetour(db, userId, { kind: "video", choice: "study_first" }, "2026-11-24"));
        const l = (await detourLedger(db, userId, "2026-11-24"));
        expect(l.totalMinutes).toBe(40);
        expect(l.topKinds[0]!.kind).toBe("coding");
    });
    it("plan: triage + generate + override with reason + reset week once a month", async () => {
        const { db, userId } = (await setup());
        const cfg = (await currentConfig(db, userId));
        const t = (await triage(db, userId, cfg));
        expect(t.results.length).toBeGreaterThan(60);
        const p = (await generatePlan(db, userId, "2026-11-14", cfg));
        expect(p.items.length).toBeGreaterThan(20);
        const v = (await planView(db, userId, "2026-11-30", cfg));
        expect(v.weeks).toHaveLength(25);
        expect((await overrideTier(db, userId, "ai-3", "C", "")).ok).toBe(false);
        expect((await overrideTier(db, userId, "ai-3", "C", "I already know search well")).ok).toBe(true);
        (await resetWeek(db, userId, "2026-11-30", cfg));
        (await expect(resetWeek(db, userId, "2026-12-10", cfg)).rejects.toThrow(ResetWeekDenied));
    });
    it("bosses: spec, result → SS/XP/gold; mocks: LA intentional skip; rival off in baseline", async () => {
        const { db, userId } = (await setup());
        const cfg = (await currentConfig(db, userId));
        (await generatePlan(db, userId, "2026-11-14", cfg));
        const bs = (await ensureWeekBosses(db, userId, 2));
        const weekly = bs.find((b) => b.kind === "weekly")!;
        expect(JSON.parse(weekly.specJson).questions).toBe(25);
        const o = (await logBossResult(db, userId, weekly.id, { results: [{ chapterId: "ai-1", correct: 20, wrong: 3, blank: 2 }] }, "2026-11-27"));
        expect(o.defeated).toBe(true);
        expect((await queryOne<{
            v: number;
        }>(db, sql `SELECT sum(amount) v FROM gold_ledger`))!.v).toBe(50);
        expect((await ensureWeekBosses(db, userId, 6)).some((b) => b.kind === "region")).toBe(true);
        const mocks = (await listMocks(db, userId));
        expect(mocks.length).toBe(13);
        const m9 = mocks.find((m) => m.no === 9)!;
        const per = Object.fromEntries(Object.entries(m9.budget).filter(([k, v]) => k !== "linear_algebra" && v.questions > 0).map(([k, v]) => [k, { correct: Math.floor(v.questions / 2), wrong: 0, blank: v.questions - Math.floor(v.questions / 2) }]));
        const r = (await logMock(db, userId, { mockNo: 9, perSubject: per }, "2027-03-12"));
        expect(r.netPctNoSkip).toBeGreaterThan(r.netPct);
        expect((await rivalView(db, userId, "2026-11-20")).enabled).toBe(false);
        (await setKv(db, userId, "baseline.confirmed", { on: "2026-11-20" }));
        expect((await rivalView(db, userId, "2026-12-10")).enabled).toBe(true);
        expect((await settleDuels(db, userId, "2026-12-10")).length).toBeGreaterThan(0);
    });
    it("shop: gold, budget cap 0 blocks money rewards; achievements ≥ 20; anomalies", async () => {
        const { db, userId } = (await setup());
        const v = (await shopView(db, userId, "2026-11-24"));
        expect(v.rewards.length).toBe(6);
        (await expect(claimReward(db, userId, v.rewards[0]!.id, "2026-11-24")).rejects.toThrow(ClaimDenied));
        (await queryRows(db, sql.raw("INSERT INTO events (id,user_id,type,payload_json,occurred_at,source,created_at,game_day) VALUES ('g','u1','goal.completed','{\"gold\":500}','2026-11-24T10:00:00Z','app','2026-11-24T10:00:00Z','2026-11-24')")));
        (await replayAll(db, userId));
        (await claimReward(db, userId, v.rewards[0]!.id, "2026-11-24"));
        expect((await shopView(db, userId, "2026-11-24")).gold).toBe(460);
        const food = v.rewards.find((r) => r.moneyCost > 0)!;
        (await expect(claimReward(db, userId, food.id, "2026-11-24")).rejects.toThrow(/budget/));
        expect((await achievementsView(db, userId, "2026-11-24")).length).toBeGreaterThanOrEqual(20);
        (await logTest(db, userId, { correct: 250, wrong: 0 }, { now: localToUtc("2026-11-24", "12:00") }));
        expect((await anomalyLog(db, userId)).map((a) => a.rule)).toContain("tests_per_day");
    });
    it("codex: Persian search (Arabic ي/ك, digits) + decisions with reason", async () => {
        const { db, userId } = (await setup());
        expect(searchDocs("كنكور").length).toBeGreaterThan(0);
        expect(searchDocs("Shadow Rival").length).toBeGreaterThan(0);
        expect(readDoc("../package.json")).toBeNull();
        expect(readDoc("04-game-design.md")!.headings.length).toBeGreaterThan(5);
        (await expect(recordDecision(db, userId, { title: "drop LA", rationale: "" }, "2026-11-24")).rejects.toThrow());
        (await recordDecision(db, userId, { title: "جبر خطی حذف شد", rationale: "زمان کافی نیست" }, "2026-11-24"));
        expect((await listDecisions(db, userId, "جبر")).length).toBe(1);
    });
    it("reviews, goal, baseline, sleep, habits limit", async () => {
        const { db, userId } = (await setup());
        (await generateDay(db, userId, "2026-11-16"));
        (await saveNightly(db, userId, "2026-11-16", { spark: "good focus", envDone: ["Shoes"], checklist: ["Shoes", "Book"] }));
        expect((await getNightly(db, userId, "2026-11-16")).checklist).toEqual(["Shoes", "Book"]);
        (await setGoal(db, userId, "2026-11-16", { minutes: 30 }));
        (await startFocus(db, userId, { kind: "video" }, { now: localToUtc("2026-11-16", "10:00") }));
        (await stopFocus(db, userId, localToUtc("2026-11-16", "10:25")));
        (await startFocus(db, userId, { kind: "video" }, { now: localToUtc("2026-11-16", "10:25") }));
        (await stopFocus(db, userId, localToUtc("2026-11-16", "10:35")));
        (await refreshProgress(db, userId, "2026-11-16"));
        expect((await goalView(db, userId, "2026-11-16")).done).toBe(true);
        expect((await queryOne<{
            v: number;
        }>(db, sql `SELECT sum(amount) v FROM gold_ledger WHERE rule_key = 'gold.goal'`))!.v).toBe(10);
        (await logTest(db, userId, { chapterId: "ai-3", correct: 3, wrong: 1, blank: 1 }, { day: "2026-11-16", now: localToUtc("2026-11-16", "12:00") }));
        const b = (await baselineReport(db, userId, "2026-11-21"));
        expect(b.scouted[0]!.id).toBe("ai-3");
        (await confirmBaseline(db, userId, "2026-11-21"));
        expect((await db.select().from(errorItems)).length).toBe(0);
        (await expect(saveCouncil(db, userId, "2026-11-27", { oneChange: "" })).rejects.toThrow());
        (await saveCouncil(db, userId, "2026-11-27", { oneChange: "Phone out of the room during Core" }));
        expect((await councilData(db, userId, "2026-11-27")).saved?.oneChange).toMatch(/Phone/);
        const s = (await logSleep(db, userId, { date: "2026-11-24", bed: "1:00", wake: "8:20" }));
        expect(s.minutes).toBe(440);
        expect((await programView(db, userId, "2026-11-24")).week.wakeTarget).toBe("08:04");
        expect((await listHabits(db, userId)).filter((h) => ["trial", "active"].includes(h.status)).length).toBe(7);
        (await expect(saveHabit(db, userId, { title: "Meditate", pillar: "rest", anchor: "after run", place: "room", tiers: { seed: "1 breath", standard: "10 min" }, metric: { type: "check" }, status: "trial" }, "2026-11-24")).rejects.toThrow(HabitLimit));
        expect((await updateConfig(db, userId, { flags: { rival: false } }, "test flag")).config.flags.rival).toBe(false);
    });
});
