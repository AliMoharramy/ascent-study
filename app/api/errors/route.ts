import { api, body } from "@/server/http";
import { causeBreakdown, listErrors, logError } from "@/server/forge";
import { afterLog } from "@/server/after";
import { gameDay } from "@/lib/time";

export const GET = api(async ({ db, userId, req }) => {
  const u = new URL(req.url).searchParams;
  return { items: (await listErrors(db, userId, { q: u.get("q") ?? undefined, cause: u.get("cause") ?? undefined, subjectId: u.get("subject") ?? undefined })), causes: (await causeBreakdown(db, userId)) };
});

export const POST = api(async ({ db, userId, req, session }) => {
  const d = gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  const id = (await logError(db, userId, await body(req), d));
  return { id, ...(await afterLog(db, userId, d)) };
});
