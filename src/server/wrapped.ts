import { and, eq, gte, sql } from "drizzle-orm";
import { queryOne, type Db } from "@/db/client";
import { dayCloses, errorItems, sleepLogs } from "@/db/schema";
import { consistencyRate } from "@/domain/quests";
import { sleepDebt } from "@/domain/wellness";
import { activeConfig, xpSummary } from "@/events/projections";
import { addDaysIso } from "@/i18n/jalali";
import { TOTAL_WEEKS, weekNoOf, weekStartOf } from "@/lib/campaign";

/** Weekly Wrapped (#98): six shareable slides built only from real logged data — no AI required. */

export interface WrappedSlide {
  key: string;
  title: string;
  stat: string;
  lines: string[];
}

export async function wrappedView(db: Db, userId: string, today: string, weekNo?: number) {
  const cfg = (await activeConfig(db, userId));
  const current = weekNoOf(today);
  const week = Math.max(1, Math.min(TOTAL_WEEKS, weekNo ?? Math.max(1, current - 1)));
  const start = weekStartOf(week);
  const end = addDaysIso(start, 6);
  const focusMin = (await queryOne<{ v: number | null }>(db, sql`SELECT coalesce(sum(minutes),0) v FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day BETWEEN ${start} AND ${end}`))?.v ?? 0;
  const xp = (await queryOne<{ v: number | null }>(db, sql`SELECT coalesce(sum(amount),0) v FROM xp_ledger WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))?.v ?? 0;
  const t = (await queryOne<{ c: number; w: number; b: number }>(db, sql`SELECT coalesce(sum(correct),0) c, coalesce(sum(wrong),0) w, coalesce(sum(blank),0) b FROM test_logs WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))!;
  const q = t.c + t.w + t.b;
  const net = q ? Math.round(((t.c - t.w / 3) / q) * 1000) / 10 : 0;
  const best = (await queryOne<{ day: string; v: number }>(db, sql`SELECT game_day AS day, sum(correct) AS v FROM test_logs WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end} GROUP BY game_day ORDER BY v DESC LIMIT 1`));
  const closes = (await db.select({ tier: dayCloses.coreTier, std: dayCloses.standardDay }).from(dayCloses).where(and(eq(dayCloses.userId, userId), gte(dayCloses.date, start), sql`${dayCloses.date} <= ${end}`)));
  const std = closes.filter((c) => c.std).length;
  const sleeps = (await db.select({ date: sleepLogs.date, minutes: sleepLogs.minutes }).from(sleepLogs).where(eq(sleepLogs.userId, userId)));
  const weekSleeps = sleeps.filter((s) => s.date >= start && s.date <= end);
  const avgSleep = weekSleeps.length ? Math.round((weekSleeps.reduce((s, x) => s + x.minutes, 0) / weekSleeps.length / 60) * 10) / 10 : 0;
  const debt = sleepDebt(sleeps, cfg.sleep.minSleepHours, end);
  const causes = (await db.select({ cause: errorItems.cause, n: sql<number>`count(*)::int` }).from(errorItems).where(and(eq(errorItems.userId, userId), gte(errorItems.gameDay, start), sql`${errorItems.gameDay} <= ${end}`)).groupBy(errorItems.cause).orderBy(sql`count(*)::int DESC`));
  const gems = Math.round(((await queryOne<{ v: number | null }>(db, sql`SELECT sum(amount) v FROM gems_ledger WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))?.v ?? 0) * 100) / 100;
  const sum = (await xpSummary(db, userId, today));
  const slides: WrappedSlide[] = [
    { key: "engine", title: "The engine", stat: `${Math.round((focusMin / 60) * 10) / 10} h`, lines: [`${Math.round(xp)} XP earned this week`, `Level ${sum.level} — ${sum.title}`, `${focusMin} focused minutes logged`] },
    { key: "tests", title: "The arena", stat: `${net} %`, lines: [`${q} questions answered`, best ? `Best day: ${best.day} with ${best.v} correct` : "No test days yet — the arena waits", `Net ${net} % after negative marking`] },
    { key: "consistency", title: "The streak", stat: `${std}/7`, lines: [`${std} Standard days out of 7`, `Consistency ${Math.round(consistencyRate(closes.map((c) => c.tier)) * 100)} %`, std >= 5 ? "The flame held all week." : "Protect the Core block first next week."] },
    { key: "sleep", title: "The recovery", stat: `${avgSleep} h`, lines: [`${weekSleeps.length} nights logged`, `Average ${avgSleep} h per night`, `Sleep debt ${debt.debtHours} h — rest is part of the plan`] },
    { key: "forge", title: "The forge", stat: `${causes.reduce((s, c) => s + c.n, 0)}`, lines: [causes[0] ? `Top mistake cause: ${causes[0].cause} (${causes[0].n})` : "No mistakes logged — suspiciously calm", `${gems >= 0 ? "+" : ""}${gems} Gems this week`, "Every analyzed mistake became a review card"] },
    { key: "next", title: "Next week", stat: `W${Math.min(TOTAL_WEEKS, week + 1)}`, lines: [causes[0] ? `One change: batch a 25-min ${causes[0].cause}-fix session` : "One change: keep the nightly review under two minutes", `Season stop ${Math.min(TOTAL_WEEKS, week + 1)} unlocks after the week ends`, "Shade is watching. Walk faster."] },
  ];
  return { week, start, end, slides, isCurrent: week === current };
}