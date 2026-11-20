import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { sleepLogs, wellnessLogs } from "@/db/schema";
import { sleepDebt } from "@/domain/wellness";
import { appendEvent, replayOf } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { nowIso } from "@/lib/ids";

/** Wellness suite (#88): mood/energy check-in, win log, wind-down ritual and weekly sleep debt. A mirror, never a score. */

export const wellnessInput = z.object({
  mood: z.number().int().min(1).max(5).nullish(),
  energy: z.number().int().min(1).max(5).nullish(),
  wins: z.array(z.string().trim().min(1).max(120)).max(3).default([]),
  winddown: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
  clientRequestId: z.string().max(80).nullish(),
});

export async function wellnessView(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const row = (await db.select().from(wellnessLogs).where(and(eq(wellnessLogs.userId, userId), eq(wellnessLogs.date, today))).limit(1))[0];
  const week = (await db.select().from(wellnessLogs).where(eq(wellnessLogs.userId, userId)).orderBy(desc(wellnessLogs.date)).limit(7)).reverse();
  const nights = (await db.select({ date: sleepLogs.date, minutes: sleepLogs.minutes }).from(sleepLogs).where(eq(sleepLogs.userId, userId)));
  return {
    today: row ? { mood: row.mood, energy: row.energy, wins: JSON.parse(row.winsJson) as string[], winddown: JSON.parse(row.winddownJson) as string[] } : null,
    series: week.map((w) => ({ date: w.date, mood: w.mood, energy: w.energy })),
    winddownChecklist: cfg.wellness.winddown,
    sleepDebt: sleepDebt(nights, cfg.sleep.minSleepHours, today),
    debtLimitHours: cfg.wellness.sleepDebtWeekHours,
  };
}

export async function logWellness(db: Db, userId: string, today: string, input: z.input<typeof wellnessInput>) {
  const { clientRequestId, ...p } = wellnessInput.parse(input);
  return await withUserTransaction(db, userId, async (tx) => {
    // A retried (e.g. offline-replayed) check-in is acknowledged without rewriting the stored row.
    if (await replayOf(tx, userId, "wellness.logged", clientRequestId, { ...p, day: today })) return await wellnessView(tx, userId, today);
    const values = { userId, date: today, mood: p.mood ?? null, energy: p.energy ?? null, winsJson: JSON.stringify(p.wins), winddownJson: JSON.stringify(p.winddown), updatedAt: nowIso() };
    await tx.insert(wellnessLogs)
      .values(values)
      .onConflictDoUpdate({ target: [wellnessLogs.userId, wellnessLogs.date], set: { mood: values.mood, energy: values.energy, winsJson: values.winsJson, winddownJson: values.winddownJson, updatedAt: values.updatedAt } });
    await appendEvent(tx, { userId, type: "wellness.logged", payload: { day: today, mood: p.mood ?? null, energy: p.energy ?? null, wins: p.wins.length, winddown: p.winddown.length, request: { ...p, day: today } }, gameDay: today, clientRequestId });
    return await wellnessView(tx, userId, today);
  });
}
