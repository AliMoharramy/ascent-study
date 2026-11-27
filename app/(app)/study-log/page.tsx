import { asc, eq, inArray, isNull, or } from "drizzle-orm";
import { chapters, courses, lessonChapters, lessons } from "@/db/schema";
import { currentStudyGameDay } from "@/domain/studyLog";
import { requireUser } from "@/server/context";
import { listStudyLogs } from "@/server/studyLogs";
import { PageHeader } from "@/ui/components";
import { StudyLogClient } from "./StudyLogClient";

export const metadata = { title: "Study log" };

export default async function StudyLogPage() {
  const { db, userId, now, tz, rollover } = await requireUser();
  const today = currentStudyGameDay(now, tz, rollover);
  const visibleCourses = await db.select({ id: courses.id, title: courses.title, subjectId: courses.subjectId })
    .from(courses)
    .where(or(isNull(courses.userId), eq(courses.userId, userId)))
    .orderBy(asc(courses.title));
  const courseIds = visibleCourses.map((course) => course.id);
  const lessonRows = courseIds.length
    ? await db.select({ id: lessons.id, title: lessons.title, courseId: lessons.courseId }).from(lessons).where(inArray(lessons.courseId, courseIds)).orderBy(asc(lessons.courseId), asc(lessons.no))
    : [];
  const lessonIds = lessonRows.map((lesson) => lesson.id);
  const chapterLinks = lessonIds.length
    ? await db.select().from(lessonChapters).where(inArray(lessonChapters.lessonId, lessonIds))
    : [];
  const chaptersByLesson = new Map<string, string[]>();
  for (const link of chapterLinks) chaptersByLesson.set(link.lessonId, [...(chaptersByLesson.get(link.lessonId) ?? []), link.chapterId]);
  const subjectIds = [...new Set(visibleCourses.map((course) => course.subjectId))];
  const chapterOptions = subjectIds.length
    ? await db.select({ id: chapters.id, no: chapters.no, title: chapters.title, subjectId: chapters.subjectId })
      .from(chapters).where(inArray(chapters.subjectId, subjectIds)).orderBy(asc(chapters.subjectId), asc(chapters.no))
    : [];
  const history = await listStudyLogs(db, userId);
  const recent = history.items.map(({ log, reviews }) => ({
    id: log.id,
    clientRequestId: log.clientRequestId,
    topic: log.topic,
    courseId: log.courseId,
    lessonId: log.lessonId,
    chapterId: log.chapterId,
    studiedOn: log.studiedOn,
    status: log.status,
    decision: log.decision,
    reason: log.reason,
    analysisStartedAt: log.analysisStartedAt,
    createdAt: log.createdAt,
    reviews: reviews.map(({ id, checkpoint, offsetDays, scheduledOn, dueOn, status }) => ({ id, checkpoint, offsetDays, scheduledOn, dueOn, status })),
  }));

  return (
    <div>
      <PageHeader eyebrow="Learning · your own material" title="Study log" />
      <StudyLogClient
        today={today}
        courses={visibleCourses}
        lessons={lessonRows.map((lesson) => ({ ...lesson, chapterIds: chaptersByLesson.get(lesson.id) ?? [] }))}
        chapters={chapterOptions}
        recent={recent}
        nextCursor={history.nextCursor}
      />
    </div>
  );
}
