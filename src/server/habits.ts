import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import type { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { habitLogs, habits, type HabitStatus } from "@/db/schema";
import { canActivate, DEFAULT_HABITS, habitSpecSchema, implementationIntention, lifecycle, MAX_ACTIVE_HABITS, scorecardItemSchema } from "@/domain/habits";
import { tierRank } from "@/domain/quests";
import { shapingSuggestion } from "@/domain/wellness";
import { appendEvent } from "@/events/store";
import { addDaysIso, diffDaysIso } from "@/i18n/jalali";
import { newId, nowIso } from "@/lib/ids";
import { getKv, setKv } from "./kv";

/** Habit Lab service (T-R1-14 / F-HAB-01/02/06): CRUD, tiers, logs, lifecycle, Scorecard, default seed. */

export type HabitRow = typeof habits.$inferSelect;
export const ACTIVE: HabitStatus[] = ["trial", "active"];

export function parseHabit(h: HabitRow) {
  return { ...h, tiers: JSON.parse(h.tiersJson) as { seed: string; standard: string; stretch: string }, metric: JSON.parse(h.metricJson) as { type: string; standard: number }, intention: implementationIntention({ anchor: h.anchor, timeWindow: h.timeWindow, place: h.place, tiers: JSON.parse(h.tiersJson) }) };
}

export async function seedDefaultHabits(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const has = (await tx.select({ id: habits.id }).from(habits).where(eq(habits.userId, userId)).limit(1))[0];
  if (has) return 0;
  const now = nowIso();
  (await withUserTransaction(tx, userId, async (tx) => {
    for (const [i, raw] of DEFAULT_HABITS.entries()) {
      const h = habitSpecSchema.parse(raw);
      await tx.insert(habits).values({ id: newId(), userId, key: h.key ?? null, title: h.title, pillar: h.pillar, identity: h.identity, anchor: h.anchor, place: h.place, timeWindow: h.timeWindow, tiersJson: JSON.stringify(h.tiers), metricJson: JSON.stringify(h.metric), temptation: h.temptation, envPrep: h.envPrep, daysPerWeek: h.daysPerWeek, contractSs: h.contractSs, xp: h.xp, status: h.status, startedOn: ACTIVE.includes(h.status) ? today : null, sort: i, createdAt: now, updatedAt: now });
    }
  }));
  return DEFAULT_HABITS.length;
});
}

export async function listHabits(db: Db, userId: string) {
  return (await db.select().from(habits).where(eq(habits.userId, userId)).orderBy(asc(habits.sort), asc(habits.createdAt))).map(parseHabit);
}

const activeCount = async (db: Db, userId: string, exceptId?: string) =>
  (await db.select({ id: habits.id }).from(habits).where(and(eq(habits.userId, userId), inArray(habits.status, ACTIVE), exceptId ? ne(habits.id, exceptId) : undefined))).length;

export class HabitLimit extends Error {}

export async function saveHabit(db: Db, userId: string, input: z.input<typeof habitSpecSchema>, today: string, id?: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const h = habitSpecSchema.parse(input);
  if (ACTIVE.includes(h.status as HabitStatus)) {
    const c = canActivate((await activeCount(tx, userId, id)));
    if (!c.ok) throw new HabitLimit(c.reason);
  }
  const now = nowIso();
  const values = { title: h.title, key: h.key ?? null, pillar: h.pillar, identity: h.identity, anchor: h.anchor, place: h.place, timeWindow: h.timeWindow, tiersJson: JSON.stringify(h.tiers), metricJson: JSON.stringify(h.metric), temptation: h.temptation, envPrep: h.envPrep, daysPerWeek: h.daysPerWeek, contractSs: h.contractSs, xp: h.xp, status: h.status, updatedAt: now };
  return (await withUserTransaction(tx, userId, async (tx) => {
    if (id) {
      const prev = (await tx.select().from(habits).where(and(eq(habits.id, id), eq(habits.userId, userId))).limit(1))[0];
      if (!prev) throw new Error("Unknown habit");
      (await tx.update(habits).set({ ...values, startedOn: prev.startedOn ?? (ACTIVE.includes(h.status as HabitStatus) ? today : null) }).where(eq(habits.id, id)));
      (await appendEvent(tx, { userId, type: "habit.updated", payload: { habitId: id, status: h.status, from: prev.status } }));
      return id;
    }
    const nid = newId();
    (await tx.insert(habits).values({ id: nid, userId, ...values, startedOn: ACTIVE.includes(h.status as HabitStatus) ? today : null, sort: 100, createdAt: now }));
    (await appendEvent(tx, { userId, type: "habit.created", payload: { habitId: nid, title: h.title, pillar: h.pillar } }));
    return nid;
  }));
});
}

export async function setHabitStatus(db: Db, userId: string, id: string, status: HabitStatus, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const h = (await tx.select().from(habits).where(and(eq(habits.id, id), eq(habits.userId, userId))).limit(1))[0];
  if (!h) throw new Error("Unknown habit");
  if (ACTIVE.includes(status) && !ACTIVE.includes(h.status)) {
    const c = canActivate((await activeCount(tx, userId)));
    if (!c.ok) throw new HabitLimit(c.reason);
  }
  (await tx.update(habits).set({ status, startedOn: h.startedOn ?? today, updatedAt: nowIso() }).where(eq(habits.id, id)));
  (await appendEvent(tx, { userId, type: "habit.updated", payload: { habitId: id, status, from: h.status } }));
});
}

