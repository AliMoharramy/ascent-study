import { currentStudyGameDay, studyLogSubmissionSchema } from "@/domain/studyLog";
import { api, body } from "@/server/http";
import { listStudyLogs, reconcileStudyLogMutations, submitStudyLog } from "@/server/studyLogs";

function summaryResponse(logs: Awaited<ReturnType<typeof listStudyLogs>>["items"]) {
  return logs.map(({ log, reviews }) => ({
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
    updatedAt: log.updatedAt,
    reviews: reviews.map(({ id, checkpoint, offsetDays, scheduledOn, dueOn, status }) => ({ id, checkpoint, offsetDays, scheduledOn, dueOn, status })),
  }));
}

export const GET = api(async ({ db, userId, session, req }) => {
  const today = currentStudyGameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  const url = new URL(req.url);
  const requestIds = url.searchParams.get("requestIds");
  if (requestIds !== null) {
    const reconciled = await reconcileStudyLogMutations(db, userId, requestIds.split(","));
    return {
      today,
      nextCursor: null,
      studyLogs: summaryResponse(reconciled.studyLogs),
      acceptedRequestIds: reconciled.acceptedRequestIds,
    };
  }
  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);
  const page = await listStudyLogs(db, userId, {
    limit: parsedLimit !== undefined && Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    cursor: url.searchParams.get("cursor"),
  });
  return {
    today,
    nextCursor: page.nextCursor,
    studyLogs: summaryResponse(page.items),
  };
});

export const POST = api(async ({ db, userId, req, session }) => {
  const input = studyLogSubmissionSchema.parse(await body(req));
  const today = currentStudyGameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  return await submitStudyLog(db, userId, input, today);
}, { mutating: true });
