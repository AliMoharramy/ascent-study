import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { queryOne, type Db } from "@/db/client";
import { closeTestDb, memoryDb } from "@/db/testing";
import { chapters, courses, events, lessonChapters, lessons, subjects, testSources, users } from "@/db/schema";
import { importSubjects, loadSubjectsFile, seedCounts } from "./seed";

const opened: Db[] = [];
async function fixture() {
  const db = await memoryDb();
  opened.push(db);
  const now = "2026-01-01T00:00:00.000Z";
  await db.insert(users).values({ id: "seed-owner", username: "seed-owner", name: "Seed Owner", passwordHash: "test-only", createdAt: now, updatedAt: now });
  return db;
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map(closeTestDb));
});

const file = loadSubjectsFile();

describe("atomic PostgreSQL seed import", () => {
  it("rolls back base rows, supplemental rows and the event when a late supplemental insert fails", async () => {
    const db = await fixture();
    await db.execute(sql`CREATE FUNCTION reject_seed_source() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'supplemental insert rejected'; END;
    $$`);
    await db.execute(sql`CREATE TRIGGER reject_seed_source BEFORE INSERT ON test_sources
      FOR EACH ROW EXECUTE FUNCTION reject_seed_source()`);
    await expect(importSubjects(db, file, { userId: "seed-owner" })).rejects.toThrow();
    expect(await seedCounts(db)).toEqual({ subjects: 0, chapters: 0, activeChapters: 0, requiredChapters: 0, courses: 0 });
    for (const table of ["lessons", "lesson_chapters", "prereqs", "mock_exams", "exam_structure", "test_sources", "events"]) {
      expect(await queryOne(db, sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`)).toEqual({ n: 0 });
    }
  });

  it("preserves watched/user-imported lessons, tier locks, course edits and purchases while backfilling links", async () => {
    const db = await fixture();
    await importSubjects(db, file, { userId: "seed-owner" });
    const now = "2026-02-01T00:00:00.000Z";
    await db.update(lessons).set({ status: "done", watchedAt: now, title: "My lesson", durationMin: 42 }).where(eq(lessons.id, "ai-teach-l1"));
    await db.insert(lessons).values({ id: "my-import", courseId: "dsa-teach", no: 1, title: "My imported lesson", durationMin: 99, status: "watching", createdAt: now, updatedAt: now });
    await db.update(chapters).set({ tier: "M", tierLocked: true, eqWeight: 0.123 }).where(eq(chapters.id, "ai-3"));
    await db.update(courses).set({ title: "My course", speed: 2.5 }).where(eq(courses.id, "ai-teach"));
    const source = (await db.select().from(testSources).limit(1))[0]!;
    await db.update(testSources).set({ purchased: !source.purchased }).where(eq(testSources.id, source.id));
    await db.delete(lessonChapters).where(eq(lessonChapters.lessonId, "ai-teach-l1"));
    const beforeLesson = (await db.select().from(lessons).where(eq(lessons.id, "ai-teach-l1")))[0];
    const beforeImported = (await db.select().from(lessons).where(eq(lessons.id, "my-import")))[0];
    const beforeCourse = (await db.select().from(courses).where(eq(courses.id, "ai-teach")))[0];
    expect((await importSubjects(db, file, { userId: "seed-owner" })).inserted).toEqual({ subjects: 0, chapters: 0, courses: 0 });
    expect((await db.select().from(lessons).where(eq(lessons.id, "ai-teach-l1")))[0]).toEqual(beforeLesson);
    expect((await db.select().from(lessons).where(eq(lessons.id, "my-import")))[0]).toEqual(beforeImported);
    expect((await db.select().from(courses).where(eq(courses.id, "ai-teach")))[0]).toEqual(beforeCourse);
    expect((await db.select().from(chapters).where(eq(chapters.id, "ai-3")))[0]).toMatchObject({ tier: "M", tierLocked: true, eqWeight: 0.123 });
    expect((await db.select().from(testSources).where(eq(testSources.id, source.id)))[0]!.purchased).toBe(!source.purchased);
    expect(await db.select().from(lessonChapters).where(eq(lessonChapters.lessonId, "ai-teach-l1"))).toEqual([{ lessonId: "ai-teach-l1", chapterId: "ai-1" }]);
    expect(await db.select().from(events).where(eq(events.type, "seed.imported"))).toHaveLength(2);
  });

  it("serializes concurrent global and user imports without duplicate rows or links", async () => {
    const db = await fixture();
    const results = await Promise.all([
      importSubjects(db, file),
      importSubjects(db, file, { userId: "seed-owner" }),
      importSubjects(db, file, { userId: "seed-owner" }),
    ]);
    expect(results.map((r) => r.inserted.subjects).sort((a, b) => a - b)).toEqual([0, 0, 11]);
    expect(results.map((r) => r.inserted.chapters).sort((a, b) => a - b)).toEqual([0, 0, 93]);
    expect(await db.select().from(subjects)).toHaveLength(11);
    expect(await db.select().from(chapters)).toHaveLength(93);
    expect(await db.select().from(lessons).where(eq(lessons.courseId, "ai-teach"))).toHaveLength(22);
    const links = await db.select().from(lessonChapters);
    expect(links.length).toBeGreaterThan(100);
    expect(new Set(links.map((r) => `${r.lessonId}/${r.chapterId}`)).size).toBe(links.length);
    expect(await db.select().from(events).where(eq(events.type, "seed.imported"))).toHaveLength(2);
  });
});
