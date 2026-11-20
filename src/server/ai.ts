import { queryOne } from "@/db/client";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { aiCalls, dayCloses, errorItems, sleepLogs } from "@/db/schema";
import { anomalyAlertsSchema, estimateCost, guardSummary, localAnomalies, localNarrative, localWeeklyReview, narrativeSchema, weeklyReviewSchema, type WeeklyReview } from "@/domain/ai";
import { mistakeMining } from "@/domain/insights";
import { consistencyRate } from "@/domain/quests";
import { appendEvent } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { addDaysIso } from "@/i18n/jalali";
import { weekNoOf, weekStartOf } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";
import { getKv, setKv } from "./kv";
import { anomalyLog } from "./shop";

/**
 * AI adapter (#92–#94). Remote calls happen only when flags.ai + env AI_KEY + baseUrl are all set;
 * every request passes the privacy guard (aggregates only) and the monthly cost / daily call caps.
 * With AI off the deterministic local provider returns the same zod-validated shapes — the app never blocks on AI.
 * The key lives ONLY in env AI_KEY, never in the config DB or backups.
 */

export async function aiStatus(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const key = process.env.AI_KEY?.trim() ?? "";
  const baseUrl = cfg.ai.baseUrl.trim() || process.env.AI_BASE_URL?.trim() || "";
  const model = process.env.AI_MODEL?.trim() || cfg.ai.model;
  const month = today.slice(0, 7);
  const monthCost = Math.round(((await queryOne<{ v: number | null }>(db, sql`SELECT sum(cost_est) v FROM ai_calls WHERE user_id = ${userId} AND to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = ${month}`))?.v ?? 0) * 10000) / 10000;
  const callsToday = (await queryOne<{ n: number }>(db, sql`SELECT count(*) n FROM ai_calls WHERE user_id = ${userId} AND to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = ${today}`))!.n;
  return {
    enabled: cfg.flags.ai,
    keyPresent: key.length > 0,
    remoteReady: cfg.flags.ai && key.length > 0 && baseUrl.length > 0,
    monthCost,
    monthCap: cfg.ai.monthlyCostCapUsd,
    callsToday,
    maxCallsPerDay: cfg.ai.maxCallsPerDay,
    model,
    baseUrl,
  };
}

async function logCall(db: Db, userId: string, purpose: string, provider: string, model: string, tokensIn: number, tokensOut: number, costEst: number, requestSummary: string, response: unknown) {
  (await db.insert(aiCalls).values({ id: newId(), userId, purpose, model, provider, tokensIn, tokensOut, costEst, requestSummary, responseJson: JSON.stringify(response), createdAt: nowIso() }));
  (await appendEvent(db, { userId, type: "ai.called", payload: { purpose, provider, costEst } }));
}

const analysisSchema = z.object({ errorGroups: weeklyReviewSchema.shape.errorGroups });

/** Provider latency can vary by model; keep it bounded while allowing slower Arvan models to finish. */
export function aiRequestTimeoutMs(value = process.env.AI_TIMEOUT_MS): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1_000 ? Math.min(120_000, Math.floor(parsed)) : 15_000;
}

