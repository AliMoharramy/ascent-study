import { z } from "zod";
import { api, body } from "@/server/http";
import { energyView, forecastView, miningView, rankView, skipView, timeView, weakView, whatIfView } from "@/server/insights";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => {
  const d = day(session);
  return { forecast: (await forecastView(db, userId, d)), energy: (await energyView(db, userId)), weak: (await weakView(db, userId)), mining: (await miningView(db, userId, d)), time: (await timeView(db, userId, d)), skip: (await skipView(db, userId, d)), rank: (await rankView(db, userId, d)) };
});

const input = z.object({
  drop: z.array(z.string().max(60)).max(60).default([]),
  add: z.array(z.object({ chapterId: z.string().max(60), tier: z.enum(["M", "S", "C"]), plannedMin: z.number().int().min(0).max(100_000) })).max(60).default([]),
});

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  return { whatIf: (await whatIfView(db, userId, day(session), b.drop, b.add)) };
});