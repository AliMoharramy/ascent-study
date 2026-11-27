import { and, asc, desc, eq, getTableColumns, lte } from "drizzle-orm";
import { withUserTransaction, type Db } from "@/db/client";
import { chapters, courses, lessonChapters, lessons, studyLogReviews, studyLogs } from "@/db/schema";
import { studyLogDecisionSchema, studyLogSubmissionSchema, validateStudyLogDecision, reviewDatesForStudyDay, isoGameDaySchema } from "@/domain/studyLog";
import { appendEvent } from "@/events/store";
import { newId, nowIso } from "@/lib/ids";
import { remoteCall } from "./ai";

const ANALYSIS_LEASE_MS = 5 * 60_000;

export class StudyLogConflict extends Error {
  constructor(message = "The study log has changed or is already being processed") { super(message); }
}

export class StudyLogNotFound extends Error {
  constructor() { super("Unknown study log or review"); }
}

export type StudyLogEvaluationInput = {
  topic: string;
  sourceText: string;
  courseId: string | null;
  lessonId: string | null;
  chapterId: string | null;
  studiedOn: string;
};

export type StudyLogEvaluator = (input: StudyLogEvaluationInput) => Promise<unknown | null>;
export type StudyReviewAction = "complete" | "snooze" | "skip" | "cancel";
export type StudyReviewActionInput = { action: StudyReviewAction; dueOn?: string };

type Submission = {
  topic: string;
  sourceText: string;
  clientRequestId: string;
  studiedOn: string;
  courseId: string | null;
  lessonId: string | null;
  chapterId: string | null;
};

type LogRow = typeof studyLogs.$inferSelect;
type ReviewRow = typeof studyLogReviews.$inferSelect;
export type StudyLogBundle = { log: LogRow; reviews: ReviewRow[] };
export type DueStudyLogReview = ReviewRow & { topic: string };

function normalizeSubmission(input: unknown, today: string): Submission {
  const parsed = studyLogSubmissionSchema.parse(input);
  return {
    topic: parsed.topic,
    sourceText: parsed.sourceText,
    clientRequestId: parsed.clientRequestId,
    studiedOn: isoGameDaySchema.parse(parsed.studiedOn ?? today),
    courseId: parsed.courseId ?? null,
    lessonId: parsed.lessonId ?? null,
    chapterId: parsed.chapterId ?? null,
  };
}

function sameSubmission(row: LogRow, request: Submission): boolean {
  return row.topic === request.topic && row.sourceText === request.sourceText && row.studiedOn === request.studiedOn &&
    row.courseId === request.courseId && row.lessonId === request.lessonId && row.chapterId === request.chapterId;
}

function leaseIsStale(row: LogRow, now = Date.now()): boolean {
  return row.analysisStartedAt === null || now - new Date(row.analysisStartedAt).getTime() >= ANALYSIS_LEASE_MS;
}

async function assertReferences(db: Db, userId: string, refs: Pick<Submission, "courseId" | "lessonId" | "chapterId">): Promise<void> {
  let course: typeof courses.$inferSelect | undefined;
  if (refs.courseId) {
    course = (await db.select().from(courses).where(eq(courses.id, refs.courseId)).limit(1))[0];
    if (!course || (course.userId !== null && course.userId !== userId)) throw new StudyLogConflict("The selected course is unavailable");
  }

  if (refs.lessonId) {
    const lesson = (await db.select({ lesson: lessons, course: courses })
      .from(lessons)
      .innerJoin(courses, eq(lessons.courseId, courses.id))
      .where(eq(lessons.id, refs.lessonId)).limit(1))[0];
    if (!lesson || (lesson.course.userId !== null && lesson.course.userId !== userId)) throw new StudyLogConflict("The selected lesson is unavailable");
    if (refs.courseId && lesson.course.id !== refs.courseId) throw new StudyLogConflict("The lesson does not belong to the selected course");
    course = lesson.course;
  }

  if (refs.chapterId) {
    const chapter = (await db.select().from(chapters).where(eq(chapters.id, refs.chapterId)).limit(1))[0];
    if (!chapter) throw new StudyLogConflict("The selected chapter is unavailable");
    if (course && course.subjectId !== chapter.subjectId) throw new StudyLogConflict("The chapter does not belong to the selected course");
    if (refs.lessonId) {
      const linked = (await db.select().from(lessonChapters).where(and(eq(lessonChapters.lessonId, refs.lessonId), eq(lessonChapters.chapterId, refs.chapterId))).limit(1))[0];
      if (!linked) throw new StudyLogConflict("The chapter is not linked to the selected lesson");
    }
  }
}

