import { z } from "zod";
import { api, body } from "@/server/http";
import { getRestDays, restDaysInWeek, setRestDay } from "@/server/restDays";
import { gameDay } from "@/lib/time";

export const GET = api(async ({ db, userId, session }) => {
  const today = gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  return { days: (await getRestDays(db, userId)), week: (await restDaysInWeek(db, userId, today)), today };
});

const input = z.object({ action: z.enum(["set", "remove"]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export const POST = api(async ({ db, userId, req }) => {
  const b = input.parse(await body(req));
  return { days: (await setRestDay(db, userId, b.date, b.action === "set", b.today)) };
});
