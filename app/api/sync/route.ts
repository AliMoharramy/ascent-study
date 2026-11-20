import { api, body } from "@/server/http";
import { replaySync } from "@/server/sync";
import { gameDay } from "@/lib/time";

export const POST = api(async ({ db, userId, req, session }) => {
  const today = gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  return (await replaySync(db, userId, await body(req), { tz: session.user.timezone, rolloverHour: session.user.rolloverHour, today }));
});