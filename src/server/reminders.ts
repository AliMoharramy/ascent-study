import { and, eq, isNull, sql } from "drizzle-orm";
import { withUserTransaction, type Db } from "@/db/client";
import { habits, reminders, users } from "@/db/schema";
import { reminderText } from "@/domain/ai";
import { appendEvent } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { newId, nowIso } from "@/lib/ids";
import { localParts } from "@/lib/time";
import { dueStudyLogReviews } from "./studyLogs";

/**
 * Anchor reminders (#97, F-DUO-15): gentle nudges tied to real habit anchors plus three fixed anchors.
 * Tone is adjustable (calm/playful/direct), hard-capped at cfg.reminders.maxPerDay (≤ 5), zero blame,
 * and fully switchable. Nothing here pushes notifications — the bell shows what is due.
 */

interface Anchor {
  key: string;
  title: string;
  time: string;
}

const hhmm = (s: string) => (/^\d{2}:\d{2}$/.test(s) ? s : null);

async function anchorsFor(db: Db, userId: string, cfg: Awaited<ReturnType<typeof activeConfig>>): Promise<Anchor[]> {
  const hs = (await db.select().from(habits).where(and(eq(habits.userId, userId), sql`${habits.status} IN ('trial', 'active')`)));
  const fromHabits: Anchor[] = hs.map((h) => ({ key: `habit:${h.id}`, title: h.anchor || h.title, time: hhmm(h.timeWindow) ?? "09:00" }));
  const bed = cfg.sleep.targetBed;
  const [bh, bm] = bed.split(":").map(Number);
  const wind = new Date(Date.UTC(2000, 0, 1, bh!, bm! - 30));
  const windTime = `${String(wind.getUTCHours()).padStart(2, "0")}:${String(wind.getUTCMinutes()).padStart(2, "0")}`;
  const fixed: Anchor[] = [
    { key: "fixed:core", title: "Today's Core block", time: "09:00" },
    { key: "fixed:nightly", title: "Nightly review (2 minutes)", time: "22:30" },
    { key: "fixed:winddown", title: "Wind-down ritual", time: windTime },
  ];
  return [...fromHabits, ...fixed].sort((a, b) => a.time.localeCompare(b.time));
}

export async function ensureTodayReminders(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  if (!cfg.reminders.enabled || cfg.reminders.maxPerDay === 0) return 0;
  const studyReviews = await dueStudyLogReviews(tx, userId, today);
  const studyAnchors: Anchor[] = studyReviews.map((review) => ({
    key: `study-review:${review.id}`,
    title: `Study review: ${review.topic} · checkpoint ${review.checkpoint}`,
    time: "09:00",
  }));
  const picked = [...studyAnchors, ...(await anchorsFor(tx, userId, cfg))].slice(0, cfg.reminders.maxPerDay);
  // Dismissed rows still count toward the date's cap, so completing a review cannot free a new slot.
  const existing = await tx.select({ anchorKey: reminders.anchorKey }).from(reminders)
    .where(and(eq(reminders.userId, userId), eq(reminders.date, today)));
  const existingKeys = new Set(existing.map((reminder) => reminder.anchorKey));
  const remainingSlots = Math.max(0, cfg.reminders.maxPerDay - existing.length);
  const toCreate = picked.filter((anchor) => !existingKeys.has(anchor.key)).slice(0, remainingSlots);
  let created = 0;
  for (const a of toCreate) {
    const text = reminderText(a.title, cfg.reminders.tone);
    const r = (await tx
      .insert(reminders)
      .values({ id: newId(), userId, date: today, anchorKey: a.key, title: text.title, body: text.body, dueAt: `${today}T${a.time}:00`, createdAt: nowIso() })
      .onConflictDoNothing());
    created += r.rowCount ?? 0;
  }
  return created;
});
}

export async function remindersView(db: Db, userId: string, today: string, now = new Date()) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  (await ensureTodayReminders(tx, userId, today));
  const tz = (await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1))[0]?.tz ?? "Asia/Tehran";
  const lp = localParts(now, tz);
  const nowLocal = `${lp.date}T${String(lp.hour).padStart(2, "0")}:${String(lp.minute).padStart(2, "0")}:00`;
  const rows = (await tx.select().from(reminders).where(and(eq(reminders.userId, userId), eq(reminders.date, today), isNull(reminders.dismissedAt))));
  const items = rows.map((r) => ({ ...r, due: r.dueAt <= nowLocal, read: !!r.readAt })).sort((a, b) => Number(a.read) - Number(b.read) || a.dueAt.localeCompare(b.dueAt));
  return { enabled: cfg.reminders.enabled, tone: cfg.reminders.tone, maxPerDay: cfg.reminders.maxPerDay, items, unread: items.filter((i) => !i.read && i.due).length };
});
}

export async function markReminderRead(db: Db, userId: string, id: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const r = (await tx.select().from(reminders).where(and(eq(reminders.id, id), eq(reminders.userId, userId), isNull(reminders.dismissedAt))).limit(1))[0];
  if (!r) throw new Error("Unknown reminder");
  if (!r.readAt) {
    (await tx.update(reminders).set({ readAt: nowIso() }).where(eq(reminders.id, id)));
    (await appendEvent(tx, { userId, type: "reminder.read", payload: { reminderId: id, anchorKey: r.anchorKey }, gameDay: today }));
  }
  return (await remindersView(tx, userId, today));
});
}
