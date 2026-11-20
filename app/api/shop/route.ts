import { z } from "zod";
import { api, body } from "@/server/http";
import { achievementsView, anomalyLog, claimReward, saveReward, shopView } from "@/server/shop";
import { gameDay } from "@/lib/time";

const day = (s: { user: { timezone: string; rolloverHour: number } }) => gameDay(new Date(), s.user.timezone, s.user.rolloverHour);

export const GET = api(async ({ db, userId, session }) => ({ shop: (await shopView(db, userId, day(session))), achievements: (await achievementsView(db, userId, day(session))), anomalies: (await anomalyLog(db, userId)) }));

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), rewardId: z.string().max(40) }),
  z.object({ action: z.literal("save"), id: z.string().max(40).optional(), title: z.string(), goldCost: z.number(), moneyCost: z.number().optional(), enabled: z.boolean().optional() }),
]);

export const POST = api(async ({ db, userId, req, session }) => {
  const b = input.parse(await body(req));
  if (b.action === "claim") (await claimReward(db, userId, b.rewardId, day(session)));
  else {
    const { action: _a, id, ...r } = b;
    (await saveReward(db, userId, r, id));
  }
  return { shop: (await shopView(db, userId, day(session))) };
});
