import { api, body } from "@/server/http";
import { logTest, testsForDay } from "@/server/tests";
import { gameDay } from "@/lib/time";
import { afterLog } from "@/server/after";

export const GET = api(async ({ db, userId, session, req }) => {
  const day = new URL(req.url).searchParams.get("day") ?? gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  return (await testsForDay(db, userId, day));
});

export const POST = api(async ({ db, userId, req, session }) => {
  const row = (await logTest(db, userId, await body(req), { tz: session.user.timezone, rolloverHour: session.user.rolloverHour }));
  return { log: row, day: (await testsForDay(db, userId, row.gameDay)), ...(await afterLog(db, userId, row.gameDay, { chapterId: row.chapterId })) };
});