/** Logs a habit for a day at a tier (null clears). Pillar XP is projected from `habit.logged`. */
export async function logHabit(db: Db, userId: string, habitId: string, day: string, tier: "seed" | "standard" | "stretch" | null, value?: number | null, note?: string | null) {
  return await withUserTransaction(db, userId, async (tx) => {
  const h = (await tx.select().from(habits).where(and(eq(habits.id, habitId), eq(habits.userId, userId))).limit(1))[0];
  if (!h) throw new Error("Unknown habit");
  return (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.delete(habitLogs).where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.date, day))));
    if (tier) (await tx.insert(habitLogs).values({ id: newId(), habitId, userId, date: day, tierDone: tier, value: value ?? null, note: note ?? null, createdAt: nowIso() }));
    (await appendEvent(tx, { userId, type: "habit.logged", payload: { habitId, tier, xp: h.status === "mastered" ? h.xp / 2 : h.xp, pillar: h.pillar, gameDay: day }, gameDay: day }));
    return tier;
  }));
});
}

export async function habitLogsSince(db: Db, userId: string, since: string) {
  return (await db.select().from(habitLogs).where(and(eq(habitLogs.userId, userId), gte(habitLogs.date, since))));
}

/** Consistency (7/30 days) per habit + 12-week heat-map + lifecycle promotion (issue #75). */
export async function habitStats(db: Db, userId: string, today: string) {
  const since = addDaysIso(today, -83);
  const logs = (await habitLogsSince(db, userId, since));
  return (await listHabits(db, userId)).map((h) => {
    const mine = logs.filter((l) => l.habitId === h.id);
    const days = (n: number) => Array.from({ length: n }, (_, i) => addDaysIso(today, -(n - 1 - i)));
    const hit = (d: string) => mine.find((l) => l.date === d)?.tierDone ?? null;
    const expected = (n: number) => Math.max(1, Math.round((n * h.daysPerWeek) / 7));
    const c7 = Math.min(1, days(7).filter((d) => hit(d)).length / expected(7));
    const c30 = Math.min(1, days(30).filter((d) => hit(d)).length / expected(30));
    const aboveSeed = mine.filter((l) => tierRank(l.tierDone) >= 2).length / Math.max(1, mine.length);
    const since0 = h.startedOn ? diffDaysIso(today, h.startedOn) : 0;
    const heat12w = days(84).map((d) => ({ d, tier: hit(d) }));
    const weeks = Array.from({ length: 12 }, (_, w) => {
      const cells = heat12w.slice(w * 7, w * 7 + 7);
      return { start: cells[0]!.d, done: cells.filter((c) => c.tier).length, cells };
    });
    return { ...h, c7, c30, seedToStandard: aboveSeed, heat: heat12w.slice(-28), heat12w, weeks, today: hit(today), suggested: lifecycle(h.status, since0, c30) };
  });
}

/** Habit shaping (#96, F-HAB-07): after 7 consecutive successful days propose +5 % (at least +1). */
export async function shapingView(db: Db, userId: string, today: string) {
  const logs = (await habitLogsSince(db, userId, addDaysIso(today, -30)));
  return (await listHabits(db, userId))
    .filter((h) => ACTIVE.includes(h.status))
    .map((h) => {
      const successDays = logs.filter((l) => l.habitId === h.id && l.tierDone).map((l) => l.date);
      const currentTarget = h.metric.type === "check" ? null : h.metric.standard;
      return { habitId: h.id, title: h.title, metricType: h.metric.type, currentTarget, ...shapingSuggestion(successDays, today, currentTarget) };
    });
}

export async function acceptShaping(db: Db, userId: string, habitId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const h = (await listHabits(tx, userId)).find((x) => x.id === habitId);
  if (!h) throw new Error(`Unknown habit ${habitId}`);
  const s = (await shapingView(tx, userId, today)).find((x) => x.habitId === habitId);
  if (!s?.propose) throw new HabitLimit("No shaping suggestion ready — it takes 7 consecutive successful days");
  (await tx.update(habits)
    .set({ metricJson: JSON.stringify({ ...h.metric, standard: s.propose }), updatedAt: nowIso() })
    .where(eq(habits.id, habitId)));
  (await appendEvent(tx, { userId, type: "shaping.accepted", payload: { habitId, from: s.currentTarget, to: s.propose, streak: s.streak }, gameDay: today }));
  return (await shapingView(tx, userId, today));
});
}

export async function scorecard(db: Db, userId: string) {
  return (await getKv<z.output<typeof scorecardItemSchema>[]>(db, userId, "habits.scorecard", []));
}

export async function saveScorecard(db: Db, userId: string, items: unknown) {
  return await withUserTransaction(db, userId, async (tx) => {
  const parsed = scorecardItemSchema.array().max(60).parse(items);
  (await setKv(tx, userId, "habits.scorecard", parsed));
  return parsed;
});
}

export { MAX_ACTIVE_HABITS };
