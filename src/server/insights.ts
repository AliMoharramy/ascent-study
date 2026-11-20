import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { queryOne, type Db } from "@/db/client";
import { chapterState, chapters, errorItems, focusSessions, skillUnlocks, subjects, testLogs, users, weekPlanItems } from "@/db/schema";
import { secTarget } from "@/domain/extras";
import { energyPattern, forecastNet, mistakeMining, rankEstimate, skipCurve, skipThreshold, answerEV, timePerQuestion, weakPoints, whatIf, type PlanRow } from "@/domain/insights";
import { activeConfig } from "@/events/projections";
import { addDaysIso } from "@/i18n/jalali";
import { weekNoOf } from "@/lib/campaign";

/** Analytics (#95, #99, #100): forecast + confidence band, energy peaks, weak-point hunter,
 * mistake mining, time-per-question, skip-strategy math, what-if planner and rank interval. */

async function daySamples(db: Db, userId: string, since: string, subjectId?: string) {
  const rows = (await db
    .select({ day: testLogs.gameDay, c: sql<number>`sum(${testLogs.correct})`, w: sql<number>`sum(${testLogs.wrong})`, b: sql<number>`sum(${testLogs.blank})` })
    .from(testLogs)
    .where(and(eq(testLogs.userId, userId), gte(testLogs.gameDay, since), subjectId ? eq(testLogs.subjectId, subjectId) : undefined))
    .groupBy(testLogs.gameDay));
  return rows.map((r) => {
    const q = r.c + r.w + r.b;
    return { day: r.day, questions: q, netPct: q ? Math.round(((r.c - r.w / 3) / q) * 1000) / 10 : 0 };
  });
}

export async function forecastView(db: Db, userId: string, today: string) {
  const since = addDaysIso(today, -56);
  const overall = forecastNet((await daySamples(db, userId, since)));
  const subs = (await db.select().from(subjects).where(eq(subjects.status, "active")));
  return {
    overall,
    bySubject: (await Promise.all(subs.map(async (s) => ({ subjectId: s.id, name: s.nameEn, forecast: forecastNet((await daySamples(db, userId, since, s.id))) })))).filter((s) => s.forecast.n > 0),
    windowDays: 56,
  };
}

export async function energyView(db: Db, userId: string) {
  const tz = (await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1))[0]?.tz ?? "Asia/Tehran";
  const points = (await db
    .select({ startedAt: focusSessions.startedAt, minutes: focusSessions.minutes })
    .from(focusSessions)
    .where(and(eq(focusSessions.userId, userId), eq(focusSessions.status, "ended"), isNotNull(focusSessions.minutes))))
    .map((p) => ({ startedAt: p.startedAt, minutes: p.minutes ?? 0 }));
  return { timezone: tz, ...energyPattern(points, tz), sessions: points.length };
}

export async function weakView(db: Db, userId: string) {
  const errCounts = new Map<string, number>();
  for (const e of (await db.select({ c: errorItems.chapterId }).from(errorItems).where(eq(errorItems.userId, userId)))) if (e.c) errCounts.set(e.c, (errCounts.get(e.c) ?? 0) + 1);
  const ch = new Map((await db.select().from(chapters)).map((c) => [c.id, c]));
  const subs = new Map((await db.select().from(subjects)).map((s) => [s.id, s.nameEn]));
  const rows = (await db
    .select()
    .from(chapterState)
    .where(eq(chapterState.userId, userId)))
    .map((s) => ({ chapterId: s.chapterId, subjectId: ch.get(s.chapterId)?.subjectId ?? "", netPct: s.netPct, errors: errCounts.get(s.chapterId) ?? 0, cleared: !!s.clearedAt }));
  return weakPoints(rows).map((r) => ({ ...r, title: ch.get(r.chapterId)?.title ?? r.chapterId, subject: subs.get(r.subjectId) ?? r.subjectId }));
}

export async function miningView(db: Db, userId: string, today: string) {
  const errors = (await db.select().from(errorItems).where(and(eq(errorItems.userId, userId), gte(errorItems.gameDay, addDaysIso(today, -90)))));
  const mined = mistakeMining(errors);
  const examples = new Map<string, string[]>();
  for (const e of errors) for (const w of mined.concepts.map((c) => c.word)) if (e.takeaway.toLowerCase().includes(w)) examples.set(w, [...(examples.get(w) ?? []).slice(0, 2), e.takeaway]);
  return { ...mined, total: errors.length, examples: mined.concepts.map((c) => ({ ...c, samples: examples.get(c.word) ?? [] })) };
}

export async function timeView(db: Db, userId: string, today: string) {
  const logs = (await db.select().from(testLogs).where(and(eq(testLogs.userId, userId), gte(testLogs.gameDay, addDaysIso(today, -28)))));
  const t = timePerQuestion(logs);
  const unlocks = (await db.select({ skillId: skillUnlocks.skillId, tier: skillUnlocks.tier }).from(skillUnlocks).where(eq(skillUnlocks.userId, userId)));
  const target = secTarget(unlocks);
  return { ...t, target, slow: t.secPerQ !== null && t.secPerQ > target, timedSessions: logs.filter((l) => l.seconds !== null && l.seconds > 0).length };
}

export async function skipView(db: Db, userId: string, today: string) {
  const t = (await queryOne<{ c: number; w: number }>(db, sql`SELECT coalesce(sum(correct),0) c, coalesce(sum(wrong),0) w FROM test_logs WHERE user_id = ${userId} AND game_day >= ${addDaysIso(today, -28)}`))!;
  const answered = t.c + t.w;
  const p = answered ? Math.round((t.c / answered) * 1000) / 1000 : null;
  const threshold = skipThreshold(4);
  const weak = (await weakView(db, userId)).slice(0, 3);
  return {
    p,
    answered,
    threshold,
    curve: skipCurve(4),
    evAtP: p === null ? null : Math.round(answerEV(p) * 1000) / 1000,
    advice: p === null ? "Log a few timed sessions first — the chart needs your real accuracy." : p >= threshold ? `Your accuracy (${Math.round(p * 100)} %) is above the 25 % break-even: attempting beats skipping on EV.` : `Your accuracy (${Math.round(p * 100)} %) is below the 25 % break-even: skipping unknowns protects your net while accuracy trains up.`,
    missions: weak.map((w) => ({ chapterId: w.chapterId, title: w.title, mission: `10 timed tests on ${w.title}; skip anything you can't reduce to ≥ 2 options, then analyze every miss.` })),
  };
}

export async function whatIfView(db: Db, userId: string, today: string, drop: string[], add: PlanRow[]) {
  const week = weekNoOf(today);
  const rows: PlanRow[] = (await db
    .select({ chapterId: weekPlanItems.chapterId, tier: weekPlanItems.tier, plannedMin: weekPlanItems.plannedMin })
    .from(weekPlanItems)
    .where(and(eq(weekPlanItems.userId, userId), gte(weekPlanItems.weekNo, week))));
  const base = forecastNet((await daySamples(db, userId, addDaysIso(today, -56)))).pct;
  return { baseForecast: base, ...whatIf(rows, drop, add, base), plannedChapters: rows.length };
}

export async function rankView(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const f = forecastNet((await daySamples(db, userId, addDaysIso(today, -56))));
  return { forecast: f, estimate: rankEstimate(f.pct, cfg.rank), note: cfg.rank.assumed ? "Assumed curve from public karname aggregates — not an official prediction. Edit the curve in Config when real data arrives (T-DATA-04)." : "Curve source: " + cfg.rank.source };
}