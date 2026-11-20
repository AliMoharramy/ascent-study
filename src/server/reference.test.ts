import { describe, expect, it } from "vitest";
import { type Db } from "@/db/client";
import { memoryDb as isolatedDb, closeTestDb } from "@/db/testing";
import { afterEach } from "vitest";
const databases: Db[] = [];
async function memoryDb() { const db = await isolatedDb(); databases.push(db); return db; }
afterEach(async () => { for (const db of databases.splice(0))
    await closeTestDb(db); });
import { examStructure, testSources } from "@/db/schema";
import { importExamStructure, importSubjects, importTestSources, loadSubjectsFile } from "./seed";
import { examView, listTestSources, purchasedTestCounts, setTestSourcePurchased } from "./reference";
describe("exam structure seed (issue #3)", () => {
    it("registers coefficients 1/2/4 with shares summing to 1", async () => {
        const db = (await memoryDb());
        expect((await importExamStructure(db))).toBe(true);
        const e = (await examView(db))!;
        expect(e.yearJalali).toBe(1406);
        expect(e.groupCode).toBe(1277);
        expect(e.groups.map((g) => g.coefficient)).toEqual([1, 2, 4]);
        expect(e.groups.reduce((s, g) => s + g.share, 0)).toBeCloseTo(1, 6);
        expect(e.groups.find((g) => g.id === "specialized")!.share).toBeCloseTo(4 / 7, 6);
        expect(e.coefficientsSourceUrl).toMatch(/^https:\/\/cshub\.ir\//);
    });
    it("keeps question counts flagged as assumed and covers every subject", async () => {
        const db = (await memoryDb());
        (await importExamStructure(db));
        const e = (await examView(db))!;
        expect(e.countsAssumed).toBe(true);
        expect(e.totalQuestions).toBe(115);
        expect(e.durationMin).toBe(250);
        expect(e.wrongPenalty).toBeCloseTo(0.333, 3);
        const subjects = loadSubjectsFile().subjects.map((s) => s.id);
        for (const id of subjects)
            expect(e.perSubject[id], id).toBeGreaterThan(0);
        expect(Object.values(e.perSubject).reduce((a, b) => a + b, 0)).toBe(e.totalQuestions);
    });
    it("is idempotent (one row per exam year)", async () => {
        const db = (await memoryDb());
        (await importExamStructure(db));
        (await importExamStructure(db));
        expect((await db.select().from(examStructure))).toHaveLength(1);
    });
});
describe("test-bank sources seed (issue #13)", () => {
    // test_sources.subject_id references subjects, so subjects must exist first (importSubjects guarantees this).
    const seeded = async () => {
        const db = (await memoryDb());
        (await importSubjects(db, loadSubjectsFile(), { weights: false }));
        return db;
    };
    it("imports the user's real cshub dashboard counts", async () => {
        const db = await seeded();
        expect((await importTestSources(db))).toBe(12);
        const counts = (await purchasedTestCounts(db));
        expect(counts.english).toBe(1638);
        expect(counts.discrete).toBe(1516);
        expect(counts.dsa).toBe(3002); // both bank rows: 2112 + 890
        expect(counts.foundations).toBe(769);
        expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(9964);
        expect(counts.linear_algebra).toBeUndefined(); // dropped subject, not purchased
    });
    it("keeps the syllabus warning on the algorithms row", async () => {
        const db = await seeded();
        (await importTestSources(db));
        const row = (await listTestSources(db, "dsa")).find((s) => s.id === "cshub-algorithms")!;
        expect(row.approxCount).toBe(890);
        expect(row.note).toMatch(/هشدار سرفصل/);
    });
    it("re-seeding updates counts but never clobbers a user purchase toggle", async () => {
        const db = await seeded();
        (await importTestSources(db));
        (await setTestSourcePurchased(db, "cshub-linear-algebra", true));
        (await importTestSources(db));
        expect((await listTestSources(db)).find((s) => s.id === "cshub-linear-algebra")!.purchased).toBe(true);
        expect((await importTestSources(db))).toBe(0); // nothing new inserted
        expect((await db.select().from(testSources))).toHaveLength(12);
    });
    it("rejects an unknown source id", async () => {
        const db = await seeded();
        (await importTestSources(db));
        (await expect(setTestSourcePurchased(db, "nope", true)).rejects.toThrow(/Unknown test source/));
    });
    it("runs as part of the full seed import", async () => {
        const db = (await memoryDb());
        (await importSubjects(db, loadSubjectsFile()));
        expect((await examView(db))).not.toBeNull();
        expect((await listTestSources(db))).toHaveLength(12);
    });
});
