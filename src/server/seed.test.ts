import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { closeTestDb, memoryDb } from "@/db/testing";
import { chapters, courses, lessonChapters, lessons, subjects } from "@/db/schema";
import { importSubjects, loadSubjectsFile } from "./seed";

const opened: Db[] = [];
async function fixture() {
  const db = await memoryDb();
  opened.push(db);
  return db;
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map(closeTestDb));
});

describe("seed import (T-R1-01)", () => {
  const file = loadSubjectsFile();

  it("imports 11 subjects / 93 chapters (doc 02 §2); 85 active = 81 required + 4 optional (ADR-0005)", async () => {
    const db = await fixture();
    const r = await importSubjects(db, file);
    expect(r.subjects).toBe(11);
    expect(r.chapters).toBe(93);
    expect(r.activeChapters).toBe(85);
    // doc 02 says 82 because it only removed AI's 3 optional chapters; foundations ch.15 is optional too (doc 03 §6)
    expect(r.requiredChapters).toBe(81);
    expect(r.courses).toBeGreaterThanOrEqual(16);
  });

  it("fills eq_weight from chapter-weights.yaml (≈1 per subject)", async () => {
    const db = await fixture();
    await importSubjects(db, file);
    const ai = await db.select().from(chapters).where(eq(chapters.subjectId, "ai"));
    expect(ai.find((c) => c.no === 3)!.eqWeight).toBeGreaterThan(0.2);
    const sum = ai.reduce((s, c) => s + (c.eqWeight ?? 0), 0);
    expect(sum).toBeGreaterThan(0.95);
    expect(sum).toBeLessThan(1.05);
  });

  it("imports the real parlike lesson lists for the 5 confirmed courses only", async () => {
    const db = await fixture();
    await importSubjects(db, file);
    const count = async (id: string) => (await db.select().from(lessons).where(eq(lessons.courseId, id))).length;
    expect(await count("ai-teach")).toBe(22);
    expect(await count("dsa-tips")).toBe(34);
    expect(await count("os-teach")).toBe(46);
    expect(await count("dsa-teach")).toBe(0); // candidate, not confirmed by the user
    expect((await db.select().from(courses).where(eq(courses.id, "ai-teach")).limit(1))[0]!.durationMin).toBe(3389);
    await importSubjects(db, file); // idempotent
    expect(await count("ai-teach")).toBe(22);
  });

  it("links lessons to chapters (T-DATA-05 initial mapping) and leaves past-exam sessions unmapped", async () => {
    const db = await fixture();
    await importSubjects(db, file);
    const links = async (lessonId: string) =>
      (await db.select().from(lessonChapters).where(eq(lessonChapters.lessonId, lessonId))).map((l) => l.chapterId).sort();
    expect(await links("ai-teach-l1")).toEqual(["ai-1"]);
    expect(await links("ai-tips-l1")).toEqual(["ai-1", "ai-2"]); // many-to-many
    expect(await links("ai-tips-l14")).toEqual([]); // past-exam session, intentionally unmapped
    const total = (await db.select().from(lessonChapters)).length;
    expect(total).toBeGreaterThan(100);
    await importSubjects(db, file); // idempotent: no duplicate links
    expect((await db.select().from(lessonChapters)).length).toBe(total);
    // Backfill: an older DB has the lessons but no links yet → re-seed restores them without touching lessons.
    await db.delete(lessonChapters);
    await importSubjects(db, file);
    expect((await db.select().from(lessonChapters)).length).toBe(total);
    expect((await db.select().from(lessons).where(eq(lessons.courseId, "ai-teach")))).toHaveLength(22);
  });

  it("linear algebra is imported as dropped", async () => {
    const db = await fixture();
    await importSubjects(db, file);
    expect((await db.select().from(subjects).where(eq(subjects.id, "linear_algebra")).limit(1))[0]!.status).toBe("dropped");
  });

  it("is idempotent and preserves user tier overrides", async () => {
    const db = await fixture();
    await importSubjects(db, file);
    await db.update(chapters).set({ tier: "M", tierLocked: true }).where(eq(chapters.id, "ai-3"));
    const again = await importSubjects(db, file);
    expect(again.inserted).toEqual({ subjects: 0, chapters: 0, courses: 0 });
    expect(again.chapters).toBe(93);
    const ch = (await db.select().from(chapters).where(eq(chapters.id, "ai-3")).limit(1))[0]!;
    expect(ch.tier).toBe("M");
    expect(ch.tierLocked).toBe(true);
  });
});