async function readBundle(db: Db, userId: string, logId: string): Promise<StudyLogBundle> {
  const log = (await db.select().from(studyLogs).where(and(eq(studyLogs.id, logId), eq(studyLogs.userId, userId))).limit(1))[0];
  if (!log) throw new StudyLogNotFound();
  const reviews = await db.select().from(studyLogReviews)
    .where(and(eq(studyLogReviews.studyLogId, logId), eq(studyLogReviews.userId, userId)))
    .orderBy(asc(studyLogReviews.checkpoint));
  return { log, reviews };
}

async function defaultEvaluator(db: Db, userId: string, input: StudyLogEvaluationInput, today: string): Promise<unknown | null> {
  const system = [
    "You are a study-planning assistant. Use only the user's submitted source text; do not use outside facts.",
    "Return strict JSON matching one of these shapes:",
    '{"decision":"schedule","reason":"...","reviews":[{"front":"...","back":"...","evidence":"verbatim source excerpt"} x exactly 4]}',
    '{"decision":"no_sequence","reason":"...","reviews":[]}',
    '{"decision":"needs_material","reason":"...","reviews":[]}',
    "Choose needs_material when the source is too thin or unclear to support useful questions. Choose no_sequence when the material is not meaningfully improved by spaced recall. For schedule, make each evidence field a short exact excerpt from the source, and create useful questions with concise answers. Do not add markdown.",
  ].join(" ");
  const user = JSON.stringify({ topic: input.topic, sourceText: input.sourceText });
  const result = await remoteCall(db, userId, "study_log_review_planning", system, user, studyLogDecisionSchema, today, "study_log_review_planning: user-submitted study material");
  return result?.value ?? null;
}

async function saveRetryable(db: Db, userId: string, logId: string, claimStartedAt: string, reason: string): Promise<void> {
  await withUserTransaction(db, userId, async (tx) => {
    const current = (await tx.select().from(studyLogs).where(and(eq(studyLogs.id, logId), eq(studyLogs.userId, userId))).limit(1))[0];
    if (!current || current.status !== "processing" || current.analysisStartedAt !== claimStartedAt) return;
    const at = nowIso();
    await tx.update(studyLogs).set({ status: "retryable", decision: null, reason, analysisStartedAt: null, updatedAt: at })
      .where(and(eq(studyLogs.id, logId), eq(studyLogs.userId, userId)));
    await appendEvent(tx, { userId, type: "study_log.decision_recorded", gameDay: current.studiedOn, payload: { studyLogId: logId, decision: null, status: "retryable" } });
  });
}

