import { and, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, queryOne, type Db } from "@/db/client";
import { dayCloses, sleepLogs, wellnessLogs } from "@/db/schema";
import { buddyReportText, burnoutRadar, type BuddySummary } from "@/domain/burnout";
import { sleepDebt } from "@/domain/wellness";
import { appendEvent } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { addDaysIso } from "@/i18n/jalali";
import { weekNoOf, weekStartOf } from "@/lib/campaign";
import { getKv, setKv } from "./kv";

/** Burnout radar + accountability buddy (#101, F-WEL-06 / F-SOC-01). A mirror, never a penalty. */

export class BuddyConsentRequired extends Error {}

interface BuddyConsent {
  consented: boolean;
  name: string;
  at: string | null;
}

const CONSENT_KEY = "buddy.consent";
const consentOf = async (db: Db, userId: string) => (await getKv<BuddyConsent>(db, userId, CONSENT_KEY, { consented: false, name: "", at: null }));

export async function burnoutView(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const from = addDaysIso(today, -6);
  const checkins = (await db.select().from(wellnessLogs).where(and(eq(wellnessLogs.userId, userId), gte(wellnessLogs.date, from), lte(wellnessLogs.date, today))));
  const energies = checkins.map((c) => c.energy).filter((v): v is number => v !== null);
  const moods = checkins.map((c) => c.mood).filter((v): v is number => v !== null);
  const nights = (await db.select({ date: sleepLogs.date, minutes: sleepLogs.minutes }).from(sleepLogs).where(eq(sleepLogs.userId, userId)));
  const debt = sleepDebt(nights, cfg.sleep.minSleepHours, today);
  const weekNights = nights.filter((n) => n.date >= from && n.date <= today);
  const closes = (await db.select({ std: dayCloses.standardDay }).from(dayCloses).where(and(eq(dayCloses.userId, userId), gte(dayCloses.date, from), lte(dayCloses.date, today))));
  const focusMin = (await queryOne<{ v: number | null }>(db, sql`SELECT coalesce(sum(minutes),0) v FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day BETWEEN ${from} AND ${today}`))?.v ?? 0;
  const radar = burnoutRadar(
    {
      sleepDebtHours: debt.debtHours,
      sleepDebtLimit: cfg.wellness.sleepDebtWeekHours,
      avgSleepHours: weekNights.length ? Math.round((weekNights.reduce((s, n) => s + n.minutes, 0) / weekNights.length / 60) * 10) / 10 : null,
      minSleepHours: cfg.sleep.minSleepHours,
      energyAvg: energies.length ? energies.reduce((s, v) => s + v, 0) / energies.length : null,
      moodAvg: moods.length ? moods.reduce((s, v) => s + v, 0) / moods.length : null,
      checkins: Math.max(energies.length, moods.length),
      consistency: closes.length ? closes.filter((c) => c.std).length / closes.length : 0,
      focusHours: Math.round((focusMin / 60) * 10) / 10,
    },
    cfg.burnout,
  );
  return { ...radar, window: { from, to: today }, thresholds: cfg.burnout, consent: (await consentOf(db, userId)) };
}

export const buddyConsentInput = z.object({ consented: z.boolean(), name: z.string().trim().max(60).default("") });

export async function setBuddyConsent(db: Db, userId: string, input: z.input<typeof buddyConsentInput>, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const p = buddyConsentInput.parse(input);
  const value: BuddyConsent = { consented: p.consented, name: p.name, at: new Date().toISOString() };
  (await setKv(tx, userId, CONSENT_KEY, value));
  (await appendEvent(tx, { userId, type: "buddy.consent", payload: { consented: p.consented }, gameDay: today }));
  return (await burnoutView(tx, userId, today));
});
}

/** Aggregates-only report; refuses to generate without explicit consent. Sharing is manual (copy/download). */
export async function buddyReport(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const consent = (await consentOf(tx, userId));
  if (!consent.consented) throw new BuddyConsentRequired("Sharing needs your consent first — enable the buddy report explicitly.");
  const week = weekNoOf(today);
  const start = weekStartOf(week);
  const end = addDaysIso(start, 6);
  const focusMin = (await queryOne<{ v: number | null }>(tx, sql`SELECT coalesce(sum(minutes),0) v FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day BETWEEN ${start} AND ${end}`))?.v ?? 0;
  const xp = (await queryOne<{ v: number | null }>(tx, sql`SELECT coalesce(sum(amount),0) v FROM xp_ledger WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))?.v ?? 0;
  const t = (await queryOne<{ c: number; w: number; b: number }>(tx, sql`SELECT coalesce(sum(correct),0) c, coalesce(sum(wrong),0) w, coalesce(sum(blank),0) b FROM test_logs WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))!;
  const q = t.c + t.w + t.b;
  const closes = (await tx.select({ std: dayCloses.standardDay }).from(dayCloses).where(and(eq(dayCloses.userId, userId), gte(dayCloses.date, start), lte(dayCloses.date, end))));
  const sleeps = (await tx.select({ m: sleepLogs.minutes }).from(sleepLogs).where(and(eq(sleepLogs.userId, userId), gte(sleepLogs.date, start), lte(sleepLogs.date, end))));
  const summary: BuddySummary = {
    weekNo: week,
    hours: Math.round((focusMin / 60) * 10) / 10,
    xp: Math.round(xp),
    consistencyPct: closes.length ? Math.round((closes.filter((c) => c.std).length / closes.length) * 100) : 0,
    netPct: q ? Math.round(((t.c - t.w / 3) / q) * 1000) / 10 : 0,
    sleepAvgHours: sleeps.length ? Math.round((sleeps.reduce((s, x) => s + x.m, 0) / sleeps.length / 60) * 10) / 10 : 0,
    burnoutLevel: (await burnoutView(tx, userId, today)).level,
  };
  const text = buddyReportText(summary, consent.name || "your buddy");
  (await appendEvent(tx, { userId, type: "buddy.report", payload: { weekNo: week }, gameDay: today }));
  return { text, summary };
});
}