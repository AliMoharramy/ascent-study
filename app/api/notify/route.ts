import { z } from "zod";
import { api, body } from "@/server/http";
import { notifyView, pushSubscriptionInput, sendPush, sendTelegram, subscribePush, unsubscribePush } from "@/server/notify";

export const GET = api(async ({ db, userId }) => (await notifyView(db, userId)));

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("subscribe"), subscription: pushSubscriptionInput }),
  z.object({ action: z.literal("unsubscribe"), endpoint: z.string().max(500).optional() }),
  z.object({ action: z.literal("test") }),
]);

export const POST = api(async ({ db, userId, req }) => {
  const b = input.parse(await body(req));
  if (b.action === "subscribe") return (await subscribePush(db, userId, b.subscription));
  if (b.action === "unsubscribe") return (await unsubscribePush(db, userId, b.endpoint));
  const push = await sendPush(db, userId, { title: "THE ASCENT", body: "Push is working. Small steps, big climb.", url: "/today" });
  const telegram = await sendTelegram(db, userId, "THE ASCENT test: Telegram channel is working.");
  return { push, telegram, view: (await notifyView(db, userId)) };
});