async function evaluateClaim(db: Db, userId: string, logId: string, claim: { row: LogRow; startedAt: string }, today: string, evaluator?: StudyLogEvaluator): Promise<StudyLogBundle> {
  let candidate: unknown | null;
  try {
    const evaluate = evaluator ?? ((input: StudyLogEvaluationInput) => defaultEvaluator(db, userId, input, today));
    candidate = await evaluate({
      topic: claim.row.topic,
      sourceText: claim.row.sourceText,
      courseId: claim.row.courseId,
      lessonId: claim.row.lessonId,
      chapterId: claim.row.chapterId,
      studiedOn: claim.row.studiedOn,
    });
  } catch {
    candidate = null;
  }

  let decision: ReturnType<typeof validateStudyLogDecision> | null = null;
  if (candidate !== null) {
    try {
      decision = validateStudyLogDecision(claim.row.sourceText, candidate);
    } catch {
      decision = null;
    }
  }
  if (!decision) {
    await saveRetryable(db, userId, logId, claim.startedAt, "The AI could not create a source-grounded review plan. Add or edit the notes and retry.");
    return await readBundle(db, userId, logId);
  }

  await withUserTransaction(db, userId, async (tx) => {
    const current = (await tx.select().from(studyLogs).where(and(eq(studyLogs.id, logId), eq(studyLogs.userId, userId))).limit(1))[0];
    if (!current || current.status !== "processing" || current.analysisStartedAt !== claim.startedAt) return;
    const status = decision!.decision === "schedule" ? "scheduled" : decision!.decision;
    const at = nowIso();
    await tx.update(studyLogs).set({ status, decision: decision!.decision, reason: decision!.reason, analysisStartedAt: null, updatedAt: at })
      .where(and(eq(studyLogs.id, logId), eq(studyLogs.userId, userId)));

    if (decision!.decision === "schedule") {
      const dates = reviewDatesForStudyDay(current.studiedOn);
      await tx.insert(studyLogReviews).values(decision!.reviews.map((review, index) => ({
        id: newId(), userId, studyLogId: logId, checkpoint: index + 1, offsetDays: dates[index]!.offsetDays,
        front: review.front, back: review.back, scheduledOn: dates[index]!.scheduledOn, dueOn: dates[index]!.scheduledOn,
        status: "pending" as const, doneOn: null, createdAt: at, updatedAt: at,
      })));
    }
    await appendEvent(tx, { userId, type: "study_log.decision_recorded", gameDay: current.studiedOn, payload: { studyLogId: logId, decision: decision!.decision, status } });
  });
  return await readBundle(db, userId, logId);
}

type ClaimResult = { row: LogRow; startedAt: string } | null;

async function claimNewOrStale(db: Db, userId: string, request: Submission): Promise<{ claim: ClaimResult; replay?: StudyLogBundle }> {
  return await withUserTransaction(db, userId, async (tx) => {
    const existing = (await tx.select().from(studyLogs).where(and(eq(studyLogs.userId, userId), eq(studyLogs.clientRequestId, request.clientRequestId))).limit(1))[0];
    if (existing) {
      if (!sameSubmission(existing, request)) throw new StudyLogConflict("This request key was already used for different study material");
      if (existing.status === "processing" && leaseIsStale(existing)) {
        const startedAt = nowIso();
        await tx.update(studyLogs).set({ analysisStartedAt: startedAt, updatedAt: startedAt }).where(and(eq(studyLogs.id, existing.id), eq(studyLogs.userId, userId)));
        return { claim: { row: { ...existing, analysisStartedAt: startedAt }, startedAt } };
      }
      return { claim: null, replay: await readBundle(tx, userId, existing.id) };
    }

    await assertReferences(tx, userId, request);
    const startedAt = nowIso();
    const row: typeof studyLogs.$inferInsert = {
      id: newId(), userId, clientRequestId: request.clientRequestId, topic: request.topic,
      courseId: request.courseId, lessonId: request.lessonId, chapterId: request.chapterId,
      studiedOn: request.studiedOn, sourceText: request.sourceText, status: "processing", decision: null,
      reason: "", analysisStartedAt: startedAt, createdAt: startedAt, updatedAt: startedAt,
    };
    await tx.insert(studyLogs).values(row);
    await appendEvent(tx, { userId, type: "study_log.created", gameDay: request.studiedOn, payload: { studyLogId: row.id, topic: row.topic, studiedOn: row.studiedOn } });
    return { claim: { row: row as LogRow, startedAt } };
  });
}

export async function submitStudyLog(db: Db, userId: string, input: unknown, today: string, evaluator?: StudyLogEvaluator): Promise<StudyLogBundle> {
  const request = normalizeSubmission(input, today);
  const { claim, replay } = await claimNewOrStale(db, userId, request);
  if (!claim) return replay!;
  return await evaluateClaim(db, userId, claim.row.id, claim, today, evaluator);
}

