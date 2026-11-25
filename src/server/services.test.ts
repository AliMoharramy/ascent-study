import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { type Db } from "@/db/client";
import { memoryDb as isolatedDb, closeTestDb } from "@/db/testing";
import { afterEach } from "vitest";
const databases: Db[] = [];
async function memoryDb() { const db = await isolatedDb(); databases.push(db); return db; }
afterEach(async () => { for (const db of databases.splice(0))
    await closeTestDb(db); });
import { dailyCheckins, dayCloses, detours, focusSessions, lessons, mockExams, reviewCards, testLogs, users, xpLedger } from "@/db/schema";
import { listEvents } from "@/events/store";
import { createUser, csrfMatches, getSessionUser, login, logout, MAX_FAILED_LOGINS } from "./auth";
import { saveCheckin, CheckinLocked, getCheckin } from "./checkins";
import { configAt, csvRows, currentConfig, ensureDefaultConfig, getConfigVersion, importConfig, listConfigVersions, parseCsvRows, rollbackConfig, unknownConfigPaths, updateConfig } from "./config";
import { createCourse, getCourse, importLessons, listCourses, setLessonChapters, setLessonStatus } from "./courses";
import { FocusConflict, minutesForDay, openSession, pauseFocus, resumeFocus, startFocus, stopFocus, view } from "./focus";
import { commitDay0, day0Template, previewDay0 } from "./importDay0";
import { importSubjects, loadSubjectsFile } from "./seed";
import { deleteTestLog, logTest, testsForDay } from "./tests";
import { createBackup, importPortableArchive, listBackups, pruneBackups, verifyBackup, verifyRestoreIntoEmptyDb, createPortableArchive } from "./backup";
import { logMock } from "./arena";
import { dailyDeck } from "./forge";
import { createOffsiteBackup, decryptFile, listOffsite, restoreOffsite } from "./offsite";
import { detourLedger } from "./ideas";
import { hallOfFame } from "./hallOfFame";
async function setup(): Promise<{
    db: Db;
    userId: string;
}> {
    const db = (await memoryDb());
    const userId = await createUser(db, { username: "Ascender", name: "Ascender", password: "correct horse battery" });
    return { db, userId };
}
const t = (iso: string) => new Date(iso);
describe("auth (T-R0-03 / F-CORE-01)", () => {
    it("login → session → logout", async () => {
        const { db } = await setup();
        const r = await login(db, "ascender", "correct horse battery");
        expect(r.ok).toBe(true);
        if (!r.ok)
            return;
        const s = (await getSessionUser(db, r.token));
        expect(s?.user.username).toBe("ascender");
        expect(s!.user.passwordHash.startsWith("$argon2id$")).toBe(true);
        expect(csrfMatches(s!.csrfToken, r.csrf)).toBe(true);
        expect(csrfMatches(s!.csrfToken, "nope")).toBe(false);
        (await logout(db, r.token));
        expect((await getSessionUser(db, r.token))).toBeNull();
    });
    it("wrong password / unknown user → invalid", async () => {
        const { db } = await setup();
        expect(await login(db, "ascender", "wrong")).toEqual({ ok: false, reason: "invalid" });
        expect(await login(db, "nobody", "x")).toEqual({ ok: false, reason: "invalid" });
    });
    it(`locks after ${MAX_FAILED_LOGINS} failed attempts, even with the right password; unlocks after 15 min`, async () => {
        const { db } = await setup();
        const now = t("2026-11-14T10:00:00Z");
        for (let i = 0; i < MAX_FAILED_LOGINS - 1; i += 1)
            expect((await login(db, "ascender", "bad", undefined, now)).ok).toBe(false);
        const fifth = await login(db, "ascender", "bad", undefined, now);
        expect(fifth).toMatchObject({ ok: false, reason: "locked" });
        expect(await login(db, "ascender", "correct horse battery", undefined, now)).toMatchObject({ ok: false, reason: "locked" });
        expect((await login(db, "ascender", "correct horse battery", undefined, t("2026-11-14T10:16:00Z"))).ok).toBe(true);
    });
    it("sessions expire after 30 days", async () => {
        const { db } = await setup();
        const r = await login(db, "ascender", "correct horse battery", undefined, t("2026-11-14T10:00:00Z"));
        if (!r.ok)
            throw new Error();
        expect((await getSessionUser(db, r.token, t("2026-12-13T09:00:00Z")))).not.toBeNull();
        expect((await getSessionUser(db, r.token, t("2026-12-14T10:00:01Z")))).toBeNull();
    });
    it("rejects weak passwords", async () => {
        const db = (await memoryDb());
        await expect(createUser(db, { username: "a", name: "a", password: "short" })).rejects.toThrow(/10 characters/);
    });
});
describe("focus timer service (T-R0-06)", () => {
    it("start/pause/resume/stop persists minutes and events; only one open session", async () => {
        const { db, userId } = await setup();
        (await startFocus(db, userId, { kind: "video", subjectId: "ai" }, { now: t("2026-11-14T06:00:00Z") }));
        (await expect(startFocus(db, userId, {}, { now: t("2026-11-14T06:01:00Z") })).rejects.toThrow(FocusConflict));
        (await pauseFocus(db, userId, t("2026-11-14T06:20:00Z")));
        // "refresh": state is read back from the DB
        expect(view((await openSession(db, userId))!, t("2026-11-14T06:30:00Z")).minutes).toBe(20);
        (await resumeFocus(db, userId, t("2026-11-14T06:30:00Z")));
        const done = (await stopFocus(db, userId, t("2026-11-14T06:55:00Z")));
        expect(done.minutes).toBe(45);
        expect(done.gameDay).toBe("2026-11-14");
        expect((await openSession(db, userId))).toBeUndefined();
        expect((await minutesForDay(db, userId, "2026-11-14"))).toBe(45);
        expect((await listEvents(db, userId)).map((e) => e.type)).toEqual(["focus.started", "focus.paused", "focus.resumed", "focus.stopped"]);
    });
    it("a session at 01:30 Tehran counts for the previous day", async () => {
        const { db, userId } = await setup();
        const r = (await startFocus(db, userId, {}, { now: t("2026-11-13T22:00:00Z") }));
        expect(r.gameDay).toBe("2026-11-13");
    });
});
describe("test logging (T-R0-07)", () => {
    it("stores counts with net% and is idempotent on client_request_id", async () => {
        const { db, userId } = await setup();
        const a = (await logTest(db, userId, { correct: 7, wrong: 2, blank: 1, subjectId: "ai", clientRequestId: "req-1" }, { now: t("2026-11-14T08:00:00Z") }));
        const b = (await logTest(db, userId, { correct: 7, wrong: 2, blank: 1, subjectId: "ai", clientRequestId: "req-1" }, { now: t("2026-11-14T08:00:00Z") }));
        expect(a.netPct).toBe(63.33);
        expect(b.id).toBe(a.id);
        expect((await db.select().from(testLogs)).length).toBe(1);
        (await logTest(db, userId, { correct: 3, wrong: 0, blank: 0 }, { now: t("2026-11-14T09:00:00Z") }));
        const day = (await testsForDay(db, userId, "2026-11-14"));
        expect(day.count).toBe(13);
        expect((await deleteTestLog(db, userId, a.id))).toBe(true);
        expect((await testsForDay(db, userId, "2026-11-14")).count).toBe(3);
    });
    it("rejects empty or invalid logs", async () => {
        const { db, userId } = await setup();
        (await expect(logTest(db, userId, { correct: 0, wrong: 0, blank: 0 })).rejects.toThrow());
        (await expect(logTest(db, userId, { correct: -1, wrong: 0 })).rejects.toThrow());
    });
});
describe("nightly check-in (T-R0-08)", () => {
    it("upserts one row per day and saves fast", async () => {
        const { db, userId } = await setup();
        const now = t("2026-11-14T19:00:00Z");
        const t0 = performance.now();
        (await saveCheckin(db, userId, { energyMorning: 3, energyNoon: 4, energyNight: 2, blocker: "کلاس طولانی", escapeMinutes: 30, escapeKind: "coding", classAttended: true }, { now }));
        expect(performance.now() - t0).toBeLessThan(1000);
        (await saveCheckin(db, userId, { energyNight: 3 }, { now }));
        expect((await db.select().from(dailyCheckins)).length).toBe(1);
        expect((await getCheckin(db, userId, "2026-11-14"))!.energyNight).toBe(3);
    });
    it("editable for 24 h after the day ends, then locked", async () => {
        const { db, userId } = await setup();
        // day 2026-11-14 ends 2026-11-15 00:30Z; editable until 2026-11-16 00:30Z
        (await saveCheckin(db, userId, { date: "2026-11-14", energyNight: 2 }, { now: t("2026-11-16T00:00:00Z") }));
        (await expect(saveCheckin(db, userId, { date: "2026-11-14", energyNight: 2 }, { now: t("2026-11-16T01:00:00Z") })).rejects.toThrow(CheckinLocked));
    });
    it("validates energy range", async () => {
        const { db, userId } = await setup();
        (await expect(saveCheckin(db, userId, { energyMorning: 9 })).rejects.toThrow());
    });
});
describe("config versions (T-R1-03)", () => {
    it("v1 defaults; each change → new version + reason + event; old versions retrievable", async () => {
        const { db, userId } = await setup();
        expect((await ensureDefaultConfig(db, userId)).version).toBe(1);
        expect((await ensureDefaultConfig(db, userId)).version).toBe(1);
        const v2 = (await updateConfig(db, userId, { xp: { testCorrect: 0.7 } }, "Baseline calibration"));
        expect(v2.version).toBe(2);
        expect((await currentConfig(db, userId)).xp.testCorrect).toBe(0.7);
        expect((await getConfigVersion(db, userId, 1))!.config.xp.testCorrect).toBe(0.6);
        const ev = (await listEvents(db, userId, "config.changed"));
        expect(ev[0]!.payload).toMatchObject({ from: 1, to: 2, changed: ["xp.testCorrect"] });
        expect((await updateConfig(db, userId, { xp: { testCorrect: 0.7 } }, "no-op")).version).toBe(2);
        expect((await listConfigVersions(db, userId)).length).toBe(2);
        expect((await configAt(db, userId, "2000-01-01T00:00:00Z"))!.version).toBe(1);
    });
    it("rejects invalid values and missing reasons", async () => {
        const { db, userId } = await setup();
        (await expect(updateConfig(db, userId, { xp: { testCorrect: -1 } }, "bad")).rejects.toThrow());
        (await expect(updateConfig(db, userId, { xp: { testCorrect: 1 } }, "")).rejects.toThrow(/reason/));
    });
    it("rollback appends a new version with the old values; import merges and rejects unknown paths", async () => {
        const { db, userId } = await setup();
        (await updateConfig(db, userId, { xp: { testCorrect: 0.7 } }, "Raise tests"));
        const v3 = (await rollbackConfig(db, userId, 1, "Back to defaults"));
        expect(v3.version).toBe(3);
        expect((await currentConfig(db, userId)).xp.testCorrect).toBe(0.6);
        const ev = (await listEvents(db, userId, "config.changed")).at(-1)!;
        expect(ev.payload).toMatchObject({ from: 2, to: 3, rollbackTo: 1 });
        expect((await rollbackConfig(db, userId, 3, "same")).version).toBe(3);
        const v4 = (await importConfig(db, userId, { xp: { testCorrect: 0.62 }, gold: { weeklyBossDefeated: 30 } }, "Imported tuning"));
        expect(v4.version).toBe(4);
        expect((await currentConfig(db, userId)).xp.testCorrect).toBe(0.62);
        expect((await currentConfig(db, userId)).gold.weeklyBossDefeated).toBe(30);
        expect(unknownConfigPaths((await currentConfig(db, userId)), { xp: { bogus: 1 } })).toEqual(["xp.bogus"]);
        expect(unknownConfigPaths((await currentConfig(db, userId)), { xp: { testCorrect: 0.7 } })).toEqual([]);
    });
    it("CSV export shape and import round-trip", async () => {
        const { db, userId } = await setup();
        const rows = csvRows((await ensureDefaultConfig(db, userId)).config);
        expect(rows.find(([k]) => k === "xp.testCorrect")?.[1]).toBe("0.6");
        expect(rows.some(([k]) => k === "xp.chapterClearTierFactor.M")).toBe(true);
        const patch = parseCsvRows("xp.testCorrect,0.65\npipeline.stages,[1,3]\n");
        expect(patch).toEqual({ xp: { testCorrect: 0.65 }, pipeline: { stages: [1, 3] } });
        expect(() => parseCsvRows("not-a-row")).toThrow(/Invalid CSV/);
        expect(() => parseCsvRows("__proto__.polluted,1")).toThrow(/Invalid CSV key/);
    });
});
describe("courses & lessons (T-R1-02)", () => {
    it("imports 100 lessons quickly, tracks watch status and chapter links", async () => {
        const { db, userId } = await setup();
        (await importSubjects(db, loadSubjectsFile()));
        const id = (await createCourse(db, userId, { subjectId: "dsa", kind: "teaching", title: "DSA — teaching", speed: 1.5 }));
        const text = Array.from({ length: 100 }, (_, i) => `${i + 1}. Lesson ${i + 1} — 30:00`).join("\n");
        const t0 = performance.now();
        (await importLessons(db, userId, id, text));
        expect(performance.now() - t0).toBeLessThan(10000);
        const c = (await getCourse(db, id))!;
        expect(c.lessons.length).toBe(100);
        expect(c.course.sessions).toBe(100);
        expect(c.course.durationMin).toBe(3000);
        expect(c.course.estimated).toBe(false);
        const lessonRequestId = "lesson-done-once";
        (await setLessonStatus(db, userId, c.lessons[0]!.id, "done", lessonRequestId));
        (await setLessonStatus(db, userId, c.lessons[0]!.id, "done", lessonRequestId));
        expect((await listEvents(db, userId, "lesson.status_changed")).filter((event) => event.payload.lessonId === c.lessons[0]!.id)).toHaveLength(1);
        (await setLessonStatus(db, userId, c.lessons[1]!.id, "watching"));
        expect((await setLessonChapters(db, userId, c.lessons[0]!.id, ["dsa-4", "dsa-5", "nope-1"]))).toEqual(["dsa-4", "dsa-5"]);
        const listed = (await listCourses(db, "dsa")).find((x) => x.id === id)!;
        expect(listed.doneCount).toBe(1);
        expect(listed.doneMin).toBe(30);
        expect((await db.select().from(lessons).where(eq(lessons.id, c.lessons[0]!.id)).limit(1))[0]!.watchedAt).not.toBeNull();
        // append mode continues numbering
        (await importLessons(db, userId, id, "Bonus — 10:00", "append"));
        expect((await getCourse(db, id))!.lessons.at(-1)!.no).toBe(101);
    });
});
describe("Day-0 CSV import (T-R0-11)", () => {
    it("preview validates rows; commit is manual-flagged and idempotent", async () => {
        const { db, userId } = await setup();
        (await importSubjects(db, loadSubjectsFile()));
        const csv = [
            "date,wake,bed,study_blocks,study_subject,correct,wrong,blank,test_subject,energy_morning,energy_noon,energy_night,blocker,escape_minutes,escape_kind,class_attended,note",
            "1405/08/23,08:20,01:10,10:00-11:30; 23:30-00:30,ai,12,4,2,foundations,3,4,2,خستگی,45,coding,yes,",
            "۱۴۰۵-۰۸-۲۴,,,,,,,,,,,,,,,,",
            "2026-11-16,,,9-10,,,,,,,,,,,,,",
            "1405-08-30,,,,,,,,,9,,,,,,,",
        ].join("\n");
        const p = (await previewDay0(db, csv));
        expect(p.rows.length).toBe(2);
        expect(p.errors.map((e) => e.line)).toEqual([4, 5]);
        expect(p.rows[0]!.date).toBe("2026-11-14");
        expect(p.rows[0]!.blocks.map((b) => b.minutes)).toEqual([90, 60]);
        expect(p.summary).toEqual({ days: 2, studyMinutes: 150, tests: 18, checkins: 1 });
        const r = (await commitDay0(db, userId, p));
        expect(r.imported).toEqual(["2026-11-14", "2026-11-15"]);
        expect((await db.select().from(focusSessions)).every((f) => f.manual)).toBe(true);
        expect((await db.select().from(testLogs).limit(1))[0]!.manual).toBe(true);
        expect((await getCheckin(db, userId, "2026-11-14"))!.manual).toBe(true);
        expect((await commitDay0(db, userId, p)).skipped).toEqual(["2026-11-14"]);
    });
    it("template is a valid import", async () => {
        const { db } = await setup();
        (await importSubjects(db, loadSubjectsFile()));
        expect((await previewDay0(db, day0Template())).errors).toEqual([]);
    });
});
describe("exam simulator (F-LRN-01)", () => {
    it("stores counts + suspect marks only, and reports the exact net", async () => {
        const { db, userId } = await setup();
        (await db.insert(mockExams).values({ no: 1, dateJalali: "1404/08/23", questions: 4, minutes: 5, budgetJson: JSON.stringify({ ai: { questions: 2 }, discrete: { questions: 2 } }) }));
        const r = (await logMock(db, userId, { mockNo: 1, perSubject: { ai: { correct: 2, wrong: 0, blank: 0 }, discrete: { correct: 0, wrong: 1, blank: 1 } }, mode: "exam", suspects: 9, elapsedSec: 240 }, "2026-11-14"));
        expect(r.total).toBe(4);
        expect(r.suspects).toBe(4); // clamped to the number of questions
        expect(r.elapsedSec).toBe(240);
        expect(r.netPct).toBe(41.67); // (2 − 1/3) / 4
        const ev = (await listEvents(db, userId)).find((e) => e.type === "mock.logged")!;
        expect(JSON.parse(ev.payloadJson)).toMatchObject({ mode: "exam", suspects: 4, elapsedSec: 240 });
        expect(ev.payloadJson).not.toMatch(/question|prompt|stem/i);
    });
});
describe("daily review deck (F-LRN-16)", () => {
    it("puts due cards first, adds recent-error cards, dedupes and caps at ten", async () => {
        const { db, userId } = await setup();
        const cfg = (await ensureDefaultConfig(db, userId)).config;
        const now = "2026-11-10T08:00:00.000Z";
        const mk = async (id: string, dueOn: string, refType: string, createdAt: string) => (await db.insert(reviewCards).values({ id, userId, refType, refId: null, chapterId: null, front: "front", back: "back", step: -1, reps: 0, dueOn, createdAt, updatedAt: createdAt }));
        for (let i = 0; i < 3; i += 1)
            await mk(`due-${i}`, "2026-11-14", "error", now);
        await mk("recent-error", "2026-11-30", "error", "2026-11-15T08:00:00.000Z");
        await mk("manual-recent", "2026-11-30", "manual", "2026-11-15T08:00:00.000Z");
        for (let i = 0; i < 12; i += 1)
            await mk(`extra-${i}`, "2026-11-30", "error", `2026-11-${String(10 + i).padStart(2, "0")}T08:00:00.000Z`);
        const deck = (await dailyDeck(db, userId, "2026-11-16"));
        expect(deck).toHaveLength(10);
        expect(deck.slice(0, 3).every((c) => c.why === "due")).toBe(true);
        expect(deck.some((c) => c.id === "manual-recent")).toBe(false);
        expect(deck.filter((c) => c.id === "recent-error")).toHaveLength(1);
        expect(cfg.xp.reviewCard).toBeGreaterThan(0); // the deck feeds the existing capped review XP rule
    });
});
describe("escape pattern + anti-goal report (F-INS-04/09)", () => {
    it("reports study vs builder share and flags the 10% anti-goal ceiling", async () => {
        const { db, userId } = await setup();
        const day = "2026-11-12";
        const now = `${day}T18:00:00.000Z`;
        (await db.insert(focusSessions).values({ id: "f1", userId, kind: "video", status: "ended", startedAt: now, endedAt: now, minutes: 100, gameDay: day, createdAt: now, updatedAt: now }));
        const detour = async (id: string, kind: string, minutes: number, choice: "continue" | "later" | "study_first") => (await db.insert(detours).values({ id, userId, startedAt: now, gameDay: day, minutes, kind, reason: kind === "builder" ? "tweak the app" : null, wasPrompted: true, choice, createdAt: now }));
        await detour("d1", "builder", 15, "continue");
        await detour("d2", "video", 5, "study_first");
        const led = (await detourLedger(db, userId, "2026-11-16", 7));
        expect(led.studyMinutes).toBe(100);
        expect(led.builderMinutes).toBe(15);
        expect(led.totalMinutes).toBe(20);
        expect(led.sharePct).toBe(15);
        expect(led.overLimit).toBe(true);
        expect(led.topKinds[0]).toEqual({ kind: "builder", minutes: 15 });
        expect(led.studyFirst).toBe(1);
        // no study minutes → never divide by zero, never raise the warning
        const empty = (await detourLedger(db, userId, "2026-09-01", 7));
        expect(empty.sharePct).toBe(0);
        expect(empty.overLimit).toBe(false);
    });
});
describe("encrypted offsite backup (F-OPS-03)", () => {
    it("encrypts, prunes, restores into an empty database, and rejects a wrong key or tampering", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ascent-off-"));
        const off = path.join(dir, "offsite");
        const key = "correct horse offsite battery";
        try {
            const { db, userId } = await setup();
            await logTest(db, userId, { correct: 5, wrong: 0, blank: 0 });
            const t0 = Date.UTC(2026, 10, 14, 0, 0, 0);
            await createOffsiteBackup(db, { dir: off, passphrase: key, keep: 2, now: new Date(t0) });
            await createOffsiteBackup(db, { dir: off, passphrase: key, keep: 2, now: new Date(t0 + 1000) });
            const newest = await createOffsiteBackup(db, { dir: off, passphrase: key, keep: 2, now: new Date(t0 + 2000) });
            expect(listOffsite(off)).toHaveLength(2);
            // ciphertext must not look like a gzip/JSON archive
            expect(fs.readFileSync(newest.file).subarray(17).toString("latin1")).not.toContain("ascent-archive");
            const target = await memoryDb();
            const report = await restoreOffsite(target, newest.file, { passphrase: key });
            expect(report).toMatchObject({ verified: true, reloginRequired: true });
            expect(await target.select().from(testLogs)).toHaveLength(1);
            expect(await target.select().from(users)).toHaveLength(1);
            await expect(restoreOffsite(await memoryDb(), newest.file, { passphrase: "wrong key" })).rejects.toThrow(/decrypt|OFFSITE_KEY/);
            const bad = path.join(off, "tampered.json.gz.enc");
            const buf = fs.readFileSync(newest.file);
            buf[buf.length - 5] = buf[buf.length - 5]! ^ 0xff;
            fs.writeFileSync(bad, buf);
            expect(() => decryptFile(bad, path.join(dir, "tampered.json.gz"), key)).toThrow(/decrypt|damaged/);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
describe("hall of fame (F-INS-02)", () => {
    it("reads best XP day, best net and the longest standard-day streak", async () => {
        const { db, userId } = await setup();
        const xp = async (id: string, amount: number, day: string) => (await db.insert(xpLedger).values({ id, userId, amount, reason: "test", ruleKey: "xp.tests", weekId: day, gameDay: day, occurredAt: `${day}T12:00:00.000Z` }));
        await xp("x1", 80, "2026-11-10");
        await xp("x2", 120, "2026-11-11");
        await xp("x3", 10, "2026-11-11");
        const tl = async (id: string, day: string, correct: number, wrong: number, netPct: number) => (await db.insert(testLogs).values({ id, userId, subjectId: "ai", correct, wrong, blank: 0, netPct, gameDay: day, loggedAt: `${day}T12:00:00.000Z`, createdAt: `${day}T12:00:00.000Z`, updatedAt: `${day}T12:00:00.000Z` }));
        await tl("t1", "2026-11-10", 8, 2, 40);
        await tl("t2", "2026-11-11", 10, 0, 100);
        const close = async (date: string, standard: boolean) => (await db.insert(dayCloses).values({ id: `c-${date}`, userId, date, standardDay: standard, createdAt: `${date}T20:00:00.000Z` }));
        for (const d of ["2026-11-08", "2026-11-09", "2026-11-10"])
            await close(d, true);
        await close("2026-11-11", false);
        for (const d of ["2026-11-12", "2026-11-13"])
            await close(d, true);
        const h = (await hallOfFame(db, userId));
        expect(h.bestDayXp).toEqual({ day: "2026-11-11", xp: 130 });
        expect(h.bestNet).toMatchObject({ pct: 100, day: "2026-11-11", subjectId: "ai", correct: 10, wrong: 0 });
        expect(h.longestStandard).toEqual({ days: 3, from: "2026-11-08", to: "2026-11-10" });
        expect(h.standardDays).toBe(5);
    });
});
describe("backup & restore (T-R0-10)", () => {
    it("backs up a live DB, prunes to N, and restores the data into a fresh database", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ascent-bk-"));
        try {
            const { db, userId } = await setup();
            await logTest(db, userId, { correct: 5, wrong: 1, blank: 0 });
            const bdir = path.join(dir, "backups");
            const first = await createBackup(db, bdir, t("2026-11-14T00:00:00Z"));
            expect((await verifyBackup(first.file)).tables).toBeGreaterThan(5);
            for (let i = 1; i <= 4; i += 1)
                await createBackup(db, bdir, new Date(Date.UTC(2026, 10, 14 + i)));
            expect(listBackups(bdir).length).toBe(5);
            expect(pruneBackups(bdir, 3).length).toBe(2);
            expect(listBackups(bdir).length).toBe(3);
            // restore drill: the newest backup must rebuild the data in an empty database, verified
            const newest = listBackups(bdir)[0]!;
            const t0 = performance.now();
            const fresh = await memoryDb();
            const report = await verifyRestoreIntoEmptyDb(fresh, fs.readFileSync(newest.file));
            expect(performance.now() - t0).toBeLessThan(10 * 60000);
            expect(report.verified).toBe(true);
            expect((await fresh.select().from(testLogs)).length).toBe(1);
            expect((await fresh.select().from(users)).length).toBe(1);
            // the live database is untouched, and restoring over it needs an explicit confirmation
            const bytes = await createPortableArchive(db);
            await expect(importPortableArchive(db, bytes)).rejects.toThrow(/non.empty/i);
            await expect(importPortableArchive(db, bytes, { replace: true })).resolves.toMatchObject({ verified: true });
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
