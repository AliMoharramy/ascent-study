import { z } from "zod";
import { api, body } from "@/server/http";
import { markReminderRead, remindersView } from "@/server/reminders";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => (await remindersView(db, userId, day(session))));

const input = z.object({ id: z.string().max(40) });

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  return (await markReminderRead(db, userId, b.id, day(session)));
});