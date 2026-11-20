import { api, body } from "@/server/http";
import { getCheckin, saveCheckin } from "@/server/checkins";
import { gameDay } from "@/lib/time";

export const GET = api(async ({ db, userId, session, req }) => {
  const date = new URL(req.url).searchParams.get("date") ?? gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  return { checkin: (await getCheckin(db, userId, date)) };
});

export const POST = api(async ({ db, userId, req, session }) => {
  const t0 = performance.now();
  const row = (await saveCheckin(db, userId, await body(req), { tz: session.user.timezone, rolloverHour: session.user.rolloverHour }));
  return { checkin: row, ms: Math.round(performance.now() - t0) };
});
