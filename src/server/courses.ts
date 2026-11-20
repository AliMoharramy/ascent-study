import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, queryOne, type Db } from "@/db/client";
import { chapters, courses, lessonChapters, lessons, type LessonStatus } from "@/db/schema";
import { parseLessonList, type ParseResult } from "@/domain/lessonParse";
import { appendEvent } from "@/events/store";
import { newId, nowIso } from "@/lib/ids";

/** Courses & lessons (T-R1-02 / F-DATA-02/03/04): CRUD, paste/CSV import with preview, watch status. */

export const courseInput = z.object({
  subjectId: z.string().min(1).max(40),
  kind: z.enum(["teaching", "tips_tests"]),
  title: z.string().trim().min(1).max(200),
  instructor: z.string().trim().max(100).nullish(),
  platform: z.string().trim().max(100).nullish(),
  speed: z.coerce.number().min(0.5).max(3).default(1.5),
});

export async function listCourses(db: Db, subjectId?: string) {
  const rows = (await db
    .select({
      course: courses,
      lessonCount: sql<number>`(SELECT count(*)::int FROM lessons l WHERE l.course_id = courses.id)`,
      doneCount: sql<number>`(SELECT count(*)::int FROM lessons l WHERE l.course_id = courses.id AND l.status = 'done')`,
      totalMin: sql<number>`(SELECT coalesce(sum(duration_min),0) FROM lessons l WHERE l.course_id = courses.id)`,
      doneMin: sql<number>`(SELECT coalesce(sum(duration_min),0) FROM lessons l WHERE l.course_id = courses.id AND l.status = 'done')`,
    })
    .from(courses)
    .where(subjectId ? eq(courses.subjectId, subjectId) : undefined)
    .orderBy(asc(courses.subjectId), asc(courses.kind)));
  return rows.map((r) => ({ ...r.course, lessonCount: r.lessonCount, doneCount: r.doneCount, totalMin: r.totalMin || r.course.durationMin || 0, doneMin: r.doneMin }));
}

export async function getCourse(db: Db, id: string) {
  const course = (await db.select().from(courses).where(eq(courses.id, id)).limit(1))[0];
  if (!course) return null;
  const ls = (await db.select().from(lessons).where(eq(lessons.courseId, id)).orderBy(asc(lessons.no)));
  const links = ls.length
    ? (await db.select().from(lessonChapters).where(inArray(lessonChapters.lessonId, ls.map((l) => l.id))))
    : [];
  const byLesson = new Map<string, string[]>();
  for (const l of links) byLesson.set(l.lessonId, [...(byLesson.get(l.lessonId) ?? []), l.chapterId]);
  return { course, lessons: ls.map((l) => ({ ...l, chapterIds: byLesson.get(l.id) ?? [] })) };
}

export async function createCourse(db: Db, userId: string, input: z.input<typeof courseInput>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = courseInput.parse(input);
  const id = `${d.subjectId}-${d.kind === "teaching" ? "teach" : "tips"}-${newId().slice(-6).toLowerCase()}`;
  const now = nowIso();
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.insert(courses).values({ id, userId, ...d, instructor: d.instructor ?? null, platform: d.platform ?? null, createdAt: now, updatedAt: now }));
    (await appendEvent(tx, { userId, type: "course.created", payload: { courseId: id, ...d } }));
  }));
  return id;
});
}

export async function updateCourse(db: Db, userId: string, id: string, input: Partial<z.input<typeof courseInput>>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = courseInput.partial().parse(input);
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.update(courses).set({ ...d, updatedAt: nowIso() }).where(eq(courses.id, id)));
    (await appendEvent(tx, { userId, type: "course.updated", payload: { courseId: id, ...d } }));
  }));
});
}

export async function deleteCourse(db: Db, userId: string, id: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.delete(courses).where(eq(courses.id, id)));
    (await appendEvent(tx, { userId, type: "course.deleted", payload: { courseId: id } }));
  }));
});
}

export const previewLessons = (text: string): ParseResult => parseLessonList(text);

/**
 * Imports parsed lessons into a course. mode "replace" wipes existing lessons first (keeping nothing);
 * mode "append" adds after the last number. Updates course totals (sessions, duration) and clears `estimated`.
 */
export async function importLessons(db: Db, userId: string, courseId: string, text: string, mode: "replace" | "append" = "replace") {
  return await withUserTransaction(db, userId, async (tx) => {
  const parsed = parseLessonList(text);
  if (parsed.lessons.length === 0) throw new Error("Nothing to import");
  const now = nowIso();
  (await withUserTransaction(tx, userId, async (tx) => {
    const course = (await tx.select().from(courses).where(eq(courses.id, courseId)).limit(1))[0];
    if (!course) throw new Error("Course not found");
    let offset = 0;
    if (mode === "replace") (await tx.delete(lessons).where(eq(lessons.courseId, courseId)));
    else offset = (await queryOne<{ n: number }>(tx, sql`SELECT coalesce(max(no),0) AS n FROM lessons WHERE course_id = ${courseId}`))?.n ?? 0;
    for (const l of parsed.lessons) (await tx.insert(lessons).values({ id: newId(), courseId, no: l.no + offset, title: l.title, durationMin: l.durationMin, status: "todo", createdAt: now, updatedAt: now }));
    const totals = (await queryOne<{ n: number; m: number }>(tx, sql`SELECT count(*)::int AS n, coalesce(sum(duration_min),0) AS m FROM lessons WHERE course_id = ${courseId}`))!;
    (await tx.update(courses).set({ sessions: totals.n, durationMin: Math.round(totals.m), estimated: false, updatedAt: now }).where(eq(courses.id, courseId)));
    (await appendEvent(tx, { userId, type: "lessons.imported", payload: { courseId, mode, count: parsed.lessons.length, totalMin: parsed.totalMin, errors: parsed.errors.length } }));
  }));
  return parsed;
});
}

export async function setLessonStatus(db: Db, userId: string, lessonId: string, status: LessonStatus) {
  await withUserTransaction(db, userId, async (tx) => {
    const l = (await tx.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1))[0];
    if (!l) throw new Error("Lesson not found");
    await tx.update(lessons).set({ status, watchedAt: status === "done" ? nowIso() : null, updatedAt: nowIso() }).where(eq(lessons.id, lessonId));
    await appendEvent(tx, { userId, type: "lesson.status_changed", payload: { lessonId, courseId: l.courseId, from: l.status, to: status } });
  });
}

/** Replaces the chapter links of a lesson (many-to-many). */
export async function setLessonChapters(db: Db, userId: string, lessonId: string, chapterIds: string[]) {
  return await withUserTransaction(db, userId, async (tx) => {
    const lesson = (await tx.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, lessonId)).limit(1))[0];
    if (!lesson) throw new Error("Lesson not found");
    const valid = chapterIds.length ? (await tx.select({ id: chapters.id }).from(chapters).where(inArray(chapters.id, chapterIds))).map((c) => c.id) : [];
    await tx.delete(lessonChapters).where(eq(lessonChapters.lessonId, lessonId));
    if (valid.length) await tx.insert(lessonChapters).values(valid.map((chapterId) => ({ lessonId, chapterId })));
    return valid;
  });
}

/** Real watch time at the course's playback speed. */
export const watchMinutes = (durationMin: number, speed: number) => Math.round((durationMin / speed) * 10) / 10;

export async function nextLesson(db: Db, courseId: string) {
  return (await db.select().from(lessons).where(and(eq(lessons.courseId, courseId), inArray(lessons.status, ["watching", "todo"]))).orderBy(asc(lessons.no)).limit(1))[0] ?? null;
}
