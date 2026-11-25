import { z } from "zod";
import { api, body } from "@/server/http";
import { setQuestTier } from "@/server/quests";
import { afterLog } from "@/server/after";
import { gameDay } from "@/lib/time";

const input = z.object({
  tier: z.enum(["seed", "standard", "stretch"]).nullable(),
  clientRequestId: z.string().min(1).max(80).optional(),
});

export const POST = api(async ({ db, userId, req, params, session }) => {
  const { id } = await params;
  const { tier, clientRequestId } = input.parse(await body(req));
  (await setQuestTier(db, userId, id!, tier, clientRequestId));
  return (await afterLog(db, userId, gameDay(new Date(), session.user.timezone, session.user.rolloverHour)));
});
