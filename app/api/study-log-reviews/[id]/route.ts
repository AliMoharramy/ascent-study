import { z } from "zod";
import { currentStudyGameDay, studyLogReviewActionSchema } from "@/domain/studyLog";
import { api, body } from "@/server/http";
import { actOnStudyLogReview } from "@/server/studyLogs";

export const POST = api(async ({ db, userId, req, params, session }) => {
  const id = z.string().min(1).parse((await params).id);
  const action = studyLogReviewActionSchema.parse(await body(req));
  const today = currentStudyGameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  return await actOnStudyLogReview(db, userId, id, action, today);
}, { mutating: true });
