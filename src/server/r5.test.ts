import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Db } from "@/db/client";
import { memoryDb as isolatedDb, closeTestDb } from "@/db/testing";
import { afterEach } from "vitest";
const databases: Db[] = [];
async function memoryDb() { const db = await isolatedDb(); databases.push(db); return db; }
afterEach(async () => { for (const db of databases.splice(0))
    await closeTestDb(db); });
import { chapterState, chapters, errorItems, events, focusSessions, ideas, pushSubscriptions, reviewRounds, reviews, subjects, testLogs, wellnessLogs, bosses } from "@/db/schema";
import { addDaysIso } from "@/i18n/jalali";
import { EXAM_DATE } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";
import { createUser } from "./auth";
import { bossShareView, logBossResult } from "./arena";
import { updateConfig } from "./config";
import { finalReviewPlan, finalView, logBreath } from "./final";
import { saveArtifact } from "./forge";
import { dispatchReminders, notifyView, sendPush, subscribePush, unsubscribePush } from "./notify";
import { resetRateLimits, takeToken } from "./ratelimit";
import { sheetsView } from "./sheets";
import { replaySync } from "./sync";
/** R5 final polish (#107–#115): offline sync, notifications, final ascent, sheets, share cards. */
async function setup(): Promise<{
    db: Db;
    userId: string;
}> {
    const db = (await memoryDb());
    const userId = await createUser(db, { username: "Ascender", name: "Ascender", password: "correct horse battery" });
    return { db, userId };
}
const TODAY = "2026-11-16";
const opts = { tz: "Asia/Tehran", rolloverHour: 4, today: TODAY };
const at = (h: number) => `${TODAY}T${String(h).padStart(2, "0")}:00:00.000Z`;
const eventTypes = async (db: Db, userId: string) => (await db.select({ t: events.type }).from(events).where(eq(events.userId, userId))).map((r) => r.t);
// ── #107 offline sync queue ──────────────────────────────────
describe("offline sync replay (#107)", () => {
    it("applies quick logs on their original game day and logs sync.replay", async () => {
        const { db, userId } = await setup();
        const r = (await replaySync(db, userId, {
            items: [
                { id: "req-1", kind: "test", body: { correct: 8, wrong: 2, blank: 0 }, createdAt: at(8) },
                { id: "req-2", kind: "idea", body: { action: "park", text: "Try interleaving math" }, createdAt: at(9) },
                { id: "req-3", kind: "error", body: { cause: "calc", takeaway: "Carry the sign through" }, createdAt: at(10) },
            ],
        }, opts));
        expect(r.applied).toBe(3);
        expect(r.results.every((x) => x.status === "applied")).toBe(true);
        const log = (await db.select().from(testLogs).where(eq(testLogs.userId, userId)).limit(1))[0]!;
        expect(log.gameDay).toBe(TODAY);
        expect(log.correct).toBe(8);
        expect((await db.select().from(ideas).where(eq(ideas.userId, userId)))).toHaveLength(1);
        expect((await db.select().from(errorItems).where(eq(errorItems.userId, userId)))).toHaveLength(1);
        const replay = (await db.select().from(events).where(and(eq(events.userId, userId), eq(events.type, "sync.replay"))).limit(1))[0]!;
        expect(JSON.parse(replay.payloadJson)).toMatchObject({ received: 3, applied: 3, duplicates: 0, conflicts: 0, invalid: 0 });
    });
    it("is idempotent: a second replay of the same request ids changes nothing", async () => {
        const { db, userId } = await setup();
        const items = [{ id: "req-1", kind: "test" as const, body: { correct: 5, wrong: 1, blank: 0 }, createdAt: at(8) }];
        (await replaySync(db, userId, { items }, opts));
        const r2 = (await replaySync(db, userId, { items }, opts));
        expect(r2.duplicates).toBe(1);
        expect(r2.applied).toBe(0);
        expect((await db.select().from(testLogs).where(eq(testLogs.userId, userId)))).toHaveLength(1);
        expect((await eventTypes(db, userId)).filter((t) => t === "test.logged")).toHaveLength(1);
    });
    it("wellness LWW: server-newer check-in wins and the conflict is logged; offline-newer applies", async () => {
        const { db, userId } = await setup();
        (await db.insert(wellnessLogs).values({ userId, date: TODAY, mood: 5, energy: 5, updatedAt: at(12) }));
        const stale = (await replaySync(db, userId, { items: [{ id: "w-1", kind: "wellness", body: { mood: 2, energy: 2 }, createdAt: at(8) }] }, opts));
        expect(stale.results[0]!.status).toBe("conflict");
        expect((await db.select().from(wellnessLogs).where(eq(wellnessLogs.userId, userId)).limit(1))[0]!.mood).toBe(5);
        const fresh = (await replaySync(db, userId, { items: [{ id: "w-2", kind: "wellness", body: { mood: 3, energy: 4 }, createdAt: at(13) }] }, opts));
        expect(fresh.results[0]!.status).toBe("applied");
        expect((await db.select().from(wellnessLogs).where(eq(wellnessLogs.userId, userId)).limit(1))[0]!.mood).toBe(3);
        const replay = (await db.select().from(events).where(and(eq(events.userId, userId), eq(events.type, "sync.replay")))).at(-1)!;
        expect(JSON.parse(replay.payloadJson).items[0]).toMatchObject({ id: "w-2", status: "applied" });
    });
    it("nightly review LWW: stale replay keeps the newer server review", async () => {
        const { db, userId } = await setup();
        (await db.insert(reviews).values({ id: "r1", userId, kind: "nightly", date: TODAY, json: JSON.stringify({ spark: "server", envDone: [] }), createdAt: at(12), updatedAt: at(12) }));
        const r = (await replaySync(db, userId, { items: [{ id: "n-1", kind: "nightly", body: { action: "nightly", spark: "offline", envDone: [] }, createdAt: at(8) }] }, opts));
        expect(r.results[0]!.status).toBe("conflict");
        const row = (await db.select().from(reviews).where(and(eq(reviews.userId, userId), eq(reviews.kind, "nightly"))).limit(1))[0]!;
        expect(JSON.parse(row.json).spark).toBe("server");
    });
    it("manual focus replays with its original timestamp; invalid bodies are reported, not dropped silently", async () => {
        const { db, userId } = await setup();
        const r = (await replaySync(db, userId, {
            items: [
                { id: "f-1", kind: "focus", body: { day: TODAY, start: "08:00", minutes: 45, kind: "tests" }, createdAt: at(10) },
                { id: "bad-1", kind: "test", body: { correct: -5, wrong: 0 }, createdAt: at(8) },
                { id: "bad-2", kind: "idea", body: { action: "park", text: "x" }, createdAt: "not-a-date" },
            ],
        }, opts));
        expect(r.results[0]!.status).toBe("applied");
        expect(r.results[1]!.status).toBe("invalid");
        expect(r.results[2]!.status).toBe("invalid");
        expect((await db.select().from(focusSessions).where(eq(focusSessions.userId, userId)))).toHaveLength(1);
        expect((await db.select().from(testLogs).where(eq(testLogs.userId, userId)))).toHaveLength(0);
        const replay = (await db.select().from(events).where(and(eq(events.userId, userId), eq(events.type, "sync.replay"))).limit(1))[0]!;
        expect(JSON.parse(replay.payloadJson)).toMatchObject({ applied: 1, invalid: 2 });
    });
    it("parkIdea dedupes on clientRequestId (offline idea capture)", async () => {
        const { db, userId } = await setup();
        const { parkIdea } = await import("./ideas");
        const a = (await parkIdea(db, userId, { text: "Same idea", clientRequestId: "idea-req" }));
        const b = (await parkIdea(db, userId, { text: "Same idea", clientRequestId: "idea-req" }));
        expect(a).toBe(b);
        expect((await db.select().from(ideas).where(eq(ideas.userId, userId)))).toHaveLength(1);
    });
});
// ── #109 notifications (opt-in push + telegram) ──────────────
describe("notifications (#109)", () => {
    const sub = { endpoint: "https://push.example.com/sub/1", keys: { p256dh: "BPkey", auth: "authsecret" } };
    it("push waits for browser consent while Telegram is enabled but unlinked; push subscriptions upsert", async () => {
        const { db, userId } = await setup();
        const v0 = (await notifyView(db, userId));
        expect(v0.push.enabled).toBe(false);
        expect(v0.telegram.enabled).toBe(true);
        expect(v0.push.publicKey).toMatch(/^B/);
        (await subscribePush(db, userId, sub));
        (await subscribePush(db, userId, { ...sub, keys: { p256dh: "BPkey2", auth: "auth2" } }));
        expect((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)))).toHaveLength(1);
        expect((await notifyView(db, userId)).push.devices).toBe(1);
        (await unsubscribePush(db, userId));
        expect((await notifyView(db, userId)).push.devices).toBe(0);
    });
    it("dispatch stays silent while channels are off, and respects the daily cap + dedupe", async () => {
        const { db, userId } = await setup();
        expect(await dispatchReminders(db, userId, TODAY, new Date(`${TODAY}T20:00:00Z`))).toBe(0);
        (await updateConfig(db, userId, { notifications: { push: { enabled: true } }, reminders: { enabled: true, tone: "calm", maxPerDay: 2 } }, "test opt-in"));
        // no devices registered → sendPush is a no-op, but the cap/dedupe bookkeeping still runs
        const n1 = await dispatchReminders(db, userId, TODAY, new Date(`${TODAY}T20:00:00Z`));
        expect(n1).toBe(2);
        const n2 = await dispatchReminders(db, userId, TODAY, new Date(`${TODAY}T21:00:00Z`));
        expect(n2).toBe(0);
    });
    it("sendPush with no subscriptions sends nothing and logs nothing", async () => {
        const { db, userId } = await setup();
        const r = await sendPush(db, userId, { title: "t", body: "b" });
        expect(r).toEqual({ sent: 0, failed: 0 });
        expect((await eventTypes(db, userId))).not.toContain("notify.sent");
    });
});
// ── #110 rate limiting ───────────────────────────────────────
describe("token-bucket rate limiter (#110)", () => {
    it("allows a burst, blocks the next call, refills over time", () => {
        resetRateLimits();
        const t0 = 1000000;
        for (let i = 0; i < 10; i++)
            expect(takeToken("login:test", 10, 1, t0).ok).toBe(true);
        const blocked = takeToken("login:test", 10, 1, t0);
        expect(blocked.ok).toBe(false);
        expect(blocked.retryAfterSec).toBeGreaterThan(0);
        expect(takeToken("login:test", 10, 1, t0 + 60000).ok).toBe(true);
        expect(takeToken("other:key", 10, 1, t0).ok).toBe(true);
    });
});
// ── #112 Final Ascent + last-7 review plan + anxiety toolkit ──
async function seedWeakChapter(db: Db, userId: string, id: string, netPct: number) {
    const now = nowIso();
    (await db.insert(subjects).values({ id: "dsa", nameFa: "درس", nameEn: "DSA", group: "core", status: "active", sort: 0, updatedAt: now }).onConflictDoNothing());
    (await db.insert(chapters).values({ id, subjectId: "dsa", no: Number(id.replace(/\D/g, "")) || 1, title: `Chapter ${id}`, updatedAt: now }));
    (await db.insert(chapterState).values({ chapterId: id, userId, netPct }));
}
describe("Final Ascent mode (#112)", () => {
    it("activates in the last 7 days; the plan is review-only and the exam eve is pack-and-rest", async () => {
        const { db, userId } = await setup();
        (await seedWeakChapter(db, userId, "ch1", 20));
        (await seedWeakChapter(db, userId, "ch2", 35));
        const today = addDaysIso(EXAM_DATE, -5);
        const v = (await finalView(db, userId, today));
        expect(v.ascent.active).toBe(true);
        expect(v.ascent.reviewPlan).toHaveLength(5);
        expect(v.ascent.reviewPlan[0]!.afternoon).toContain("Chapter ch1"); // weakest first
        expect(v.ascent.reviewPlan[0]!.afternoon).toContain("familiar questions");
        const eve = v.ascent.reviewPlan.at(-1)!;
        expect(eve.examEve).toBe(true);
        expect(eve.date).toBe(addDaysIso(EXAM_DATE, -1));
        expect(eve.afternoon).toContain("Pack the bag");
        expect(eve.afternoon).not.toContain("familiar questions");
        expect((await finalView(db, userId, TODAY)).ascent.active).toBe(false); // week 1, far from exam
    });
    it("overdue review rounds land on day 1; rounds past the window compress into the last day", async () => {
        const { db, userId } = await setup();
        const today = addDaysIso(EXAM_DATE, -4);
        const now = nowIso();
        (await db.insert(subjects).values({ id: "toc", nameFa: "درس", nameEn: "TOC", group: "core", status: "active", sort: 0, updatedAt: now }));
        (await db.insert(reviewRounds).values({ id: newId(), userId, subjectId: "toc", round: 1, scheduledOn: addDaysIso(today, -3), status: "pending", createdAt: now }));
        (await db.insert(reviewRounds).values({ id: newId(), userId, subjectId: "toc", round: 2, scheduledOn: addDaysIso(EXAM_DATE, 2), status: "pending", createdAt: now }));
        const plan = (await finalReviewPlan(db, userId, today));
        expect(plan).toHaveLength(4);
        expect(plan[0]!.morning).toContain("TOC R1");
        expect(plan.at(-1)!.morning).toContain("TOC R2");
    });
    it("a completed breathing run logs final.breath (never scored) and counts up", async () => {
        const { db, userId } = await setup();
        const r = (await logBreath(db, userId, { cycles: 11, seconds: 176 }, TODAY));
        expect(r.breathsDone).toBe(1);
        const ev = (await db.select().from(events).where(and(eq(events.userId, userId), eq(events.type, "final.breath"))).limit(1))[0]!;
        expect(JSON.parse(ev.payloadJson)).toEqual({ cycles: 11, seconds: 176 });
        expect((await logBreath(db, userId, { cycles: 11, seconds: 176 }, TODAY)).breathsDone).toBe(2);
        (await expect(logBreath(db, userId, { cycles: 0, seconds: 176 }, TODAY)).rejects.toThrow());
        expect((await finalView(db, userId, TODAY)).ascent.breathsDone).toBe(2);
    });
});
// ── #113 cheat-sheet builder ─────────────────────────────────
describe("cheat-sheet builder (#113)", () => {
    it("groups artifacts per subject, filters by chapter, keeps unfiled, excludes dropped subjects", async () => {
        const { db, userId } = await setup();
        (await seedWeakChapter(db, userId, "ch1", 50));
        (await seedWeakChapter(db, userId, "ch2", 60));
        const now = nowIso();
        (await db.insert(subjects).values({ id: "toc", nameFa: "درس", nameEn: "TOC", group: "core", status: "active", sort: 1, updatedAt: now }));
        (await db.insert(chapters).values({ id: "ch3", subjectId: "toc", no: 1, title: "Chapter ch3", updatedAt: now }));
        (await saveArtifact(db, userId, { title: "DSA sheet 1", bodyMd: "# Key\n- a", chapterId: "ch1" }, TODAY));
        (await saveArtifact(db, userId, { title: "DSA sheet 2", bodyMd: "b", chapterId: "ch2" }, TODAY));
        (await saveArtifact(db, userId, { title: "DSA unfiled", bodyMd: "c" }, TODAY));
        (await saveArtifact(db, userId, { title: "TOC sheet", bodyMd: "d", chapterId: "ch3" }, TODAY));
        const all = (await sheetsView(db, userId));
        expect(all.catalog.map((c) => c.id)).toEqual(["dsa", "toc", "general"]);
        expect(all.sheets).toHaveLength(3);
        expect(all.sheets[0]!.artifacts).toHaveLength(2);
        expect(all.sheets[0]!.artifacts[0]!.title).toBe("DSA sheet 1"); // chapter order
        expect(all.sheets[2]!.artifacts.map((a) => a.title)).toEqual(["DSA unfiled"]); // unfiled gets its own General page
        const filtered = (await sheetsView(db, userId, { subjects: ["dsa"], chapters: ["ch1"] }));
        expect(filtered.sheets).toHaveLength(1);
        expect(filtered.sheets[0]!.artifacts.map((a) => a.title)).toEqual(["DSA sheet 1"]);
        expect((await sheetsView(db, userId, { subjects: [] })).sheets).toHaveLength(0);
        expect((await sheetsView(db, userId, { chapters: [] })).sheets.every((s) => s.artifacts.every((a) => !a.chapterId))).toBe(true);
        (await db.update(subjects).set({ status: "dropped" }).where(eq(subjects.id, "toc")));
        expect((await sheetsView(db, userId)).catalog.map((c) => c.id)).toEqual(["dsa", "general"]);
    });
});
// ── #114 shareable boss result card ──────────────────────────
describe("boss share card data (#114)", () => {
    it("exposes only net/verdict/week/date by default plus an opt-in breakdown; never personal data", async () => {
        const { db, userId } = await setup();
        (await seedWeakChapter(db, userId, "ch1", 50));
        const now = nowIso();
        const bossId = newId();
        (await db.insert(bosses).values({ id: bossId, userId, kind: "weekly", weekNo: 5, scheduledFor: TODAY, specJson: "{}", thresholdPct: 50, status: "scheduled", createdAt: now, updatedAt: now }));
        (await logBossResult(db, userId, bossId, { results: [{ chapterId: "ch1", correct: 8, wrong: 2, blank: 0 }] }, TODAY));
        const v = (await bossShareView(db, userId, bossId));
        expect(v.netPct).toBeCloseTo(73.3, 1);
        expect(v.defeated).toBe(true);
        expect(v.weekNo).toBe(5);
        expect(v.date).toBe(TODAY);
        expect(v.perChapter).toEqual([{ chapterId: "ch1", title: "Chapter ch1", subject: "DSA", netPct: expect.closeTo(73.3, 1) }]);
        expect(JSON.stringify(v)).not.toContain("Ascender"); // no username anywhere in the payload
        (await expect(bossShareView(db, userId, "nope")).rejects.toThrow("Unknown boss result"));
    });
});
