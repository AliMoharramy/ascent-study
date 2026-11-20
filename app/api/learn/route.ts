import { z } from "zod";
import { api, body } from "@/server/http";
import { applyScheduler, interleaveView, logPretest, masteryView, pretestInput } from "@/server/learning";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => {
  const d = day(session);
  return { mastery: (await masteryView(db, userId)), interleave: (await interleaveView(db, userId, d)), scheduled: (await applyScheduler(db, userId)) };
});

const input = z.discriminatedUnion("action", [z.object({ action: z.literal("pretest"), pretest: pretestInput })]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  const d = day(session);
  return { pretest: (await logPretest(db, userId, b.pretest, d)), mastery: (await masteryView(db, userId)) };
});