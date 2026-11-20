import { describe, expect, it } from "vitest";
import { type Db } from "@/db/client";
import { memoryDb as isolatedDb, closeTestDb } from "@/db/testing";
import { afterEach } from "vitest";
const databases: Db[] = [];
async function memoryDb() { const db = await isolatedDb(); databases.push(db); return db; }
afterEach(async () => { for (const db of databases.splice(0))
    await closeTestDb(db); });
import { dayCloses, users } from "@/db/schema";
import { ensureDefaultConfig } from "./config";
import { importSubjects, loadSubjectsFile } from "./seed";
import { manualFocus } from "./focus";
import { logBuilder, builderView, LifeDenied, voteIdentity, identityVotesAll, saveTopic, advanceTopic, logExploration, explorationView, claimBoard, saveBond, logBond, logReading, bondsView } from "./life";
import { reviewRoundsView, ensureReviewRounds, setReviewRound } from "./reviews";
import { leagueView } from "./league";
import { saveStoryOverride, storyView } from "./story";
import { localToUtc } from "@/lib/time";
const DAY = "2026-11-24";
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
describe("life pillars services (#75–#85)", () => {
    it("identity votes upsert within the day and count both directions", async () => {
        const { db, userId } = (await setup());
        (await voteIdentity(db, userId, DAY, { vote: "for", note: "kept the promise" }));
        (await voteIdentity(db, userId, DAY, { vote: "against", note: "changed my mind" }));
        const v = (await identityVotesAll(db, userId, DAY));
        expect(v.rows).toHaveLength(1);
        expect(v.self).toMatchObject({ for: 0, against: 1, today: "against" });
    });
    it("exploration: trial needed, 10 % cap enforced, archived topics spend nothing", async () => {
        const { db, userId } = (await setup());
        const id = (await saveTopic(db, userId, DAY, { title: "Consensus", why: "curiosity", value: 4 }));
        (await expect(logExploration(db, userId, DAY, { topicId: id, minutes: 10 })).rejects.toThrow(LifeDenied));
        (await advanceTopic(db, userId, DAY, id, "trial"));
        (await manualFocus(db, userId, { day: "2026-11-22", start: "01:00", minutes: 600, kind: "video" }, { now: localToUtc(DAY, "12:00") }));
        const view = (await explorationView(db, userId, DAY));
        expect(view.budget.capMinutes).toBe(60);
        expect(view.budget.over).toBe(false);
        expect((await logExploration(db, userId, DAY, { topicId: id, minutes: 30, output: "notes" }))).toMatchObject({ remaining: 30 });
        expect((await logExploration(db, userId, DAY, { topicId: id, minutes: 30 }))).toMatchObject({ remaining: 0 });
        (await expect(logExploration(db, userId, DAY, { topicId: id, minutes: 20 })).rejects.toThrow(/10 %/));
        expect((await explorationView(db, userId, DAY)).target.sessions).toBe(2);
    });
    it("Builder Hour needs 70 % / 4 Core days, then pays 60 min and banks within cap", async () => {
        const { db, userId } = (await setup());
        (await expect(logBuilder(db, userId, DAY, { minutes: 30, built: "too early" })).rejects.toThrow(LifeDenied));
        for (const d of ["2026-11-21", "2026-11-22", "2026-11-23", DAY]) {
            (await db.insert(dayCloses).values({ id: `c${d}`, userId, date: d, coreTier: "standard", standardDay: true, createdAt: new Date().toISOString() }));
        }
        const v = (await builderView(db, userId, DAY));
        expect(v.eligible).toBe(true);
        expect(v.credit).toBe(60);
        expect((await logBuilder(db, userId, DAY, { minutes: 60, built: "a CLI that lists due cards" }))).toMatchObject({ minutes: 60 });
        expect((await builderView(db, userId, DAY)).sessions.length).toBe(1);
    });
    it("a fresh bond is due without a fake overdue count; one message clears it", async () => {
        const { db, userId } = (await setup());
        const id = (await saveBond(db, userId, { name: "Sara", relation: "Sister", reminderDays: 14 }));
        const before = (await bondsView(db, userId, DAY));
        expect(before.contacts[0]).toMatchObject({ sinceDays: null, due: true, overdue: 0 });
        expect(before.mission!.text).toBe("Send one real message to Sara. No streak, no penalty — just presence.");
        (await logBond(db, userId, DAY, { contactId: id, kind: "message" }));
        expect((await bondsView(db, userId, DAY)).contacts[0]).toMatchObject({ sinceDays: 0, due: false });
        expect((await bondsView(db, userId, DAY)).mission).toBeNull();
        (await logReading(db, userId, DAY, { book: "Deep Work", pages: 10 }));
        expect((await bondsView(db, userId, DAY)).bedtime.book).toBe("Deep Work");
    });
    it("Quest Board never pays halfway", async () => {
        const { db, userId } = (await setup());
        (await expect(claimBoard(db, userId, DAY)).rejects.toThrow(LifeDenied));
    });
    it("three review rounds per active subject; round 3 closes the chain", async () => {
        const { db, userId } = (await setup());
        (await ensureReviewRounds(db, userId, DAY));
        const v = (await reviewRoundsView(db, userId, DAY));
        expect(v.rounds.length).toBeGreaterThan(0);
        expect(v.rounds.length % 3).toBe(0);
        expect(v.due.length).toBe(v.rounds.filter((r) => r.round === 1).length);
        const r1 = v.bySubject[0]!.rounds[0]!;
        (await setReviewRound(db, userId, r1.id, "done", DAY, "retold from memory"));
        const after = (await reviewRoundsView(db, userId, DAY));
        expect(after.done).toBe(1);
        expect(after.bySubject[0]!.rounds[0]!.note).toBe("retold from memory");
    });
    it("story overrides only the chosen chapter and keeps the authored text otherwise", async () => {
        const { db, userId } = (await setup());
        const before = (await storyView(db, userId, DAY));
        (await saveStoryOverride(db, userId, { chapterNo: before.currentNo, startText: "My own opening.", endText: "" }));
        const after = (await storyView(db, userId, DAY));
        expect(after.chapter.start).toBe("My own opening.");
        expect(after.chapter.end).toBe(before.chapter.end);
        expect(after.overridden).toContain(before.currentNo);
    });
    it("Ghost League opens after week 1 with nine labelled ghosts and a ten-row board", async () => {
        const { db, userId } = (await setup());
        const v = (await leagueView(db, userId, DAY));
        expect(v.enabled).toBe(true);
        if (!v.enabled)
            return;
        expect(v.tier).toBe(1);
        expect(v.ghosts).toHaveLength(9);
        expect(v.ghosts.every((g) => g.ghost && g.name.length > 0)).toBe(true);
        expect(v.board).toHaveLength(10);
        expect(v.board.filter((r) => !r.ghost)).toHaveLength(1);
        expect(v.board.find((r) => !r.ghost)!.name).toBe("You");
    });
});
