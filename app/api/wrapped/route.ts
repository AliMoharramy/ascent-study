import { api } from "@/server/http";
import { wrappedView } from "@/server/wrapped";
import { gameDay } from "@/lib/time";

export const GET = api(async ({ db, userId, session, req }) => {
  const d = gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  const w = new URL(req.url).searchParams.get("week");
  return (await wrappedView(db, userId, d, w ? Number(w) : undefined));
});