/** One guarded, capped, logged remote attempt. Returns null when AI is off, capped, or fails — callers fall back to local. */
export async function remoteCall<T>(db: Db, userId: string, purpose: string, system: string, user: string, schema: z.ZodType<T>, today: string): Promise<{ value: T; cost: number } | null> {
  const st = (await aiStatus(db, userId, today));
  if (!st.remoteReady) return null;
  if (st.callsToday >= st.maxCallsPerDay || st.monthCost >= st.monthCap) return null;
  const cfg = (await activeConfig(db, userId));
  const tokensInEst = Math.ceil((system.length + user.length) / 4);
  if (st.monthCost + estimateCost(tokensInEst, 700, cfg.ai) > st.monthCap) return null;
  try {
    const baseUrl = cfg.ai.baseUrl.trim() || process.env.AI_BASE_URL?.trim() || "";
    const apiKey = process.env.AI_KEY!.trim();
    const authorization = /^apikey\s/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify({ model: st.model, temperature: 0.4, max_tokens: 700, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(aiRequestTimeoutMs()),
    });
    if (!res.ok) throw new Error(`provider HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const content = json.choices?.[0]?.message?.content ?? "";
    const value = schema.parse(JSON.parse(content));
    const tokensIn = json.usage?.prompt_tokens ?? tokensInEst;
    const tokensOut = json.usage?.completion_tokens ?? Math.ceil(content.length / 4);
    const cost = estimateCost(tokensIn, tokensOut, cfg.ai);
    (await logCall(db, userId, purpose, "remote", st.model, tokensIn, tokensOut, cost, `${purpose}: numeric aggregates only (guard)`, value));
    return { value, cost };
  } catch (e) {
    (await logCall(db, userId, purpose, "remote", st.model, 0, 0, 0, `${purpose}: failed attempt`, { error: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

async function causeGroups(db: Db, userId: string, since: string) {
  const errors = (await db.select().from(errorItems).where(and(eq(errorItems.userId, userId), gte(errorItems.gameDay, since))));
  const byCause = new Map<string, typeof errors>();
  for (const e of errors) byCause.set(e.cause, [...(byCause.get(e.cause) ?? []), e]);
  return [...byCause.entries()]
    .map(([cause, rows]) => ({ cause, count: rows.length, concepts: mistakeMining(rows).concepts.slice(0, 6).map((c) => c.word) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

export interface WeeklyReviewResult {
  week: number;
  provider: "remote" | "local";
  review: WeeklyReview;
  summary: ReturnType<typeof guardSummary>;
}

export async function weeklyReview(db: Db, userId: string, today: string, refresh = false): Promise<WeeklyReviewResult> {
  const week = weekNoOf(today);
  const cacheKey = `ai.weekly.${week}`;
  if (!refresh) {
    const cached = (await getKv<WeeklyReviewResult | null>(db, userId, cacheKey, null));
    if (cached) return cached;
  }
  const start = weekStartOf(week);
  const end = addDaysIso(start, 6);
  const focusMin = (await queryOne<{ v: number | null }>(db, sql`SELECT coalesce(sum(minutes),0) v FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day BETWEEN ${start} AND ${end}`))?.v ?? 0;
  const t = (await queryOne<{ c: number; w: number; b: number }>(db, sql`SELECT coalesce(sum(correct),0) c, coalesce(sum(wrong),0) w, coalesce(sum(blank),0) b FROM test_logs WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))!;
  const q = t.c + t.w + t.b;
  const closes = (await db.select({ tier: dayCloses.coreTier }).from(dayCloses).where(and(eq(dayCloses.userId, userId), gte(dayCloses.date, start), sql`${dayCloses.date} <= ${end}`)));
  const sleeps = (await db.select({ m: sleepLogs.minutes }).from(sleepLogs).where(and(eq(sleepLogs.userId, userId), gte(sleepLogs.date, start), sql`${sleepLogs.date} <= ${end}`)));
  const xp = (await queryOne<{ v: number | null }>(db, sql`SELECT coalesce(sum(amount),0) v FROM xp_ledger WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))?.v ?? 0;
  const groups = (await causeGroups(db, userId, start));
  const summary = guardSummary({
    weekNo: week,
    hours: Math.round((focusMin / 60) * 10) / 10,
    xp: Math.round(xp),
    testsNet: q ? Math.round(((t.c - t.w / 3) / q) * 1000) / 10 : 0,
    consistency: Math.round(consistencyRate(closes.map((c) => c.tier)) * 100) / 100,
    sleepAvgHours: sleeps.length ? Math.round((sleeps.reduce((s, x) => s + x.m, 0) / sleeps.length / 60) * 10) / 10 : 0,
    topCauses: groups.map((g) => ({ cause: g.cause, count: g.count })),
  });
  const remote = await remoteCall(db, userId, "weekly_review", "You are a calm study coach. Reply ONLY with JSON matching {summary, patterns[], oneChange, errorGroups[{cause,count,concepts[],mission}]}. No names, no personal text.", JSON.stringify(summary), weeklyReviewSchema, today);
  const review = remote?.value ?? localWeeklyReview(summary, groups);
  if (!remote) (await logCall(db, userId, "weekly_review", "local", "deterministic", 0, 0, 0, "weekly_review: local provider", review));
  const out: WeeklyReviewResult = { week, provider: remote ? "remote" : "local", review, summary };
  (await setKv(db, userId, cacheKey, out));
  return out;
}

export async function errorAnalysis(db: Db, userId: string, today: string) {
  const groups = (await causeGroups(db, userId, addDaysIso(today, -28)));
  const remote = await remoteCall(db, userId, "error_analysis", "You are a study coach. Reply ONLY JSON {errorGroups:[{cause,count,concepts[],mission}]} — missions are one 25-min actionable step. No personal text.", JSON.stringify({ groups }), analysisSchema, today);
  const value = remote?.value ?? { errorGroups: groups.map((g) => ({ ...g, mission: `3 targeted tests on ${g.concepts[0] ?? g.cause}, then write the takeaway in one line.` })) };
  if (!remote) (await logCall(db, userId, "error_analysis", "local", "deterministic", 0, 0, 0, "error_analysis: local provider", value));
  return { provider: remote ? ("remote" as const) : ("local" as const), groups: value.errorGroups };
}

export async function narrative(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const total = (await queryOne<{ n: number }>(db, sql`SELECT count(*) n FROM chapters`))!.n;
  const cleared = (await queryOne<{ n: number }>(db, sql`SELECT count(*) n FROM chapter_state WHERE user_id = ${userId} AND cleared_at IS NOT NULL`))!.n;
  const input = { chapterNo: Math.max(1, cleared + 1), cleared, total, weekNo: weekNoOf(today) };
  const remote = await remoteCall(db, userId, "narrative", "You are the narrator of a calm study campaign. Reply ONLY JSON {title,text}. Second person, hopeful, ≤ 900 chars. No personal data.", JSON.stringify(input), narrativeSchema, today);
  const value = remote?.value ?? localNarrative(input);
  if (!remote) (await logCall(db, userId, "narrative", "local", "deterministic", 0, 0, 0, "narrative: local provider", value));
  return { provider: remote ? ("remote" as const) : ("local" as const), ...value, flags: cfg.flags.ai };
}

export async function anomalyAlerts(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  if (!cfg.flags.anomalyAlerts) return { enabled: false, provider: "local" as const, alerts: [] };
  const raw = (await anomalyLog(db, userId)).filter((a) => a.day >= addDaysIso(today, -7));
  const has = (rule: string) => raw.some((a) => a.rule === rule);
  const flags = { perfectAccuracy: has("perfect_accuracy"), overHours: has("focus_hours"), manualShare: has("manual_share"), testsFlood: has("tests_per_day") };
  const remote = await remoteCall(db, userId, "anomaly_alerts", "You are a gentle mirror, never a judge. Reply ONLY JSON {alerts:[{key,message,severity:info|warn}]}. No blame, no penalties, ≤ 240 chars each.", JSON.stringify(flags), anomalyAlertsSchema, today);
  const value = remote?.value ?? localAnomalies(flags);
  if (!remote) (await logCall(db, userId, "anomaly_alerts", "local", "deterministic", 0, 0, 0, "anomaly_alerts: local provider", value));
  return { enabled: true, provider: remote ? ("remote" as const) : ("local" as const), alerts: value.alerts, observed: raw.slice(0, 6) };
}

export async function aiCallLog(db: Db, userId: string) {
  return (await db.select().from(aiCalls).where(eq(aiCalls.userId, userId)).orderBy(sql`created_at DESC`).limit(50));
}
