import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { z } from "zod";
import type { Db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { appendEvent } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { newId, nowIso } from "@/lib/ids";
import { getKv, setKv } from "./kv";
import { ensureTodayReminders, remindersView } from "./reminders";

/**
 * Outbound notifications (#109, F-NOT-02/03, F-INT-01). Push requires per-device browser permission; Telegram
 * requires an environment token and configured chat id. Both carry the same gentle reminders the in-app bell
 * shows — never guilt, never streak-shaming (A2). Every send is logged as `notify.sent`.
 * VAPID keys are generated once per user and kept in their kv store (all data is user-scoped).
 */

async function vapid(db: Db, userId: string): Promise<{ publicKey: string; privateKey: string }> {
  let keys = await getKv<{ publicKey: string; privateKey: string } | null>(db, userId, "push.vapid", null);
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    await setKv(db, userId, "push.vapid", keys);
  }
  return keys;
}

export const pushSubscriptionInput = z.object({
  endpoint: z.string().url().max(500),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export async function notifyView(db: Db, userId: string) {
  const cfg = await activeConfig(db, userId);
  const devices = (await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))).length;
  return {
    push: { enabled: cfg.notifications.push.enabled, publicKey: (await vapid(db, userId)).publicKey, devices },
    telegram: { enabled: cfg.notifications.telegram.enabled, chatId: cfg.notifications.telegram.chatId, tokenSet: !!process.env.TELEGRAM_BOT_TOKEN },
    reminders: { enabled: cfg.reminders.enabled, tone: cfg.reminders.tone, maxPerDay: cfg.reminders.maxPerDay },
  };
}

export async function subscribePush(db: Db, userId: string, input: z.input<typeof pushSubscriptionInput>) {
  const s = pushSubscriptionInput.parse(input);
  await db.insert(pushSubscriptions)
    .values({ id: newId(), userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, createdAt: nowIso() })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: s.keys.p256dh, auth: s.keys.auth } });
  return await notifyView(db, userId);
}

export async function unsubscribePush(db: Db, userId: string, endpoint?: string) {
  // Scope by user so one account can never remove another account's device.
  if (endpoint) await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  else await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  return await notifyView(db, userId);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export async function sendPush(db: Db, userId: string, payload: PushPayload) {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  const keys = await vapid(db, userId);
  webpush.setVapidDetails("mailto:ascent@localhost", keys.publicKey, keys.privateKey);
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      failed++;
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    }
  }
  if (subs.length > 0) await appendEvent(db, { userId, type: "notify.sent", payload: { channel: "push", title: payload.title, sent, failed }, source: "app" });
  return { sent, failed };
}

export async function sendTelegram(db: Db, userId: string, text: string) {
  const cfg = await activeConfig(db, userId);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = cfg.notifications.telegram.chatId;
  if (!token || !chatId) return { sent: false, reason: "Telegram token or chat id not set" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const ok = res.ok;
    await appendEvent(db, { userId, type: "notify.sent", payload: { channel: "telegram", ok }, source: "app" });
    return { sent: ok, reason: ok ? undefined : `Telegram API ${res.status}` };
  } catch (e) {
    await appendEvent(db, { userId, type: "notify.sent", payload: { channel: "telegram", ok: false }, source: "app" });
    return { sent: false, reason: e instanceof Error ? e.message : "Network error" };
  }
}

/**
 * Cron dispatcher: pushes the same due anchor reminders the bell shows, capped at
 * cfg.reminders.maxPerDay per day (shared cap across channels). Deduped via a per-day kv list.
 */
export async function dispatchReminders(db: Db, userId: string, today: string, now = new Date()) {
  const cfg = await activeConfig(db, userId);
  if (!cfg.reminders.enabled || cfg.reminders.maxPerDay === 0) return 0;
  const pushOn = cfg.notifications.push.enabled;
  const telegramOn = cfg.notifications.telegram.enabled && !!process.env.TELEGRAM_BOT_TOKEN && !!cfg.notifications.telegram.chatId;
  if (!pushOn && !telegramOn) return 0;
  await ensureTodayReminders(db, userId, today);
  const view = await remindersView(db, userId, today, now);
  const key = `notify.dispatched.${today}`;
  const dispatched = await getKv<string[]>(db, userId, key, []);
  let sent = 0;
  for (const item of view.items) {
    if (dispatched.length >= cfg.reminders.maxPerDay) break;
    if (!item.due || item.read || dispatched.includes(item.id)) continue;
    const text = `${item.title} — ${item.body}`;
    if (pushOn) await sendPush(db, userId, { title: item.title, body: item.body, url: "/today" });
    if (telegramOn) await sendTelegram(db, userId, text);
    dispatched.push(item.id);
    sent++;
  }
  if (sent > 0) await setKv(db, userId, key, dispatched);
  return sent;
}
