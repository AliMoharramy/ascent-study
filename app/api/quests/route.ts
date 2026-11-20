import { z } from "zod";
import { api, body } from "@/server/http";
import { gameDay } from "@/lib/time";
import { generateDay, questsForDay, refreshProgress, rollover, useShield, declareLifeEvent } from "@/server/quests";
import { xpSummary } from "@/events/projections";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => {
  const d = day(session);
  (await rollover(db, userId, d));
  (await refreshProgress(db, userId, d));
  return { day: d, quests: (await questsForDay(db, userId, d)) };
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("shield"), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("life_event"), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reason: z.string().max(300) }),
  z.object({ action: z.literal("generate") }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  const d = day(session);
  if (b.action === "shield") (await useShield(db, userId, b.day));
  if (b.action === "life_event") return { ...(await declareLifeEvent(db, userId, b.day ?? d, b.reason)), quests: (await questsForDay(db, userId, d)) };
  if (b.action === "generate") (await generateDay(db, userId, d));
  return { quests: (await questsForDay(db, userId, d)), xp: (await xpSummary(db, userId, d)) };
});
