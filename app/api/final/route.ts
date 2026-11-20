import { z } from "zod";
import { api, body } from "@/server/http";
import { breathInput, checklistInput, finalView, logBreath, tickChecklist } from "@/server/final";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => (await finalView(db, userId, day(session))));

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tick"), key: checklistInput.shape.key, done: z.boolean() }),
  z.object({ action: z.literal("breath"), cycles: breathInput.shape.cycles, seconds: breathInput.shape.seconds }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  if (b.action === "breath") return (await logBreath(db, userId, { cycles: b.cycles, seconds: b.seconds }, day(session)));
  return (await tickChecklist(db, userId, { key: b.key, done: b.done }, day(session)));
});