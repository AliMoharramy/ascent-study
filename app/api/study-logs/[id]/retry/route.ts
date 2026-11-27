import { z } from "zod";
import { currentStudyGameDay, studyLogRetrySchema } from "@/domain/studyLog";
import { api, body } from "@/server/http";
import { retryStudyLog } from "@/server/studyLogs";

export const POST = api(async ({ db, userId, req, params, session }) => {
  const id = z.string().min(1).parse((await params).id);
  const input = studyLogRetrySchema.parse(await body(req));
  const today = currentStudyGameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  return await retryStudyLog(db, userId, id, input, today);
}, { mutating: true });
