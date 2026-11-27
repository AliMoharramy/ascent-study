import { currentStudyGameDay, studyLogSubmissionSchema } from "@/domain/studyLog";
import { api, body } from "@/server/http";
import { listStudyLogs, submitStudyLog } from "@/server/studyLogs";

export const GET = api(async ({ db, userId, session }) => {
  const today = currentStudyGameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  const logs = await listStudyLogs(db, userId);
  return {
    today,
    studyLogs: logs.map(({ log, reviews }) => ({
      id: log.id,
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
    })),
  };
});

export const POST = api(async ({ db, userId, req, session }) => {
  const input = studyLogSubmissionSchema.parse(await body(req));
  const today = currentStudyGameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  return await submitStudyLog(db, userId, input, today);
}, { mutating: true });