export async function retryStudyLog(db: Db, userId: string, logId: string, sourceText: string, today: string, evaluator?: StudyLogEvaluator): Promise<StudyLogBundle> {
  const source = studyLogSubmissionSchema.shape.sourceText.parse(sourceText);
  const claim = await withUserTransaction(db, userId, async (tx): Promise<ClaimResult> => {
    const row = (await tx.select().from(studyLogs).where(and(eq(studyLogs.id, logId), eq(studyLogs.userId, userId))).limit(1))[0];
    if (!row) throw new StudyLogNotFound();
    const recoverable = row.status === "retryable" || row.status === "needs_material";
    const reclaimable = row.status === "processing" && leaseIsStale(row);
    if (!recoverable && !reclaimable) throw new StudyLogConflict("This study log cannot be retried in its current state");
    await assertReferences(tx, userId, row);
    const startedAt = nowIso();
    const updated = { ...row, sourceText: source, status: "processing" as const, decision: null, reason: "", analysisStartedAt: startedAt, updatedAt: startedAt };
    await tx.update(studyLogs).set({ sourceText: source, status: "processing", decision: null, reason: "", analysisStartedAt: startedAt, updatedAt: startedAt })
      .where(and(eq(studyLogs.id, logId), eq(studyLogs.userId, userId)));
    await tx.delete(studyLogReviews).where(and(eq(studyLogReviews.studyLogId, logId), eq(studyLogReviews.userId, userId)));
    return { row: updated, startedAt };
  });
  if (!claim) throw new StudyLogConflict();
  return await evaluateClaim(db, userId, logId, claim, today, evaluator);
}

export async function getStudyLog(db: Db, userId: string, logId: string): Promise<StudyLogBundle> {
  return await readBundle(db, userId, logId);
}

export async function listStudyLogs(db: Db, userId: string): Promise<StudyLogBundle[]> {
  const logs = await db.select().from(studyLogs).where(eq(studyLogs.userId, userId)).orderBy(desc(studyLogs.createdAt)).limit(50);
  return await Promise.all(logs.map((row) => readBundle(db, userId, row.id)));
}

export async function dueStudyLogReviews(db: Db, userId: string, today: string): Promise<DueStudyLogReview[]> {
  const dueDay = isoGameDaySchema.parse(today);
  return await db.select({ ...getTableColumns(studyLogReviews), topic: studyLogs.topic })
    .from(studyLogReviews)
    .innerJoin(studyLogs, and(eq(studyLogReviews.studyLogId, studyLogs.id), eq(studyLogReviews.userId, studyLogs.userId)))
    .where(and(eq(studyLogReviews.userId, userId), eq(studyLogs.userId, userId), eq(studyLogReviews.status, "pending"), lte(studyLogReviews.dueOn, dueDay)))
    .orderBy(asc(studyLogReviews.dueOn), asc(studyLogReviews.studyLogId), asc(studyLogReviews.checkpoint));
}

export async function actOnStudyLogReview(db: Db, userId: string, reviewId: string, input: StudyReviewActionInput, today: string): Promise<ReviewRow> {
  const day = isoGameDaySchema.parse(today);
  if (input.action === "snooze") {
    const newDue = isoGameDaySchema.parse(input.dueOn);
    if (newDue <= day) throw new StudyLogConflict("A snoozed review must be due on a future game day");
  }

  return await withUserTransaction(db, userId, async (tx) => {
    const review = (await tx.select().from(studyLogReviews).where(and(eq(studyLogReviews.id, reviewId), eq(studyLogReviews.userId, userId))).limit(1))[0];
    if (!review) throw new StudyLogNotFound();
    if (review.status !== "pending") throw new StudyLogConflict("This review has already been resolved");
    const at = nowIso();
    const status = input.action === "complete" ? "done" : input.action === "skip" ? "skipped" : input.action === "cancel" ? "canceled" : "pending";
    const updated = (await tx.update(studyLogReviews).set({
      status,
      dueOn: input.action === "snooze" ? input.dueOn! : review.dueOn,
      doneOn: input.action === "complete" ? day : null,
      updatedAt: at,
    }).where(and(eq(studyLogReviews.id, reviewId), eq(studyLogReviews.userId, userId), eq(studyLogReviews.status, "pending"))).returning())[0];
    if (!updated) throw new StudyLogConflict("This review has already been resolved");
    await appendEvent(tx, { userId, type: "study_log.review_acted", gameDay: day, payload: { studyLogId: review.studyLogId, reviewId, action: input.action, scheduledOn: review.scheduledOn, dueOn: updated.dueOn } });
    return updated;
  });
}
