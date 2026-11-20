import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { dailyCheckins } from "@/db/schema";
import { appendEvent } from "@/events/store";
import { newId, nowIso } from "@/lib/ids";
import { gameDay, gameDayBounds } from "@/lib/time";

/**
 * Nightly check-in ≤ 1 minute (F-LOG-05, doc 05 §4.2): energy for 3 periods, biggest blocker,
 * biggest escape, class attendance. One row per game day; editable for 24 h after the day ends.
 */

const energy = z.coerce.number().int().min(1).max(5).nullish();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM").nullish();

export const ESCAPE_KINDS = ["coding", "new_idea", "social", "video", "games", "news", "other"] as const;

export const checkinInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  energyMorning: energy,
  energyNoon: energy,
  energyNight: energy,
  blocker: z.string().trim().max(300).nullish(),
  escapeMinutes: z.coerce.number().int().min(0).max(24 * 60).nullish(),
  escapeKind: z.enum(ESCAPE_KINDS).nullish(),
  classAttended: z.boolean().nullish(),
  wakeAt: hhmm,
  bedAt: hhmm,
  note: z.string().trim().max(1000).nullish(),
});

export type CheckinInput = z.input<typeof checkinInput>;

export class CheckinLocked extends Error {}

/** A day's check-in can be edited until 24 h after that game day ends. */
export function isEditable(day: string, now: Date, tz?: string, rolloverHour?: number): boolean {
  const { end } = gameDayBounds(day, tz, rolloverHour);
  return now.getTime() < end.getTime() + 24 * 3_600_000;
}

export async function saveCheckin(db: Db, userId: string, input: CheckinInput, opts: { now?: Date; tz?: string; rolloverHour?: number; manual?: boolean } = {}) {
  const d = checkinInput.parse(input);
  const now = opts.now ?? new Date();
  const date = d.date ?? gameDay(now, opts.tz, opts.rolloverHour);
  if (!opts.manual && !isEditable(date, now, opts.tz, opts.rolloverHour)) throw new CheckinLocked("Check-ins can only be edited for 24 hours after the day ends");
  const values = {
    energyMorning: d.energyMorning ?? null,
    energyNoon: d.energyNoon ?? null,
    energyNight: d.energyNight ?? null,
    blocker: d.blocker || null,
    escapeMinutes: d.escapeMinutes ?? null,
    escapeKind: d.escapeKind ?? null,
    classAttended: d.classAttended ?? null,
    wakeAt: d.wakeAt ?? null,
    bedAt: d.bedAt ?? null,
    note: d.note || null,
    updatedAt: nowIso(),
  };
  return await withUserTransaction(db, userId, async (tx) => {
    const existing = (await tx.select().from(dailyCheckins).where(and(eq(dailyCheckins.userId, userId), eq(dailyCheckins.date, date))).limit(1))[0];
    if (existing) {
      await tx.update(dailyCheckins).set({ ...values, manual: existing.manual || !!opts.manual }).where(eq(dailyCheckins.id, existing.id));
    } else {
      await tx.insert(dailyCheckins).values({ id: newId(), userId, date, ...values, manual: !!opts.manual, createdAt: nowIso() });
    }
    await appendEvent(tx, { userId, type: "checkin.saved", payload: { date, ...values, updatedAt: undefined, manual: !!opts.manual }, occurredAt: now.toISOString(), source: opts.manual ? "import" : "app" });
    return (await tx.select().from(dailyCheckins).where(and(eq(dailyCheckins.userId, userId), eq(dailyCheckins.date, date))).limit(1))[0]!;
  });
}

export async function getCheckin(db: Db, userId: string, date: string) {
  return (await db.select().from(dailyCheckins).where(and(eq(dailyCheckins.userId, userId), eq(dailyCheckins.date, date))).limit(1))[0] ?? null;
}

export async function recentCheckins(db: Db, userId: string, limit = 14) {
  return await db.select().from(dailyCheckins).where(eq(dailyCheckins.userId, userId)).orderBy(desc(dailyCheckins.date)).limit(limit);
}
