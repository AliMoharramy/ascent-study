import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { type Db } from "@/db/client";
import { memoryDb as isolatedDb, closeTestDb } from "@/db/testing";
import { afterEach } from "vitest";
const databases: Db[] = [];
async function memoryDb() { const db = await isolatedDb(); databases.push(db); return db; }
afterEach(async () => { for (const db of databases.splice(0))
    await closeTestDb(db); });
import { chapters, dayCloses, events, experiments, focusSessions, reviewCards, sleepLogs, subjects, weekPlanItems, wellnessLogs } from "@/db/schema";
import { burnoutRadar, buddyReportText } from "@/domain/burnout";
import { localCoachReply, routeIntent, type CoachContext } from "@/domain/coach";
import { buildAnki, buildIcs, foldLine } from "@/domain/exports";
import { compareExperiment, metricValue, type ExperimentAggregate } from "@/domain/experiment";
import { PLAYBOOK, preExamSleepPlan } from "@/domain/final";
import { lightenWeek } from "@/domain/negotiate";
import { DEFAULT_CONFIG } from "@/config/defaults";
import { addDaysIso } from "@/i18n/jalali";
import { EXAM_DATE } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";
import { createUser } from "./auth";
import { updateConfig } from "./config";
import { BuddyConsentRequired, buddyReport, burnoutView, setBuddyConsent } from "./burnout";
import { approveProposal, coachView, ProposalDenied, rejectProposal, sendCoachMessage } from "./coach";
import { ankiExport, planIcs } from "./exports";
import { finalView, tickChecklist } from "./final";
import { cancelExperiment, councilExperiment, ExperimentDenied, experimentsView, finishExperiment, startExperiment } from "./experiments";
import { councilData } from "./reviews";
import { createCard } from "./forge";
async function setup(): Promise<{
    db: Db;
    userId: string;
}> {
    const db = (await memoryDb());
    const userId = await createUser(db, { username: "Ascender", name: "Ascender", password: "correct horse battery" });
    return { db, userId };
}
const NOW = nowIso();
const TODAY = "2026-11-16";
const cfg = DEFAULT_CONFIG;
const eventTypes = async (db: Db, userId: string) => (await db.select({ t: events.type }).from(events).where(eq(events.userId, userId))).map((r) => r.t);
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});
async function seedNight(db: Db, userId: string, date: string, hours: number) {
    (await db.insert(sleepLogs).values({ id: newId(), userId, date, bedAt: "01:00", wakeAt: "07:00", minutes: Math.round(hours * 60), source: "manual", createdAt: NOW }));
}
async function seedCheckin(db: Db, userId: string, date: string, mood: number, energy: number) {
    (await db.insert(wellnessLogs).values({ userId, date, mood, energy, updatedAt: NOW }));
}
async function seedClose(db: Db, userId: string, date: string, standard: boolean) {
    (await db.insert(dayCloses).values({ id: newId(), userId, date, standardDay: standard, createdAt: NOW }));
}
async function seedFocus(db: Db, userId: string, day: string, minutes: number) {
    (await db.insert(focusSessions).values({ id: newId(), userId, kind: "tests", status: "ended", startedAt: `${day}T08:00:00Z`, minutes, gameDay: day, createdAt: NOW, updatedAt: NOW }));
}
async function seedChapter(db: Db, id: string, subjectId: string, no = 1) {
    (await db.insert(subjects).values({ id: subjectId, nameFa: "درس", nameEn: subjectId, group: "core", status: "active", sort: 0, updatedAt: NOW }).onConflictDoNothing());
    (await db.insert(chapters).values({ id, subjectId, no, title: `Chapter ${id}`, updatedAt: NOW }));
}
async function seedPlanItem(db: Db, userId: string, id: string, weekNo: number, tier: "M" | "S" | "C", plannedMin: number, chapterId = "ch1") {
    (await db.insert(weekPlanItems).values({ id, userId, weekNo, chapterId, subjectId: "dsa", tier, plannedMin, createdAt: NOW }));
}
// ── #101 burnout radar + buddy ───────────────────────────────
describe("burnout radar (#101)", () => {
    it("calm with no data; every rule exposes observed vs threshold", () => {
        const r = burnoutRadar({ sleepDebtHours: 0, sleepDebtLimit: 7, avgSleepHours: null, minSleepHours: 6.25, energyAvg: null, moodAvg: null, checkins: 0, consistency: 0, focusHours: 0 }, cfg.burnout);
        expect(r.level).toBe("calm");
        expect(r.points).toBe(0);
        expect(r.rules).toHaveLength(5);
        for (const rule of r.rules) {
            expect(rule.observed.length).toBeGreaterThan(0);
            expect(rule.threshold.length).toBeGreaterThan(0);
            expect(rule.fired).toBe(false);
        }
    });
    it("low sleep + fatigue reaches WARN; grind rule needs both consistency and load", () => {
        const r = burnoutRadar({ sleepDebtHours: 15.8, sleepDebtLimit: 7, avgSleepHours: 4, minSleepHours: 6.25, energyAvg: 1.5, moodAvg: 2, checkins: 4, consistency: 0.9, focusHours: 30 }, cfg.burnout);
        expect(r.level).toBe("warn");
        expect(r.rules.filter((x) => x.fired).map((x) => x.key)).toEqual(["sleep_debt", "short_sleep", "low_energy", "low_mood", "grind"]);
        expect(r.advice.length).toBeGreaterThan(0);
        const grindOnly = burnoutRadar({ sleepDebtHours: 0, sleepDebtLimit: 7, avgSleepHours: 8, minSleepHours: 6.25, energyAvg: 4, moodAvg: 4, checkins: 4, consistency: 0.95, focusHours: 10 }, cfg.burnout);
        expect(grindOnly.rules.find((x) => x.key === "grind")!.fired).toBe(false);
    });
    it("energy rule respects the minimum check-in count", () => {
        const r = burnoutRadar({ sleepDebtHours: 0, sleepDebtLimit: 7, avgSleepHours: 8, minSleepHours: 6.25, energyAvg: 1, moodAvg: 1, checkins: 2, consistency: 0, focusHours: 0 }, cfg.burnout);
        expect(r.rules.find((x) => x.key === "low_energy")!.fired).toBe(false);
        expect(r.level).toBe("calm");
    });
    it("server view aggregates real logs and reaches WARN on a bad week", async () => {
        const { db, userId } = await setup();
        for (let i = 0; i < 7; i++)
            (await seedNight(db, userId, addDaysIso(TODAY, -i), 4));
        for (let i = 0; i < 3; i++)
            (await seedCheckin(db, userId, addDaysIso(TODAY, -i), 2, 1));
        const v = (await burnoutView(db, userId, TODAY));
        expect(v.level).toBe("warn");
        expect(v.rules.find((r) => r.key === "sleep_debt")!.fired).toBe(true);
        expect(v.consent.consented).toBe(false);
    });
    it("buddy report refuses without consent, then generates aggregates-only text with events", async () => {
        const { db, userId } = await setup();
        (await expect(buddyReport(db, userId, TODAY)).rejects.toThrow(BuddyConsentRequired));
        (await setBuddyConsent(db, userId, { consented: true, name: "Sara" }, TODAY));
        (await seedFocus(db, userId, TODAY, 120));
        const r = (await buddyReport(db, userId, TODAY));
        expect(r.text).toContain("Sara");
        expect(r.text).toContain("Consistency");
        expect(r.text).toContain("Numbers only");
        expect(r.summary.hours).toBe(2);
        const types = (await eventTypes(db, userId));
        expect(types).toContain("buddy.consent");
        expect(types).toContain("buddy.report");
        (await setBuddyConsent(db, userId, { consented: false, name: "Sara" }, TODAY));
        (await expect(buddyReport(db, userId, TODAY)).rejects.toThrow(BuddyConsentRequired));
    });
    it("buddyReportText carries numbers only — no free text fields", () => {
        const text = buddyReportText({ weekNo: 3, hours: 21.5, xp: 900, consistencyPct: 86, netPct: 54.3, sleepAvgHours: 7.1, burnoutLevel: "watch" }, "Reza");
        expect(text).toContain("week 3");
        expect(text).toContain("21.5 h");
        expect(text).toContain("54.3 %");
        expect(text).toContain("watch");
    });
});
// ── #102 coach chat + negotiator ─────────────────────────────
describe("Archie coach (#102)", () => {
    it("reports remote readiness when provider settings come from environment", async () => {
        const { db, userId } = await setup();
        vi.stubEnv("AI_KEY", "apikey arvan-test-key");
        vi.stubEnv("AI_BASE_URL", "https://arvan.test/v1");
        (await updateConfig(db, userId, { flags: { ai: true }, ai: { baseUrl: "" } }, "AI env ready test"));
        expect((await coachView(db, userId, TODAY)).remoteReady).toBe(true);
    });
    it("routes intents in English and Persian", () => {
        expect(routeIntent("Quiz me on trees")).toBe("quiz");
        expect(routeIntent("why do I keep making mistakes?")).toBe("errors");
        expect(routeIntent("this week is too heavy, lighten it")).toBe("lighten");
        expect(routeIntent("چطور خوابم را درست کنم؟")).toBe("sleep");
        expect(routeIntent("برنامه هفته بعد چیست؟")).toBe("plan");
        expect(routeIntent("کم آوردم، ناامید شدم")).toBe("burnout");
        expect(routeIntent("hello there")).toBe("help");
    });
    it("local replies are deterministic and numeric", () => {
        const ctx: CoachContext = { weekNo: 2, daysToExam: 170, todayXp: 40, weekHours: 12, planWeekHours: 30, consistencyPct: 80, netPct: 55, sleepAvgHours: 6.5, sleepDebtHours: 3, burnoutLevel: "watch", dueCards: 7, openErrors: 4, topCause: "concept" };
        expect(localCoachReply("quiz", ctx)).toContain("7 cards");
        expect(localCoachReply("errors", ctx)).toContain("concept");
        expect(localCoachReply("summary", ctx)).toBe(localCoachReply("summary", ctx));
    });
    it("lightenWeek moves C first then S, never M, whole items to next week", () => {
        const items = [
            { id: "m1", chapterId: "a", tier: "M" as const, plannedMin: 300, weekNo: 1 },
            { id: "s1", chapterId: "b", tier: "S" as const, plannedMin: 200, weekNo: 1 },
            { id: "c1", chapterId: "c", tier: "C" as const, plannedMin: 120, weekNo: 1 },
            { id: "c2", chapterId: "d", tier: "C" as const, plannedMin: 90, weekNo: 1 },
        ];
        const p = lightenWeek(items, 1, 25)!;
        expect(p.changes.map((c) => c.itemId)).toEqual(["c1", "c2"]);
        expect(p.changes.every((c) => c.toWeek === 2)).toBe(true);
        expect(p.beforeMin).toBe(710);
        expect(p.afterMin).toBe(500);
        expect(p.movedMin).toBeGreaterThanOrEqual(p.beforeMin - p.targetMin);
        expect(lightenWeek(items, 25, 25)).toBeNull();
        expect(lightenWeek([items[0]!], 1, 25)).toBeNull();
    });
    it("chat drafts a proposal but the plan only moves on explicit approval", async () => {
        const { db, userId } = await setup();
        (await seedChapter(db, "ch1", "dsa"));
        (await seedPlanItem(db, userId, "m1", 1, "M", 300));
        (await seedPlanItem(db, userId, "s1", 1, "S", 200));
        (await seedPlanItem(db, userId, "c1", 1, "C", 120));
        (await seedPlanItem(db, userId, "c2", 1, "C", 90));
        const r = await sendCoachMessage(db, userId, "this week is too heavy — lighten my plan", TODAY);
        expect(r.provider).toBe("local");
        expect(r.proposal?.status).toBe("pending");
        expect((await db.select().from(weekPlanItems).where(eq(weekPlanItems.id, "c1")).limit(1))[0]!.weekNo).toBe(1);
        (await expect(approveProposal(db, userId, "wrong-id", TODAY)).rejects.toThrow(ProposalDenied));
        const approved = (await approveProposal(db, userId, r.proposal!.id, TODAY));
        expect(approved.proposal?.status).toBe("approved");
        expect((await db.select().from(weekPlanItems).where(eq(weekPlanItems.id, "c1")).limit(1))[0]!.weekNo).toBe(2);
        expect((await db.select().from(weekPlanItems).where(eq(weekPlanItems.id, "m1")).limit(1))[0]!.weekNo).toBe(1);
        const types = (await eventTypes(db, userId));
        expect(types).toContain("coach.message");
        expect(types).toContain("plan.negotiated");
        expect(types).toContain("plan.item_moved");
        (await expect(approveProposal(db, userId, r.proposal!.id, TODAY)).rejects.toThrow(ProposalDenied));
    });
    it("reject keeps the plan untouched; history persists in the view", async () => {
        const { db, userId } = await setup();
        (await seedChapter(db, "ch1", "dsa"));
        (await seedPlanItem(db, userId, "c1", 1, "C", 240));
        const r = await sendCoachMessage(db, userId, "lighten my week please", TODAY);
        const rejected = (await rejectProposal(db, userId, r.proposal!.id, TODAY));
        expect(rejected.proposal?.status).toBe("rejected");
        expect((await db.select().from(weekPlanItems).where(eq(weekPlanItems.id, "c1")).limit(1))[0]!.weekNo).toBe(1);
        const v = (await coachView(db, userId, TODAY));
        expect(v.messages.filter((m) => m.role === "user")).toHaveLength(1);
        expect(v.messages.filter((m) => m.role === "coach").length).toBeGreaterThanOrEqual(2);
    });
});
// ── #103 ICS + Anki ──────────────────────────────────────────
describe("exports (#103)", () => {
    it("ICS is RFC 5545 shaped: CRLF, folding ≤ 75 octets, escaping, all-day DTEND", () => {
        const ics = buildIcs([
            { uid: "a@x", date: "2026-11-16", startMin: 540, endMin: 660, summary: "Study: trees; graphs, part 2", description: "line one\nline two" },
            { uid: "b@x", date: EXAM_DATE, startMin: null, endMin: null, summary: "Exam day" },
            { uid: "c@x", date: "2026-11-17", startMin: 600, endMin: 720, summary: "خیلی طولانی ".repeat(12) },
        ], { nowIso: "2026-11-16T08:00:00.000Z", tzid: "Asia/Tehran" });
        expect(ics).toContain("BEGIN:VCALENDAR");
        expect(ics).toContain("VERSION:2.0");
        expect(ics).toContain("BEGIN:VTIMEZONE");
        expect(ics).toContain("TZID:Asia/Tehran");
        expect(ics).toContain("DTSTART;TZID=Asia/Tehran:20261116T090000");
        expect(ics).toContain("DTSTART;VALUE=DATE:20270506");
        expect(ics).toContain("DTEND;VALUE=DATE:20270507");
        expect(ics).toContain("SUMMARY:Study: trees\\; graphs\\, part 2");
        expect(ics).toContain("DESCRIPTION:line one\\nline two");
        expect(ics.endsWith("\r\n")).toBe(true);
        expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
        expect(ics).toContain("UID:a@x");
        expect(ics).toContain("DTSTAMP:20261116T080000Z");
    });
    it("foldLine never splits a multi-byte character", () => {
        const line = "SUMMARY:" + "کنکور".repeat(40);
        const folded = foldLine(line);
        expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join("")).toBe(line);
        for (const l of folded)
            expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    });
    it("Anki TSV has import headers, sanitizes tabs/newlines, tags the source", () => {
        const tsv = buildAnki([{ front: "Q\twith tab", back: "line1\nline2", tags: ["the-ascent", "error", "ch 1!"] }], "The Ascent");
        const lines = tsv.trim().split("\n");
        expect(lines[0]).toBe("#separator:tab");
        expect(lines[1]).toBe("#html:true");
        expect(lines[2]).toBe("#deck:The Ascent");
        expect(lines[3]).toBe("#tags column:3");
        const fields = lines[4]!.split("\t");
        expect(fields).toHaveLength(3);
        expect(fields[0]).toBe("Q with tab");
        expect(fields[1]).toBe("line1<br>line2");
        expect(fields[2]).toBe("the-ascent error ch_1");
    });
    it("planIcs schedules real plan items and the exam day; ankiExport carries only user cards", async () => {
        const { db, userId } = await setup();
        (await seedChapter(db, "ch1", "dsa"));
        (await seedPlanItem(db, userId, "p1", 1, "M", 180));
        const ics = (await planIcs(db, userId, TODAY, "Asia/Tehran"));
        expect(ics.filename).toBe("the-ascent-plan.ics");
        expect(ics.content).toContain("Study: Chapter ch1");
        expect(ics.content).toContain("Exam day");
        expect(ics.content).toContain(`DTSTART;VALUE=DATE:${EXAM_DATE.replace(/-/g, "")}`);
        (await createCard(db, userId, { front: "My own takeaway", back: "Because X" }, TODAY));
        (await db.insert(reviewCards).values({ id: newId(), userId, refType: "error", front: "Why did I miss this?", back: "Sign error", dueOn: TODAY, createdAt: NOW, updatedAt: NOW }));
        const anki = (await ankiExport(db, userId));
        expect(anki.count).toBe(2);
        expect(anki.content).toContain("My own takeaway");
        expect(anki.content).toContain("Why did I miss this?");
        expect(anki.content).not.toContain("test_bank");
    });
});
// ── #104 final kit ───────────────────────────────────────────
describe("exam-day kit (#104)", () => {
    it("playbook covers night-before, morning and the skipping strategy with negative-marking math", () => {
        const keys = PLAYBOOK.map((s) => s.key);
        expect(keys).toContain("night_before");
        expect(keys).toContain("exam_morning");
        expect(keys).toContain("skip_strategy");
        const skip = PLAYBOOK.find((s) => s.key === "skip_strategy")!.items.join(" ");
        expect(skip).toContain("−⅓");
        expect(skip).toContain("eliminate");
        expect(skip).toContain("2×");
    });
    it("sleep plan freezes shifts, walks bedtime 15 min/night to the goal, keeps wake fixed", () => {
        const plan = preExamSleepPlan(EXAM_DATE, { wakeTarget: "06:30", bedTarget: "00:30" }, cfg.sleep);
        expect(plan.nights).toHaveLength(7);
        expect(plan.frozen).toBe(true);
        expect(plan.goalHours).toBe(7.5);
        expect(plan.nights[0]!.date).toBe(addDaysIso(EXAM_DATE, -7));
        expect(plan.nights[6]!.date).toBe(addDaysIso(EXAM_DATE, -1));
        for (const n of plan.nights)
            expect(n.wake).toBe("06:30");
        expect(plan.nights[0]!.bed).toBe("00:15");
        expect(plan.nights[1]!.bed).toBe("00:00");
        expect(plan.nights[2]!.bed).toBe("23:45");
        expect(plan.nights[3]!.bed).toBe("23:30");
        expect(plan.nights[4]!.bed).toBe("23:15");
        expect(plan.nights[5]!.bed).toBe("23:00");
        expect(plan.nights[6]!.bed).toBe("23:00");
        expect(plan.nights[6]!.hours).toBe(7.5);
        expect(plan.nights[6]!.note).toContain("Exam eve");
    });
    it("a program already at the goal stays untouched", () => {
        const plan = preExamSleepPlan(EXAM_DATE, { wakeTarget: "06:00", bedTarget: "22:00" }, cfg.sleep);
        for (const n of plan.nights) {
            expect(n.bed).toBe("22:00");
            expect(n.hours).toBe(8);
        }
    });
    it("finalView syncs with the Sleep Program and checklist ticks persist with an event", async () => {
        const { db, userId } = await setup();
        const v = (await finalView(db, userId, TODAY));
        expect(v.sleepPlan.nights[0]!.wake).toBe(v.programWeek.wakeTarget);
        expect(v.examDate).toBe(EXAM_DATE);
        expect(v.daysLeft).toBeGreaterThan(100);
        (await tickChecklist(db, userId, { key: "night_before:0", done: true }, TODAY));
        expect((await finalView(db, userId, TODAY)).checklist["night_before:0"]).toBe(true);
        expect((await eventTypes(db, userId))).toContain("final.checklist");
    });
});
// ── #105 experiment lab ──────────────────────────────────────
describe("Experiment Lab (#105)", () => {
    const agg = (over: Partial<ExperimentAggregate> = {}): ExperimentAggregate => ({ days: 14, standardDays: 7, focusMinutes: 14 * 120, netSum: 700, netCount: 14, ...over });
    it("verdicts are threshold-based and explainable", () => {
        const worked = compareExperiment(agg({ standardDays: 7 }), agg({ standardDays: 10 }), "consistency", cfg.experiment);
        expect(worked.verdict).toBe("worked");
        expect(worked.delta).toBeCloseTo(21.4, 1);
        const didnt = compareExperiment(agg({ standardDays: 10 }), agg({ standardDays: 7 }), "consistency", cfg.experiment);
        expect(didnt.verdict).toBe("didnt");
        const noise = compareExperiment(agg({ standardDays: 7 }), agg({ standardDays: 7 }), "consistency", cfg.experiment);
        expect(noise.verdict).toBe("inconclusive");
        expect(noise.reasons.join(" ")).toContain("noise band");
    });
    it("focus is per-day normalized; too few days or no tests → inconclusive", () => {
        const focus = compareExperiment(agg({ days: 14, focusMinutes: 1400 }), agg({ days: 7, focusMinutes: 840 }), "focus", cfg.experiment);
        expect(focus.baseline).toBe(100);
        expect(focus.during).toBe(120);
        expect(focus.delta).toBe(20);
        expect(focus.verdict).toBe("worked");
        const early = compareExperiment(agg(), agg({ days: 3 }), "consistency", cfg.experiment);
        expect(early.verdict).toBe("inconclusive");
        const noTests = compareExperiment(agg(), agg({ netCount: 0, netSum: 0 }), "net", cfg.experiment);
        expect(noTests.verdict).toBe("inconclusive");
        expect(metricValue(agg({ days: 0 }), "consistency")).toBeNull();
    });
    it("one at a time; baseline locked; early judge refused; finish produces a Council-ready result", async () => {
        const { db, userId } = await setup();
        for (let i = 1; i <= 14; i++)
            (await seedClose(db, userId, addDaysIso(TODAY, -i), i <= 2));
        const v = (await startExperiment(db, userId, { changeText: "Tests before video", metric: "consistency" }, TODAY));
        expect(v.active?.changeText).toBe("Tests before video");
        expect(v.active?.baseline.standardDays).toBe(2);
        (await expect(startExperiment(db, userId, { changeText: "Another change", metric: "net" }, TODAY)).rejects.toThrow(ExperimentDenied));
        (await expect(finishExperiment(db, userId, v.active!.id, addDaysIso(TODAY, 3))).rejects.toThrow(ExperimentDenied));
        for (let i = 0; i < 8; i++)
            (await seedClose(db, userId, addDaysIso(TODAY, i), true));
        const done = (await finishExperiment(db, userId, v.active!.id, addDaysIso(TODAY, 7)));
        expect(done.active).toBeNull();
        expect(done.latestResult?.verdict).toBe("worked");
        const types = (await eventTypes(db, userId));
        expect(types).toContain("experiment.started");
        expect(types).toContain("experiment.finished");
        const council = (await councilExperiment(db, userId));
        expect(council?.result.verdict).toBe("worked");
        expect((await councilData(db, userId, addDaysIso(TODAY, 7))).experiment?.changeText).toBe("Tests before video");
    });
    it("cancel leaves no verdict; a fully elapsed window auto-finishes on the next view", async () => {
        const { db, userId } = await setup();
        const v = (await startExperiment(db, userId, { changeText: "Phone outside the room", metric: "focus" }, TODAY));
        (await cancelExperiment(db, userId, v.active!.id, TODAY));
        expect((await experimentsView(db, userId, TODAY)).history[0]!.status).toBe("cancelled");
        expect((await eventTypes(db, userId))).toContain("experiment.cancelled");
        const v2 = (await startExperiment(db, userId, { changeText: "Morning tests", metric: "consistency" }, TODAY));
        (await seedFocus(db, userId, TODAY, 200));
        const later = (await experimentsView(db, userId, addDaysIso(v2.active!.endDay, 1)));
        expect(later.active).toBeNull();
        expect(later.history.find((h) => h.id === v2.active!.id)!.status).toBe("done");
        expect((await db.select().from(experiments).where(eq(experiments.status, "active")))).toHaveLength(0);
    });
});
// ── #106 config substrate ────────────────────────────────────
describe("sound & calm config (#106)", () => {
    it("defaults: sounds off, calm off, volume 0.5", () => {
        expect(cfg.flags.sounds).toBe(false);
        expect(cfg.flags.calm).toBe(false);
        expect(cfg.sound.volume).toBe(0.5);
    });
});
