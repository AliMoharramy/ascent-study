import { and, asc, desc, eq, getTableColumns, inArray, lt, lte, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { withUserTransaction, type Db } from "@/db/client";
import { chapters, courses, lessonChapters, lessons, reminders, studyLogReviews, studyLogs } from "@/db/schema";
import { studyLogDecisionSchema, studyLogSubmissionSchema, studyLogRetrySchema, validateStudyLogDecision, reviewDatesForStudyDay, isoGameDaySchema, STUDY_LOG_ANALYSIS_LEASE_MS } from "@/domain/studyLog";
import { appendEvent, EventRequestConflict, replayOf } from "@/events/store";
import { newId, nowIso } from "@/lib/ids";
import { remoteCall } from "./ai";

export class StudyLogConflict extends Error {
  constructor(message = "The study log has changed or is already being processed") { super(message); }
}

export class StudyLogNotFound extends Error {
  constructor() { super("Unknown study log or review"); }
}
export { EventRequestConflict };

type Submission = {
  topic: string;
  sourceText: string;
  clientRequestId: string;
  studiedOn: string;
  studiedOnExplicit: boolean;
  courseId: string | null;
  lessonId: string | null;
  chapterId: string | null;
  consentToRemoteAi: true;
  requestFingerprint: string;
};

export type StudyLogEvaluationInput = Pick<Submission, "topic" | "sourceText" | "courseId" | "lessonId" | "chapterId" | "studiedOn"> & { budgetRequestId: string };
export type StudyLogEvaluator = (input: StudyLogEvaluationInput) => Promise<unknown | null>;
export type StudyReviewAction = "complete" | "snooze" | "skip" | "cancel";
export type StudyReviewActionInput = { action: StudyReviewAction; dueOn?: string; clientRequestId: string };

type LogRow = typeof studyLogs.$inferSelect;
type ReviewRow = typeof studyLogReviews.$inferSelect;
export type StudyLogBundle = { log: Omit<LogRow, "requestFingerprint">; reviews: ReviewRow[] };
export type DueStudyLogReview = ReviewRow & { topic: string };

function normalizeSubmission(input: unknown, today: string): Submission {
  const parsed = studyLogSubmissionSchema.parse(input);
  const fingerprintInput = {
    topic: parsed.topic,
    sourceText: parsed.sourceText,
    studiedOn: parsed.studiedOn ?? null,
    courseId: parsed.courseId ?? null,
    lessonId: parsed.lessonId ?? null,
    chapterId: parsed.chapterId ?? null,
    consentToRemoteAi: true,
  };
  return {
    topic: parsed.topic,
    sourceText: parsed.sourceText,
    clientRequestId: parsed.clientRequestId,
    studiedOn: isoGameDaySchema.parse(parsed.studiedOn ?? today),
    studiedOnExplicit: parsed.studiedOn !== undefined,
    courseId: parsed.courseId ?? null,
    lessonId: parsed.lessonId ?? null,
    chapterId: parsed.chapterId ?? null,
    consentToRemoteAi: true,
    requestFingerprint: createHash("sha256").update(JSON.stringify(fingerprintInput)).digest("hex"),
  };
}

function sameSubmission(row: LogRow, request: Submission): boolean {
  if (row.requestFingerprint !== null) return row.requestFingerprint === request.requestFingerprint;
  return row.topic === request.topic && row.sourceText === request.sourceText && (!request.studiedOnExplicit || row.studiedOn === request.studiedOn) &&
    row.courseId === request.courseId && row.lessonId === request.lessonId && row.chapterId === request.chapterId;
}

function leaseIsStale(row: LogRow, now = Date.now()): boolean {
  return row.analysisStartedAt === null || now - new Date(row.analysisStartedAt).getTime() >= STUDY_LOG_ANALYSIS_LEASE_MS;
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
  const storedLog = (await db.select().from(studyLogs).where(and(eq(studyLogs.id, logId), eq(studyLogs.userId, userId))).limit(1))[0];
  if (!storedLog) throw new StudyLogNotFound();
  const { requestFingerprint, ...log } = storedLog;
  void requestFingerprint;
  const reviews = await db.select().from(studyLogReviews)
    .where(and(eq(studyLogReviews.studyLogId, logId), eq(studyLogReviews.userId, userId)))
    .orderBy(asc(studyLogReviews.checkpoint));
  return { log, reviews };
}

async function defaultEvaluator(db: Db, userId: string, input: StudyLogEvaluationInput, today: string): Promise<unknown | null> {
  const system = [
    "You are a study-planning assistant. Use only the user's submitted source text; do not use outside facts.",
    "Return strict JSON matching one of these shapes:",
    '{"decision":"schedule","reason":"...","reviews":[{"front":"... {{blank}} ...","back":"the exact omitted words","evidence":"the exact source excerpt reconstructed by front and back"} x exactly 4]}',
    '{"decision":"no_sequence","reason":"...","reviews":[]}',
    '{"decision":"needs_material","reason":"...","reviews":[]}',
    "Choose needs_material when the source is too thin or unclear to support useful questions. Choose no_sequence when the material is not meaningfully improved by spaced recall. For each scheduled review, make front a cloze sentence with exactly one {{blank}} marker; back must be the exact omitted words, and inserting back into front must reproduce evidence exactly. Keep evidence a short exact excerpt from the source. Do not add markdown.",
  ].join(" ");
  const user = JSON.stringify({ topic: input.topic, sourceText: input.sourceText });
  const result = await remoteCall(db, userId, "study_log_review_planning", system, user, studyLogDecisionSchema, today, "study_log_review_planning: redacted", { requestId: input.budgetRequestId });
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
  if (!claim.row.aiConsentAt) {
    await saveRetryable(db, userId, logId, claim.startedAt, "Explicit consent is required before study material can be sent for remote review planning.");
    return await readBundle(db, userId, logId);
  }

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
      budgetRequestId: `study-log-analysis:${logId}:${claim.startedAt}`,
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

  try {
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
  } catch {
    try {
      await saveRetryable(db, userId, logId, claim.startedAt, "The review plan could not be saved. Retry the analysis to try again.");
    } catch {
      // Leave the lease in place; it becomes reclaimable if the database is still unavailable.
    }
  }
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
      id: newId(), userId, clientRequestId: request.clientRequestId, requestFingerprint: request.requestFingerprint, topic: request.topic,
      courseId: request.courseId, lessonId: request.lessonId, chapterId: request.chapterId,
      studiedOn: request.studiedOn, sourceText: request.sourceText, status: "processing", decision: null,
      reason: "", analysisStartedAt: startedAt, aiConsentAt: startedAt, createdAt: startedAt, updatedAt: startedAt,
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

export async function retryStudyLog(db: Db, userId: string, logId: string, input: unknown, today: string, evaluator?: StudyLogEvaluator): Promise<StudyLogBundle> {
  const parsed = studyLogRetrySchema.parse(input);
  const source = parsed.sourceText;
  const request = {
    studyLogId: logId,
    sourceHash: createHash("sha256").update(source).digest("hex"),
    sourceLength: source.length,
    consentToRemoteAi: true,
  };
  const result = await withUserTransaction(db, userId, async (tx): Promise<{ claim: ClaimResult; replay?: StudyLogBundle }> => {
    const prior = await replayOf(tx, userId, "study_log.retry_requested", parsed.clientRequestId, request);
    if (prior) return { claim: null, replay: await readBundle(tx, userId, logId) };

    const row = (await tx.select().from(studyLogs).where(and(eq(studyLogs.id, logId), eq(studyLogs.userId, userId))).limit(1))[0];
    if (!row) throw new StudyLogNotFound();
    const recoverable = row.status === "retryable" || row.status === "needs_material";
    const reclaimable = row.status === "processing" && leaseIsStale(row);
    if (row.status === "processing" && !reclaimable) throw new StudyLogConflict("Analysis is still active; retry becomes available after its five-minute lease expires");
    if (!recoverable && !reclaimable) throw new StudyLogConflict("This study log cannot be retried in its current state");
    await assertReferences(tx, userId, row);
    const startedAt = nowIso();
    const updated = { ...row, sourceText: source, status: "processing" as const, decision: null, reason: "", analysisStartedAt: startedAt, aiConsentAt: startedAt, updatedAt: startedAt };
    await tx.update(studyLogs).set({ sourceText: source, status: "processing", decision: null, reason: "", analysisStartedAt: startedAt, aiConsentAt: startedAt, updatedAt: startedAt })
      .where(and(eq(studyLogs.id, logId), eq(studyLogs.userId, userId)));
    await tx.delete(studyLogReviews).where(and(eq(studyLogReviews.studyLogId, logId), eq(studyLogReviews.userId, userId)));
    await appendEvent(tx, {
      userId,
      type: "study_log.retry_requested",
      gameDay: row.studiedOn,
      clientRequestId: parsed.clientRequestId,
      payload: { studyLogId: logId, request },
    });
    return { claim: { row: updated, startedAt } };
  });
  if (!result.claim) {
    if (result.replay) return result.replay;
    throw new StudyLogConflict();
  }
  return await evaluateClaim(db, userId, logId, result.claim, today, evaluator);
}

export async function getStudyLog(db: Db, userId: string, logId: string): Promise<StudyLogBundle> {
  return await readBundle(db, userId, logId);
}

export const STUDY_LOG_HISTORY_DEFAULT_LIMIT = 20;
export const STUDY_LOG_HISTORY_MAX_LIMIT = 50;

type StudyLogSummaryRow = Omit<LogRow, "sourceText" | "requestFingerprint">;
type StudyReviewSummaryRow = Pick<ReviewRow, "id" | "studyLogId" | "checkpoint" | "offsetDays" | "scheduledOn" | "dueOn" | "status">;
export type StudyLogSummaryBundle = { log: StudyLogSummaryRow; reviews: StudyReviewSummaryRow[] };
export type StudyLogHistoryPage = { items: StudyLogSummaryBundle[]; nextCursor: string | null };

type HistoryCursor = { createdAt: string; id: string };

function encodeHistoryCursor(row: HistoryCursor): string {
  return Buffer.from(JSON.stringify(row)).toString("base64url");
}

function decodeHistoryCursor(cursor: string): HistoryCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<HistoryCursor>;
    if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.id !== "string" || !value.id) throw new Error();
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new StudyLogConflict("Invalid study-log history cursor");
  }
}

