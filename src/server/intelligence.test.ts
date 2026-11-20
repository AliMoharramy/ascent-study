import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { type Db } from "@/db/client";
import { memoryDb as isolatedDb, closeTestDb } from "@/db/testing";
import { afterEach } from "vitest";
const databases: Db[] = [];
async function memoryDb() { const db = await isolatedDb(); databases.push(db); return db; }
afterEach(async () => { for (const db of databases.splice(0))
    await closeTestDb(db); });
import { challengeCards, chapterState, chapters, dayCloses, errorItems, events, focusSessions, reviewRounds, sleepLogs, subjects, testLogs, weekPlanItems } from "@/db/schema";
import { activeConfig, ledgerSnapshot, replayAll } from "@/events/projections";
import { EXAM_DATE } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";
import { createUser } from "./auth";
import { updateConfig } from "./config";
import { aiCallLog, aiStatus, aiRequestTimeoutMs, anomalyAlerts, weeklyReview } from "./ai";
import { awardGems, capsuleView, cardView, claimCard, claimSeason, drawWeeklyCard, ExtrasDenied, finishRush, gemsBalance, rushView, saveAvatar, sealCapsule, seasonView, unlockSkill } from "./extras";
import { acceptShaping, HabitLimit, logHabit, saveHabit, shapingView } from "./habits";
import { forecastView, rankView, skipView, whatIfView } from "./insights";
import { applyScheduler, interleaveView, LearningDenied, logPretest, masteryView } from "./learning";
import { ensureTodayReminders, markReminderRead, remindersView } from "./reminders";
import { importSleepCsv, importSleepCsvPreview, logSleep, suggestSleepMapping } from "./rest";
import { logWellness, wellnessView } from "./wellness";
import { wrappedView } from "./wrapped";
async function setup(): Promise<{
    db: Db;
    userId: string;
}> {
    const db = (await memoryDb());
    const userId = await createUser(db, { username: "Ascender", name: "Ascender", password: "correct horse battery" });
    return { db, userId };
}
const NOW = nowIso();
const W1 = "2026-11-14";
const TODAY = "2026-11-16";
const W2 = "2026-11-21";
async function seedChapter(db: Db, id: string, subjectId: string, no = 1) {
    (await db.insert(subjects).values({ id: subjectId, nameFa: "درس", nameEn: subjectId, group: "core", status: "active", sort: 0, updatedAt: NOW }).onConflictDoNothing());
    (await db.insert(chapters).values({ id, subjectId, no, title: `Chapter ${id}`, updatedAt: NOW }));
}
async function seedTest(db: Db, userId: string, day: string, c: number, w: number, b: number, extra: {
    chapterId?: string;
    seconds?: number;
    interleaved?: boolean;
} = {}) {
    const q = c + w + b;
    (await db.insert(testLogs)
        .values({ id: newId(), userId, correct: c, wrong: w, blank: b, netPct: q ? ((c - w / 3) / q) * 100 : 0, gameDay: day, loggedAt: NOW, createdAt: NOW, updatedAt: NOW, ...extra }));
}
const eventTypes = async (db: Db, userId: string) => (await db.select({ t: events.type }).from(events).where(eq(events.userId, userId))).map((r) => r.t);
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});
describe("time capsule (#90)", () => {
    it("seals encrypted, stays shut until exam day, then opens with the exact letter", async () => {
        const { db, userId } = await setup();
        const letter = "سلام به خودم در روز کنکور — تو از پسش برمی‌آیی.";
        const sealed = (await sealCapsule(db, userId, letter, TODAY));
        expect(sealed.sealed).toBe(true);
        expect(sealed.open).toBe(false);
        expect(sealed.daysLeft).toBeGreaterThan(0);
        (await expect(sealCapsule(db, userId, "another letter here", TODAY)).rejects.toThrow(ExtrasDenied));
        (await expect(sealCapsule(db, userId, "short", TODAY)).rejects.toThrow(ExtrasDenied));
        const opened = (await capsuleView(db, userId, EXAM_DATE));
        expect(opened.open).toBe(true);
        expect(opened.text).toBe(letter);
        expect((await eventTypes(db, userId))).toContain("capsule.sealed");
    });
    it("env CAPSULE_KEY separates key from data; a wrong key fails friendly, never crashes", async () => {
        vi.stubEnv("CAPSULE_KEY", "alpha-key");
        const { db, userId } = await setup();
        (await sealCapsule(db, userId, "a letter long enough to seal", TODAY));
        expect((await capsuleView(db, userId, EXAM_DATE)).keySource).toBe("env");
        vi.stubEnv("CAPSULE_KEY", "wrong-key");
        const bad = (await capsuleView(db, userId, EXAM_DATE));
        expect(bad.open).toBe(false);
        expect(bad.error).toMatch(/CAPSULE_KEY/);
    });
    it("without env key a per-user local key still round-trips", async () => {
        const { db, userId } = await setup();
        (await sealCapsule(db, userId, "local key letter, ten chars plus", TODAY));
        const v = (await capsuleView(db, userId, EXAM_DATE));
        expect(v.keySource).toBe("local");
        expect(v.open).toBe(true);
    });
});
describe("Gems, skill tree, avatar (#87)", () => {
    it("skills cost Gems per tier and perks fold into the active config", async () => {
        const { db, userId } = await setup();
        (await awardGems(db, userId, 10, "gems.test", "grant", TODAY));
        expect((await gemsBalance(db, userId))).toBe(10);
        const v = (await unlockSkill(db, userId, "focus", TODAY));
        expect(v.skills.find((s) => s.id === "focus")!.tier).toBe(1);
        expect((await gemsBalance(db, userId))).toBe(0);
        expect((await activeConfig(db, userId)).xp.surgeMaxMinutes).toBeGreaterThan(0);
        (await expect(unlockSkill(db, userId, "focus", TODAY)).rejects.toThrow(ExtrasDenied));
        (await expect(unlockSkill(db, userId, "nope", TODAY)).rejects.toThrow(ExtrasDenied));
    });
    it("avatar purchases spend once; re-equipping owned items is free", async () => {
        const { db, userId } = await setup();
        (await awardGems(db, userId, 10, "gems.test", "grant", TODAY));
        const a = (await saveAvatar(db, userId, { color: "mint", outfit: "hoodie", tool: null }, TODAY));
        expect(a.avatar.outfit).toBe("hoodie");
        expect(a.avatar.owned).toContain("hoodie");
        expect((await gemsBalance(db, userId))).toBe(0);
        (await saveAvatar(db, userId, { color: "coral", outfit: "hoodie", tool: null }, TODAY));
        expect((await gemsBalance(db, userId))).toBe(0);
        (await expect(saveAvatar(db, userId, { color: "mint", outfit: "cape", tool: null }, TODAY)).rejects.toThrow(ExtrasDenied));
    });
});
describe("Season Pass, challenge card, Boss Rush (#91)", () => {
    it("season claims only after the week ends and only with enough Standard days", async () => {
        const { db, userId } = await setup();
        for (const d of [W1, "2026-11-15", TODAY])
            (await db.insert(dayCloses).values({ id: newId(), userId, date: d, standardDay: true, createdAt: NOW }));
        (await expect(claimSeason(db, userId, 1, TODAY)).rejects.toThrow(/still running/));
        const v = (await claimSeason(db, userId, 1, W2));
        expect(v.stops[0]!.claimed).toBe(true);
        expect((await gemsBalance(db, userId))).toBe(2);
        (await expect(claimSeason(db, userId, 1, W2)).rejects.toThrow(/Already claimed/));
        (await expect(claimSeason(db, userId, 2, "2026-11-28")).rejects.toThrow(/Standard days/));
        expect((await seasonView(db, userId, W2)).stops[0]!.locked).toBe(false);
    });
    it("card draw is deterministic, claim needs real progress, rewards fold once", async () => {
        const { db, userId } = await setup();
        (await expect(claimCard(db, userId, TODAY)).rejects.toThrow(/Draw/));
        const drawn = (await drawWeeklyCard(db, userId, TODAY));
        expect(drawn.drawn).toBe(true);
        (await expect(drawWeeklyCard(db, userId, TODAY)).rejects.toThrow(/already drawn/));
        (await expect(claimCard(db, userId, TODAY)).rejects.toThrow(/not finished/));
        (await db.update(challengeCards).set({ cardId: "tests60" }).where(eq(challengeCards.userId, userId)));
        (await seedTest(db, userId, "2026-11-15", 60, 0, 0));
        const ready = (await cardView(db, userId, TODAY));
        expect(ready.progress).toBe(60);
        expect(ready.done).toBe(true);
        const claimed = (await claimCard(db, userId, TODAY));
        expect(claimed.status).toBe("claimed");
        expect((await gemsBalance(db, userId))).toBe(3);
        (await expect(claimCard(db, userId, TODAY)).rejects.toThrow(/Already claimed/));
    });
    it("Boss Rush is gated to the final week / last 7 days and finishes once", async () => {
        const { db, userId } = await setup();
        const results = [1, 2, 3, 4, 5].map((realm) => ({ realm, netPct: 100 }));
        (await expect(finishRush(db, userId, { results }, TODAY)).rejects.toThrow(/final week/));
        const examWeek = "2027-05-04";
        expect((await rushView(db, userId, examWeek)).available).toBe(true);
        const v = (await finishRush(db, userId, { results }, examWeek));
        expect(v.finished!.results.every((r) => r.defeated)).toBe(true);
        expect((await gemsBalance(db, userId))).toBe(5);
        (await expect(finishRush(db, userId, { results }, examWeek)).rejects.toThrow(/already finished/));
    });
    it("gems/gold ledgers replay exactly from the event log", async () => {
        const { db, userId } = await setup();
        (await awardGems(db, userId, 60, "gems.test", "grant", TODAY));
        (await unlockSkill(db, userId, "focus", TODAY));
        for (const d of [W1, "2026-11-15", TODAY])
            (await db.insert(dayCloses).values({ id: newId(), userId, date: d, standardDay: true, createdAt: NOW }));
        (await claimSeason(db, userId, 1, W2));
        (await db.insert(challengeCards).values({ userId, weekNo: 2, cardId: "tests60", status: "pending", drawnAt: NOW }));
        (await seedTest(db, userId, W2, 60, 0, 0));
        (await claimCard(db, userId, W2));
        (await finishRush(db, userId, { results: [1, 2, 3, 4, 5].map((realm) => ({ realm, netPct: 100 })) }, "2027-05-04"));
        const before = (await ledgerSnapshot(db, userId));
        expect(before.some((l) => l.startsWith("gems|"))).toBe(true);
        (await replayAll(db, userId));
        expect((await ledgerSnapshot(db, userId))).toEqual(before);
    });
});
describe("wellness suite + sleep debt (#88)", () => {
    it("mood/energy/wins/wind-down upsert per day and validate bounds", async () => {
        const { db, userId } = await setup();
        const v = (await logWellness(db, userId, TODAY, { mood: 4, energy: 3, wins: ["walked", "read"], winddown: ["Screens away 30 min before bed"] }));
        expect(v.today!.mood).toBe(4);
        expect(v.today!.wins).toEqual(["walked", "read"]);
        (await logWellness(db, userId, TODAY, { mood: 2, energy: 2, wins: [], winddown: [] }));
        expect((await wellnessView(db, userId, TODAY)).series.length).toBe(1);
        (await expect(logWellness(db, userId, TODAY, { mood: 9, energy: 1, wins: [], winddown: [] })).rejects.toThrow());
        (await expect(logWellness(db, userId, TODAY, { mood: 1, energy: 1, wins: ["a", "b", "c", "d"], winddown: [] })).rejects.toThrow());
    });
    it("sleep debt mirrors the last 7 nights against the configured minimum", async () => {
        const { db, userId } = await setup();
        (await logSleep(db, userId, { date: "2026-11-15", bed: "23:30", wake: "05:30" }));
        const v = (await wellnessView(db, userId, TODAY));
        expect(v.sleepDebt.logged).toBe(1);
        expect(v.sleepDebt.debtHours).toBeGreaterThan(0);
        expect(v.debtLimitHours).toBe(7);
    });
});
describe("sleep CSV import (#96)", () => {
    const csv = "date,start,end\n2026-11-15,2026-11-15 23:30,2026-11-16 07:00\noops,not-a-time,neither\n";
    it("suggests Zepp-style mapping and previews without writing anything", async () => {
        const { db, userId } = await setup();
        expect(suggestSleepMapping(["date", "start", "end"])).toEqual({ date: "date", bed: "start", wake: "end" });
        const p = (await importSleepCsvPreview(db, userId, csv));
        expect(p.ok).toBe(1);
        expect(p.errors).toBe(1);
        expect(p.preview[0]!.minutes).toBe(450);
        expect(p.preview[1]!.error).toBeTruthy();
        expect((await db.select().from(sleepLogs)).length).toBe(0);
    });
    it("flags replaces, then import writes only valid rows as csv source", async () => {
        const { db, userId } = await setup();
        (await logSleep(db, userId, { date: "2026-11-15", bed: "23:00", wake: "06:00" }));
        const p = (await importSleepCsvPreview(db, userId, csv));
        expect(p.replaces).toBe(1);
        const r = (await importSleepCsv(db, userId, csv));
        expect(r.ok).toBe(1);
        expect(r.errors.length).toBe(1);
        const row = (await db.select().from(sleepLogs).where(eq(sleepLogs.date, "2026-11-15")).limit(1))[0]!;
        expect(row.source).toBe("csv");
        expect(row.minutes).toBe(450);
        expect((await eventTypes(db, userId))).toContain("sleep.imported");
    });
    it("custom mapping overrides the suggestion", async () => {
        const { db, userId } = await setup();
        const custom = "night,fell_asleep,wake_up\n2026-11-15,23:30,07:00\n";
        const p = (await importSleepCsvPreview(db, userId, custom, { date: "night", bed: "fell_asleep", wake: "wake_up" }));
        expect(p.ok).toBe(1);
        expect(p.preview[0]!.minutes).toBe(450);
    });
});
describe("habit shaping (#96)", () => {
    it("proposes +5 % (min +1) after 7 consecutive days and accepts once per step", async () => {
        const { db, userId } = await setup();
        const id = (await saveHabit(db, userId, { title: "Pages", pillar: "read", tiers: { seed: "1 page", standard: "20 pages" }, metric: { type: "count", standard: 20 }, anchor: "After breakfast", place: "Desk", status: "active" }, TODAY));
        for (let i = 0; i < 6; i++)
            (await logHabit(db, userId, id, `2026-11-${10 + i}`, "standard"));
        expect((await shapingView(db, userId, TODAY)).find((s) => s.habitId === id)!.propose).toBeNull();
        (await expect(acceptShaping(db, userId, id, TODAY)).rejects.toThrow(HabitLimit));
        (await logHabit(db, userId, id, TODAY, "standard"));
        const s = (await shapingView(db, userId, TODAY)).find((x) => x.habitId === id)!;
        expect(s.streak).toBe(7);
        expect(s.propose).toBe(21);
        (await acceptShaping(db, userId, id, TODAY));
        const h = (await shapingView(db, userId, TODAY)).find((x) => x.habitId === id)!;
        expect(h.currentTarget).toBe(21);
        expect((await eventTypes(db, userId))).toContain("shaping.accepted");
    });
});
describe("learning science (#89)", () => {
    it("pretest sets the a0 prior and respects the feature flag", async () => {
        const { db, userId } = await setup();
        (await seedChapter(db, "ch1", "math"));
        const r = (await logPretest(db, userId, { chapterId: "ch1", correct: 2, total: 4 }, TODAY));
        expect(r.a0).toBe(0.25);
        expect((await db.select().from(chapterState).where(eq(chapterState.chapterId, "ch1")).limit(1))[0]!.a0).toBe(0.25);
        (await expect(logPretest(db, userId, { chapterId: "ghost", correct: 1, total: 3 }, TODAY)).rejects.toThrow(LearningDenied));
        (await expect(logPretest(db, userId, { chapterId: "ch1", correct: 5, total: 3 }, TODAY)).rejects.toThrow());
        (await updateConfig(db, userId, { learning: { pretest: false } }, "pretest off for test"));
        (await expect(logPretest(db, userId, { chapterId: "ch1", correct: 1, total: 3 }, TODAY)).rejects.toThrow(LearningDenied));
    });
    it("mastery ladder reaches Legendary only with clear + round 3", async () => {
        const { db, userId } = await setup();
        (await seedChapter(db, "ch1", "math"));
        (await seedChapter(db, "ch2", "bio"));
        (await logPretest(db, userId, { chapterId: "ch1", correct: 1, total: 3 }, TODAY));
        (await db.insert(chapterState).values({ userId, chapterId: "ch2", clearedAt: NOW }));
        (await db.insert(reviewRounds).values({ id: newId(), userId, subjectId: "bio", round: 3, scheduledOn: TODAY, doneOn: TODAY, status: "done", createdAt: NOW }));
        const rows = (await masteryView(db, userId));
        expect(rows.find((r) => r.chapterId === "ch1")!.level).toBe(2);
        expect(rows.find((r) => r.chapterId === "ch2")!.level).toBe(4);
        expect(rows[0]!.level).toBeGreaterThanOrEqual(rows[rows.length - 1]!.level);
    });
    it("scheduler chains round 2/3 from round 1 completion, pending rounds only", async () => {
        const { db, userId } = await setup();
        (await seedChapter(db, "ch1", "math"));
        (await db.insert(reviewRounds).values({ id: newId(), userId, subjectId: "math", round: 1, scheduledOn: W1, doneOn: W1, status: "done", createdAt: NOW }));
        (await db.insert(reviewRounds).values({ id: newId(), userId, subjectId: "math", round: 2, scheduledOn: W1, status: "pending", createdAt: NOW }));
        (await db.insert(reviewRounds).values({ id: newId(), userId, subjectId: "math", round: 3, scheduledOn: W1, status: "done", doneOn: W1, createdAt: NOW }));
        expect((await applyScheduler(db, userId))).toBe(1);
        const r2 = (await db.select().from(reviewRounds).where(eq(reviewRounds.round, 2)).limit(1))[0]!;
        expect(r2.scheduledOn).toBe("2026-11-21");
        expect((await applyScheduler(db, userId))).toBe(0);
    });
    it("interleave view mixes up to 3 uncleared subjects", async () => {
        const { db, userId } = await setup();
        for (const [i, s] of ["math", "bio", "chem", "phys"].entries()) {
            (await seedChapter(db, `ch${i}`, s));
            (await db.insert(chapterState).values({ userId, chapterId: `ch${i}`, netPct: 30 + i }));
        }
        const v = (await interleaveView(db, userId, TODAY));
        expect(v.enabled).toBe(true);
        expect(v.chapters.length).toBe(3);
        expect(new Set(v.chapters.map((c) => c.subject)).size).toBe(3);
    });
});
describe("anchor reminders (#97)", () => {
    it("caps at maxPerDay, is idempotent, and marks read with an event", async () => {
        const { db, userId } = await setup();
        for (let i = 0; i < 4; i++)
            (await saveHabit(db, userId, { title: `Habit ${i}`, pillar: "mind", tiers: { seed: "s", standard: "st" }, metric: { type: "check" }, timeWindow: "07:30", anchor: `Anchor ${i}`, place: "Desk", status: "active" }, TODAY));
        expect((await ensureTodayReminders(db, userId, TODAY))).toBe(5);
        expect((await ensureTodayReminders(db, userId, TODAY))).toBe(0);
        const v = (await remindersView(db, userId, TODAY, new Date("2026-11-16T20:00:00Z")));
        expect(v.items.length).toBe(5);
        expect(v.unread).toBe(5);
        const after = (await markReminderRead(db, userId, v.items[0]!.id, TODAY));
        expect(after.unread).toBe(4);
        expect((await eventTypes(db, userId))).toContain("reminder.read");
    });
    it("fully switchable and hard-capped by config", async () => {
        const { db, userId } = await setup();
        (await updateConfig(db, userId, { reminders: { maxPerDay: 2 } }, "cap test"));
        expect((await ensureTodayReminders(db, userId, TODAY))).toBe(2);
        (await updateConfig(db, userId, { reminders: { enabled: false } }, "off test"));
        expect((await ensureTodayReminders(db, userId, "2026-11-17"))).toBe(0);
        expect((await remindersView(db, userId, "2026-11-17")).enabled).toBe(false);
    });
});
describe("AI adapter guard, caps and fallback (#92–#94)", () => {
    const remoteReview = { summary: "Week 1 was steady.", patterns: ["Core held 5 days."], oneChange: "Batch one concept-fix session.", errorGroups: [{ cause: "concept", count: 2, concepts: ["limit"], mission: "3 targeted tests on limit." }] };
    function mockFetchOk() {
        return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(remoteReview) } }], usage: { prompt_tokens: 120, completion_tokens: 60 } }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    async function enableAi(db: Db, userId: string, patch: Record<string, unknown> = {}) {
        vi.stubEnv("AI_KEY", "test-key");
        (await updateConfig(db, userId, { flags: { ai: true }, ai: { baseUrl: "https://ai.test/v1", ...patch } }, "ai on for test"));
    }
    it("uses the provider timeout env with a safe upper bound", () => {
        expect(aiRequestTimeoutMs()).toBe(15000);
        vi.stubEnv("AI_TIMEOUT_MS", "55000");
        expect(aiRequestTimeoutMs()).toBe(55000);
        vi.stubEnv("AI_TIMEOUT_MS", "250000");
        expect(aiRequestTimeoutMs()).toBe(120000);
    });
    it("uses Arvan's apikey authorization and environment model override", async () => {
        const { db, userId } = await setup();
        await enableAi(db, userId, { model: "database-model" });
        vi.stubEnv("AI_KEY", "apikey arvan-test-key");
        vi.stubEnv("AI_MODEL", "Gemma-4-31B-IT");
        const spy = mockFetchOk();
        const result = await weeklyReview(db, userId, TODAY);
        expect(result.provider).toBe("remote");
        const init = spy.mock.calls[0]![1] as RequestInit;
        expect((init.headers as Record<string, string>).authorization).toBe("apikey arvan-test-key");
        expect(JSON.parse(init.body as string).model).toBe("Gemma-4-31B-IT");
        expect((await aiStatus(db, userId, TODAY)).model).toBe("Gemma-4-31B-IT");
    });
    it("remote call sends only guarded aggregates and logs cost", async () => {
        const { db, userId } = await setup();
        await enableAi(db, userId);
        const spy = mockFetchOk();
        const r = await weeklyReview(db, userId, TODAY);
        expect(r.provider).toBe("remote");
        expect(r.review.summary).toBe(remoteReview.summary);
        const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string) as {
            messages: {
                role: string;
                content: string;
            }[];
        };
        const sent = JSON.parse(body.messages[1]!.content) as Record<string, unknown>;
        expect(Object.keys(sent).sort()).toEqual(["consistency", "hours", "sleepAvgHours", "testsNet", "topCauses", "weekNo", "xp"]);
        const log = (await aiCallLog(db, userId));
        expect(log[0]!.provider).toBe("remote");
        expect(log[0]!.costEst).toBeGreaterThan(0);
    });
    it("daily call cap forces the local provider without blocking", async () => {
        const { db, userId } = await setup();
        await enableAi(db, userId, { maxCallsPerDay: 1 });
        mockFetchOk();
        expect((await weeklyReview(db, userId, TODAY)).provider).toBe("remote");
        const second = await weeklyReview(db, userId, TODAY, true);
        expect(second.provider).toBe("local");
        expect(second.review.summary.length).toBeGreaterThan(0);
    });
    it("monthly cost cap blocks remote before any request", async () => {
        const { db, userId } = await setup();
        await enableAi(db, userId, { monthlyCostCapUsd: 0 });
        const spy = mockFetchOk();
        const r = await weeklyReview(db, userId, TODAY);
        expect(r.provider).toBe("local");
        expect(spy).not.toHaveBeenCalled();
    });
    it("provider failure falls back locally and logs the failed attempt", async () => {
        const { db, userId } = await setup();
        await enableAi(db, userId);
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
        const r = await weeklyReview(db, userId, TODAY);
        expect(r.provider).toBe("local");
        expect((await aiCallLog(db, userId)).some((c) => c.requestSummary.includes("failed attempt"))).toBe(true);
    });
    it("with AI off everything still works and anomaly alerts stay toggleable", async () => {
        const { db, userId } = await setup();
        const r = await weeklyReview(db, userId, TODAY);
        expect(r.provider).toBe("local");
        const a = await anomalyAlerts(db, userId, TODAY);
        expect(a.enabled).toBe(true);
        (await updateConfig(db, userId, { flags: { anomalyAlerts: false } }, "alerts off"));
        expect((await anomalyAlerts(db, userId, TODAY)).enabled).toBe(false);
    });
});
describe("analytics views (#95, #99, #100)", () => {
    it("forecast, rank and skip views degrade gracefully with no data", async () => {
        const { db, userId } = await setup();
        expect((await forecastView(db, userId, TODAY)).overall.n).toBe(0);
        expect((await rankView(db, userId, TODAY)).note).toMatch(/Assumed/);
        expect((await skipView(db, userId, TODAY)).p).toBeNull();
        expect((await skipView(db, userId, TODAY)).advice).toMatch(/Log a few timed sessions/);
    });
    it("what-if simulates drops/adds over the real remaining plan", async () => {
        const { db, userId } = await setup();
        (await seedChapter(db, "ch1", "math"));
        (await db.insert(weekPlanItems).values({ id: newId(), userId, weekNo: 1, chapterId: "ch1", subjectId: "math", tier: "M", plannedMin: 100, createdAt: NOW }));
        const base = (await whatIfView(db, userId, TODAY, [], []));
        expect(base.minutes).toBe(100);
        const dropped = (await whatIfView(db, userId, TODAY, ["ch1"], []));
        expect(dropped.minutes).toBe(0);
        expect(dropped.coverage).toBe(0);
        expect(dropped.forecast).toBeLessThan(base.forecast);
    });
});
describe("Weekly Wrapped (#98)", () => {
    it("builds six slides from real logged data only", async () => {
        const { db, userId } = await setup();
        (await db.insert(focusSessions).values({ id: newId(), userId, kind: "tests", status: "ended", startedAt: `${W1}T08:00:00Z`, minutes: 120, gameDay: "2026-11-15", createdAt: NOW, updatedAt: NOW }));
        (await seedTest(db, userId, "2026-11-15", 6, 2, 2));
        for (const d of [W1, "2026-11-15", TODAY, "2026-11-17", "2026-11-18"])
            (await db.insert(dayCloses).values({ id: newId(), userId, date: d, standardDay: true, coreTier: "standard", createdAt: NOW }));
        (await logSleep(db, userId, { date: "2026-11-15", bed: "23:30", wake: "06:30" }));
        (await logSleep(db, userId, { date: "2026-11-16", bed: "23:00", wake: "07:00" }));
        (await db.insert(errorItems).values({ id: newId(), userId, cause: "concept", takeaway: "limit definition mixed up", gameDay: "2026-11-15", createdAt: NOW, updatedAt: NOW }));
        (await awardGems(db, userId, 2, "gems.test", "grant", "2026-11-15"));
        const v = (await wrappedView(db, userId, W2, 1));
        expect(v.slides.length).toBe(6);
        expect(v.slides[0]!.stat).toBe("2 h");
        expect(v.slides[1]!.stat).toBe("53.3 %");
        expect(v.slides[2]!.stat).toBe("5/7");
        expect(v.slides[3]!.stat).toBe("7.5 h");
        expect(v.slides[4]!.lines[0]).toMatch(/concept/);
        expect(v.isCurrent).toBe(false);
        expect((await wrappedView(db, userId, W2)).week).toBe(1);
    });
});
