import { z } from "zod";
import { api, body } from "@/server/http";
import { capacityView, generatePlan, moveItem, overrideTier, planView, resetWeek, saveWindows, triage } from "@/server/plan";
import { currentConfig } from "@/server/config";
import { regenerateDay } from "@/server/quests";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => {
  const cfg = (await currentConfig(db, userId));
  return { ...(await planView(db, userId, day(session), cfg)), capacity: (await capacityView(db, userId, day(session), cfg)) };
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate") }),
  z.object({ action: z.literal("rebalance") }),
  z.object({ action: z.literal("reset_week") }),
  z.object({ action: z.literal("triage") }),
  z.object({ action: z.literal("move"), itemId: z.string().max(40), toWeek: z.number().int() }),
  z.object({ action: z.literal("override"), chapterId: z.string().max(60), tier: z.enum(["M", "S", "C"]).nullable(), reason: z.string().max(300) }),
  z.object({ action: z.literal("windows"), windows: z.array(z.unknown()), exceptions: z.array(z.unknown()).optional() }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  const cfg = (await currentConfig(db, userId));
  const d = day(session);
  let extra: Record<string, unknown> = {};
  switch (b.action) {
    case "generate":
      extra = { result: (await generatePlan(db, userId, d, cfg)) };
      break;
    case "rebalance":
      extra = { result: (await generatePlan(db, userId, d, cfg, { mode: "rebalance" })) };
      break;
    case "reset_week":
      extra = { reset: (await resetWeek(db, userId, d, cfg)) };
      break;
    case "triage":
      extra = { triage: (await triage(db, userId, cfg)) };
      break;
    case "move":
      (await moveItem(db, userId, b.itemId, b.toWeek));
      break;
    case "override":
      extra = { override: (await overrideTier(db, userId, b.chapterId, b.tier, b.reason)) };
      break;
    case "windows":
      (await saveWindows(db, userId, b.windows, b.exceptions));
      break;
  }
  if (b.action !== "move" && b.action !== "override") (await regenerateDay(db, userId, d));
  return { ...extra, view: (await planView(db, userId, d, cfg)), capacity: (await capacityView(db, userId, d, cfg)) };
});