export async function listStudyLogs(db: Db, userId: string, options: { limit?: number; cursor?: string | null } = {}): Promise<StudyLogHistoryPage> {
  const requestedLimit = Number.isFinite(options.limit) ? Math.floor(options.limit!) : STUDY_LOG_HISTORY_DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(STUDY_LOG_HISTORY_MAX_LIMIT, requestedLimit || STUDY_LOG_HISTORY_DEFAULT_LIMIT));
  const cursor = options.cursor ? decodeHistoryCursor(options.cursor) : null;
  const cursorCondition = cursor
    ? or(lt(studyLogs.createdAt, cursor.createdAt), and(eq(studyLogs.createdAt, cursor.createdAt), lt(studyLogs.id, cursor.id)))
    : undefined;
  const condition = cursorCondition ? and(eq(studyLogs.userId, userId), cursorCondition) : eq(studyLogs.userId, userId);
  const rows = await db.select({
    id: studyLogs.id,
    userId: studyLogs.userId,
    clientRequestId: studyLogs.clientRequestId,
    topic: studyLogs.topic,
    courseId: studyLogs.courseId,
    lessonId: studyLogs.lessonId,
    chapterId: studyLogs.chapterId,
    studiedOn: studyLogs.studiedOn,
    status: studyLogs.status,
    decision: studyLogs.decision,
    reason: studyLogs.reason,
    analysisStartedAt: studyLogs.analysisStartedAt,
    aiConsentAt: studyLogs.aiConsentAt,
    createdAt: studyLogs.createdAt,
    updatedAt: studyLogs.updatedAt,
  }).from(studyLogs).where(condition).orderBy(desc(studyLogs.createdAt), desc(studyLogs.id)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const logs = rows.slice(0, limit);
  if (logs.length === 0) return { items: [], nextCursor: null };
  const reviews = await db.select({
    id: studyLogReviews.id,
    studyLogId: studyLogReviews.studyLogId,
    checkpoint: studyLogReviews.checkpoint,
    offsetDays: studyLogReviews.offsetDays,
    scheduledOn: studyLogReviews.scheduledOn,
    dueOn: studyLogReviews.dueOn,
    status: studyLogReviews.status,
  }).from(studyLogReviews)
    .where(and(eq(studyLogReviews.userId, userId), inArray(studyLogReviews.studyLogId, logs.map((row) => row.id))))
    .orderBy(asc(studyLogReviews.checkpoint));
  const byLog = new Map<string, StudyReviewSummaryRow[]>();
  for (const review of reviews) byLog.set(review.studyLogId, [...(byLog.get(review.studyLogId) ?? []), review]);
  const items = logs.map((log) => ({ log, reviews: byLog.get(log.id) ?? [] }));
  const last = logs.at(-1)!;
  return { items, nextCursor: hasMore ? encodeHistoryCursor({ createdAt: last.createdAt, id: last.id }) : null };
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
  const request = {
    reviewId,
    action: input.action,
    ...(input.action === "snooze" ? { dueOn: isoGameDaySchema.parse(input.dueOn) } : {}),
  };
  if (input.action === "snooze") {
    const newDue = isoGameDaySchema.parse(input.dueOn);
    if (newDue <= day) throw new StudyLogConflict("A snoozed review must be due on a future game day");
  }

  return await withUserTransaction(db, userId, async (tx) => {
    const prior = await replayOf(tx, userId, "study_log.review_acted", input.clientRequestId, request);
    if (prior) {
      await tx.delete(reminders).where(and(eq(reminders.userId, userId), eq(reminders.anchorKey, `study-review:${reviewId}`)));
      const previous = prior.payload.result;
      if (!previous || typeof previous !== "object") throw new EventRequestConflict();
      return previous as ReviewRow;
    }
    const review = (await tx.select().from(studyLogReviews).where(and(eq(studyLogReviews.id, reviewId), eq(studyLogReviews.userId, userId))).limit(1))[0];
    if (!review) throw new StudyLogNotFound();
    if (review.status !== "pending") {
      const repeatedAction = input.action === "complete" ? review.status === "done"
        : input.action === "skip" ? review.status === "skipped"
          : input.action === "cancel" ? review.status === "canceled"
            : false;
      if (repeatedAction) {
        await tx.delete(reminders).where(and(eq(reminders.userId, userId), eq(reminders.anchorKey, `study-review:${reviewId}`)));
        await appendEvent(tx, {
          userId,
          type: "study_log.review_acted",
          gameDay: day,
          clientRequestId: input.clientRequestId,
          payload: { studyLogId: review.studyLogId, reviewId, action: input.action, scheduledOn: review.scheduledOn, dueOn: review.dueOn, request, result: review },
        });
        return review;
      }
      throw new StudyLogConflict("This review has already been resolved");
    }
    if (input.action === "snooze" && review.dueOn === input.dueOn) {
      await tx.delete(reminders).where(and(eq(reminders.userId, userId), eq(reminders.anchorKey, `study-review:${reviewId}`)));
      await appendEvent(tx, {
        userId,
        type: "study_log.review_acted",
        gameDay: day,
        clientRequestId: input.clientRequestId,
        payload: { studyLogId: review.studyLogId, reviewId, action: input.action, scheduledOn: review.scheduledOn, dueOn: review.dueOn, request, result: review },
      });
      return review;
    }
    const at = nowIso();
    const status = input.action === "complete" ? "done" : input.action === "skip" ? "skipped" : input.action === "cancel" ? "canceled" : "pending";
    const updated = (await tx.update(studyLogReviews).set({
      status,
      dueOn: input.action === "snooze" ? input.dueOn! : review.dueOn,
      doneOn: input.action === "complete" ? day : null,
      updatedAt: at,
    }).where(and(eq(studyLogReviews.id, reviewId), eq(studyLogReviews.userId, userId), eq(studyLogReviews.status, "pending"))).returning())[0];
    if (!updated) throw new StudyLogConflict("This review has already been resolved");
    await tx.delete(reminders).where(and(eq(reminders.userId, userId), eq(reminders.anchorKey, `study-review:${reviewId}`)));
    await appendEvent(tx, {
      userId,
      type: "study_log.review_acted",
      gameDay: day,
      clientRequestId: input.clientRequestId,
      payload: { studyLogId: review.studyLogId, reviewId, action: input.action, scheduledOn: review.scheduledOn, dueOn: updated.dueOn, request, result: updated },
    });
    return updated;
  });
}
