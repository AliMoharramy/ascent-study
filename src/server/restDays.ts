import { withUserTransaction, type Db } from "@/db/client";
import { appendEvent } from "@/events/store";
import { addDaysIso, weekStartSaturday } from "@/i18n/jalali";
import { getKv, setKv } from "./kv";

/**
 * Rest Day Pass (F-DUO-02): one scheduled rest day per Saturday-based week.
 * A rest day is stored as a capacity exception with 0 minutes, so the planner re-sizes the week,
 * and day-close treats it as forgiven (no penalties, flame intact).
 */

const KEY = "rest.days";

export class RestDayDenied extends Error {}

export async function getRestDays(db: Db, userId: string): Promise<string[]> {
  return (await getKv<string[]>(db, userId, KEY, [])).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}

export async function isRestDay(db: Db, userId: string, day: string): Promise<boolean> {
  return (await getRestDays(db, userId)).includes(day);
}

export async function restDaysInWeek(db: Db, userId: string, day: string): Promise<string[]> {
  const start = weekStartSaturday(day);
  const end = addDaysIso(start, 6);
  return (await getRestDays(db, userId)).filter((d) => d >= start && d <= end);
}

/** Adds/removes a planned rest day. Throws RestDayDenied for past days or a second day in the same week. */
export async function setRestDay(db: Db, userId: string, day: string, on: boolean, today: string): Promise<string[]> {
  return await withUserTransaction(db, userId, async (tx) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RestDayDenied("Invalid date");
  const days = (await getRestDays(tx, userId));
  if (!on) {
    const next = days.filter((d) => d !== day);
    (await setKv(tx, userId, KEY, next));
    (await appendEvent(tx, { userId, type: "rest_day.removed", payload: { day }, gameDay: day }));
    return next;
  }
  if (day < today) throw new RestDayDenied("Only today or a future day can be planned as rest");
  const others = (await restDaysInWeek(tx, userId, day)).filter((d) => d !== day);
  if (others.length) throw new RestDayDenied(`One rest day per week — ${others[0]} is already planned`);
  if (days.includes(day)) return days;
  const next = [...days, day].sort();
  (await setKv(tx, userId, KEY, next));
  (await appendEvent(tx, { userId, type: "rest_day.set", payload: { day }, gameDay: day }));
  return next;
});
}
