import { z } from "zod";
import { ApiError, api, body } from "@/server/http";
import { aiCallLog, aiStatus, anomalyAlerts, errorAnalysis, narrative, weeklyReview } from "@/server/ai";
import { takeToken } from "@/server/ratelimit";
import { gameDay } from "@/lib/time";
import { taskSuggestion } from "@/server/taskSuggestions";

export const maxDuration = 60;

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => {
  const d = day(session);
  return { status: (await aiStatus(db, userId, d)), log: (await aiCallLog(db, userId)), anomalies: await anomalyAlerts(db, userId, d) };
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("weekly"), refresh: z.boolean().default(false) }),
  z.object({ action: z.literal("errors") }),
  z.object({ action: z.literal("narrative") }),
  z.object({ action: z.literal("suggest_tasks") }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  // NFR-05: AI burst cap (3/min) on top of the daily call cap in config.
  const limit = takeToken(`ai:${userId}`, 3, 3);
  if (!limit.ok) throw new ApiError(429, "rate_limited", `AI is resting — retry in ${limit.retryAfterSec}s`);
  const b = input.parse(await body(req));
  const d = day(session);
  if (b.action === "weekly") return { weekly: await weeklyReview(db, userId, d, b.refresh), status: (await aiStatus(db, userId, d)) };
  if (b.action === "errors") return { analysis: await errorAnalysis(db, userId, d) };
  if (b.action === "narrative") return { narrative: await narrative(db, userId, d) };
  return { suggestion: await taskSuggestion(db, userId, d, session.user.shareTaskTitlesWithAi) };
});
