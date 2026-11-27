import { queryOne, withUserTransaction, type Db } from "@/db/client";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { aiBudgetReservations, aiCalls, dayCloses, errorItems, sleepLogs } from "@/db/schema";
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
 * every request passes privacy and cost guards; task titles are included only after explicit user opt-in.
 * With AI off the deterministic local provider returns the same zod-validated shapes — the app never blocks on AI.
 * The key lives ONLY in env AI_KEY, never in the config DB or backups.
 */

type BudgetUsage = { callsToday: number; monthCost: number };
type AiUsageStatus = "actual" | "estimated" | "unknown";

async function recoverStaleReservations(db: Db, userId: string): Promise<void> {
  // If a caller disappeared after admission, keep its maximum estimate charged until its game-day/month window rolls off.
  const at = nowIso();
  await withUserTransaction(db, userId, async (tx) => {
    await tx.update(aiBudgetReservations).set({ status: "uncertain", updatedAt: at })
      .where(and(eq(aiBudgetReservations.userId, userId), eq(aiBudgetReservations.status, "reserved"), sql`${aiBudgetReservations.expiresAt} <= ${at}`));
  });
}

async function budgetUsage(db: Db, userId: string, today: string): Promise<BudgetUsage> {
  const month = today.slice(0, 7);
  const legacy = await queryOne<{ calls_today: number; month_cost: number }>(db, sql`
    SELECT
      (SELECT count(*) FROM ai_calls c WHERE c.user_id = ${userId} AND c.provider = 'remote' AND c.reservation_id IS NULL
        AND (c.game_day = ${today} OR (c.game_day IS NULL AND to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = ${today})))::int AS calls_today,
      (SELECT coalesce(sum(c.cost_est), 0) FROM ai_calls c WHERE c.user_id = ${userId} AND c.provider = 'remote' AND c.reservation_id IS NULL
        AND (c.budget_month = ${month} OR (c.budget_month IS NULL AND to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM') = ${month})))::float8 AS month_cost
  `);
  const reservations = await queryOne<{ calls_today: number; month_cost: number }>(db, sql`
    SELECT
      (SELECT count(*) FROM ai_budget_reservations r WHERE r.user_id = ${userId} AND r.game_day = ${today}
        AND r.status IN ('reserved', 'settled', 'uncertain'))::int AS calls_today,
      (SELECT coalesce(sum(CASE WHEN r.status = 'settled' THEN r.settled_cost ELSE r.reserved_cost END), 0)
        FROM ai_budget_reservations r WHERE r.user_id = ${userId} AND r.budget_month = ${month}
        AND r.status IN ('reserved', 'settled', 'uncertain'))::float8 AS month_cost
  `);
  return {
    callsToday: (legacy?.calls_today ?? 0) + (reservations?.calls_today ?? 0),
    monthCost: Math.round(((legacy?.month_cost ?? 0) + (reservations?.month_cost ?? 0)) * 10000) / 10000,
  };
}

export async function aiStatus(db: Db, userId: string, today: string) {
  await recoverStaleReservations(db, userId);
  const cfg = (await activeConfig(db, userId));
  const key = process.env.AI_KEY?.trim() ?? "";
  const baseUrl = cfg.ai.baseUrl.trim() || process.env.AI_BASE_URL?.trim() || "";
  const model = process.env.AI_MODEL?.trim() || cfg.ai.model;
  const usage = await budgetUsage(db, userId, today);
  return {
    enabled: cfg.flags.ai,
    keyPresent: key.length > 0,
    remoteReady: cfg.flags.ai && key.length > 0 && baseUrl.length > 0,
    monthCost: usage.monthCost,
    monthCap: cfg.ai.monthlyCostCapUsd,
    callsToday: usage.callsToday,
    maxCallsPerDay: cfg.ai.maxCallsPerDay,
    model,
    baseUrl,
  };
}

function telemetry(purpose: string, requestSummary: string, response: unknown): { requestSummary: string; responseJson: string } {
  if (purpose === "study_log_review_planning") {
    const value = response && typeof response === "object" ? response as Record<string, unknown> : {};
    const status = value.status === "succeeded" || value.status === "failed" ? value.status : "failed";
    const allowedCodes = new Set(["provider_http_error", "transport_error", "invalid_provider_json", "invalid_provider_output"]);
    const code = typeof value.code === "string" && allowedCodes.has(value.code) ? value.code : undefined;
    return { requestSummary: "study_log_review_planning: redacted", responseJson: JSON.stringify({ status, ...(code ? { code } : {}) }) };
  }
  return { requestSummary, responseJson: JSON.stringify(response) };
}

async function logCall(db: Db, userId: string, purpose: string, provider: string, model: string, tokensIn: number, tokensOut: number, costEst: number, usageStatus: AiUsageStatus, requestSummary: string, response: unknown, today: string, reservationId: string | null = null) {
  const at = nowIso();
  const safe = telemetry(purpose, requestSummary, response);
  await withUserTransaction(db, userId, async (tx) => {
    if (reservationId) {
      await tx.update(aiBudgetReservations).set({ status: "settled", settledCost: costEst, updatedAt: at })
        .where(and(eq(aiBudgetReservations.id, reservationId), eq(aiBudgetReservations.userId, userId), inArray(aiBudgetReservations.status, ["reserved", "uncertain"])));
    }
    await tx.insert(aiCalls).values({ id: newId(), userId, purpose, model, provider, tokensIn, tokensOut, usageStatus, costEst, requestSummary: safe.requestSummary, responseJson: safe.responseJson, gameDay: today, budgetMonth: today.slice(0, 7), reservationId, createdAt: at });
    await appendEvent(tx, { userId, type: "ai.called", gameDay: today, payload: { purpose, provider, costEst, usageStatus } });
  });
}

const analysisSchema = z.object({ errorGroups: weeklyReviewSchema.shape.errorGroups });

/** Provider latency can vary by model; keep it bounded while allowing slower Arvan models to finish. */
export function aiRequestTimeoutMs(value = process.env.AI_TIMEOUT_MS): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1_000 ? Math.min(120_000, Math.floor(parsed)) : 15_000;
}

type RemoteCallOptions = { requestId?: string };

async function reserveAiBudget(db: Db, userId: string, purpose: string, today: string, requestId: string, tokensInEstimate: number) {
  return await withUserTransaction(db, userId, async (tx) => {
    const at = nowIso();
    await tx.update(aiBudgetReservations).set({ status: "uncertain", updatedAt: at })
      .where(and(eq(aiBudgetReservations.userId, userId), eq(aiBudgetReservations.status, "reserved"), sql`${aiBudgetReservations.expiresAt} <= ${at}`));
    const cfg = await activeConfig(tx, userId);
    const ready = cfg.flags.ai && !!process.env.AI_KEY?.trim() && !!(cfg.ai.baseUrl.trim() || process.env.AI_BASE_URL?.trim());
    if (!ready) return null;
    const existing = (await tx.select({ id: aiBudgetReservations.id }).from(aiBudgetReservations)
      .where(and(eq(aiBudgetReservations.userId, userId), eq(aiBudgetReservations.requestId, requestId))).limit(1))[0];
    if (existing) return null;
    const usage = await budgetUsage(tx, userId, today);
    // Reserve for a deliberately conservative prompt-size estimate and the full configured output ceiling.
    const rawEstimate = (tokensInEstimate / 1000) * cfg.ai.pricePer1kIn + (700 / 1000) * cfg.ai.pricePer1kOut;
    const reservedCost = Math.ceil(rawEstimate * 10000) / 10000;
    if (usage.callsToday >= cfg.ai.maxCallsPerDay || usage.monthCost + reservedCost > cfg.ai.monthlyCostCapUsd) return null;
    const id = newId();
    const expiresAt = new Date(Date.now() + aiRequestTimeoutMs() + 30_000).toISOString();
    await tx.insert(aiBudgetReservations).values({
      id, userId, requestId, purpose, gameDay: today, budgetMonth: today.slice(0, 7), reservedCost,
      settledCost: 0, status: "reserved", expiresAt, createdAt: at, updatedAt: at,
    });
    return { id, config: cfg, model: process.env.AI_MODEL?.trim() || cfg.ai.model };
  });
}

async function markUncertain(db: Db, userId: string, reservationId: string, purpose: string, model: string, code: string, today: string): Promise<void> {
  const at = nowIso();
  const safe = telemetry(purpose, `${purpose}: failed attempt`, { status: "failed", code });
  await withUserTransaction(db, userId, async (tx) => {
    const reservation = (await tx.select({ reservedCost: aiBudgetReservations.reservedCost }).from(aiBudgetReservations)
      .where(and(eq(aiBudgetReservations.id, reservationId), eq(aiBudgetReservations.userId, userId))).limit(1))[0];
    const estimatedCost = reservation?.reservedCost ?? 0;
    await tx.update(aiBudgetReservations).set({ status: "uncertain", updatedAt: at })
      .where(and(eq(aiBudgetReservations.id, reservationId), eq(aiBudgetReservations.userId, userId), inArray(aiBudgetReservations.status, ["reserved", "uncertain"])));
    await tx.insert(aiCalls).values({ id: newId(), userId, purpose, model, provider: "remote", tokensIn: 0, tokensOut: 0, usageStatus: "unknown", costEst: estimatedCost, requestSummary: safe.requestSummary, responseJson: safe.responseJson, gameDay: today, budgetMonth: today.slice(0, 7), reservationId, createdAt: at });
    await appendEvent(tx, { userId, type: "ai.called", gameDay: today, payload: { purpose, provider: "remote", costEst: estimatedCost, usageStatus: "unknown", status: "uncertain" } });
  });
}

async function recordUnknownUsage(db: Db, userId: string, reservationId: string, purpose: string, model: string, today: string): Promise<number> {
  const at = nowIso();
  const safe = telemetry(purpose, `${purpose}: usage unavailable`, { status: "succeeded" });
  return await withUserTransaction(db, userId, async (tx) => {
    const reservation = (await tx.select({ reservedCost: aiBudgetReservations.reservedCost }).from(aiBudgetReservations)
      .where(and(eq(aiBudgetReservations.id, reservationId), eq(aiBudgetReservations.userId, userId))).limit(1))[0];
    const reservedCost = reservation?.reservedCost ?? 0;
    await tx.update(aiBudgetReservations).set({ status: "uncertain", updatedAt: at })
      .where(and(eq(aiBudgetReservations.id, reservationId), eq(aiBudgetReservations.userId, userId), inArray(aiBudgetReservations.status, ["reserved", "uncertain"])));
    await tx.insert(aiCalls).values({
      id: newId(), userId, purpose, model, provider: "remote", tokensIn: 0, tokensOut: 0,
      usageStatus: "unknown", costEst: reservedCost, requestSummary: safe.requestSummary,
      responseJson: safe.responseJson, gameDay: today, budgetMonth: today.slice(0, 7), reservationId, createdAt: at,
    });
    await appendEvent(tx, { userId, type: "ai.called", gameDay: today, payload: { purpose, provider: "remote", costEst: reservedCost, usageStatus: "unknown", status: "uncertain" } });
    return reservedCost;
  });
}

function validProviderUsage(value: unknown): { tokensIn: number; tokensOut: number } | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as { prompt_tokens?: unknown; completion_tokens?: unknown };
  const tokensIn = usage.prompt_tokens;
  const tokensOut = usage.completion_tokens;
  const maxInteger = 2_147_483_647;
  if (typeof tokensIn !== "number" || typeof tokensOut !== "number") return null;
  if (!Number.isSafeInteger(tokensIn) || !Number.isSafeInteger(tokensOut)) return null;
  if (tokensIn < 0 || tokensOut < 0 || tokensIn > maxInteger || tokensOut > 700) return null;
  return { tokensIn, tokensOut };
}

/** Reserves budgets atomically before the remote call; the database transaction ends before fetch starts. */
export async function remoteCall<T>(db: Db, userId: string, purpose: string, system: string, user: string, schema: z.ZodType<T>, today: string, requestSummary = `${purpose}: numeric aggregates only (guard)`, options: RemoteCallOptions = {}): Promise<{ value: T; cost: number } | null> {
  const st = await aiStatus(db, userId, today);
  if (!st.remoteReady) return null;
  const tokensInEst = system.length + user.length;
  const reservation = await reserveAiBudget(db, userId, purpose, today, options.requestId ?? newId(), tokensInEst);
  if (!reservation) return null;

  const baseUrl = reservation.config.ai.baseUrl.trim() || process.env.AI_BASE_URL?.trim() || "";
  const apiKey = process.env.AI_KEY!.trim();
  const authorization = /^apikey\s/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`;
  let providerContacted = false;
  let usageKnown = false;
  let tokensIn = 0;
  let tokensOut = 0;
  let actualCost = 0;
  let value: T;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify({ model: reservation.model, temperature: 0.4, max_tokens: 700, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(aiRequestTimeoutMs()),
    });
    providerContacted = true;
    if (!res.ok) throw Object.assign(new Error(), { code: "provider_http_error" });
    let json: { choices?: { message?: { content?: string } }[]; usage?: unknown };
    try {
      json = await res.json() as typeof json;
    } catch {
      throw Object.assign(new Error(), { code: "invalid_provider_json" });
    }
    const content = json.choices?.[0]?.message?.content ?? "";
    const reportedUsage = validProviderUsage(json.usage);
    if (reportedUsage) {
      tokensIn = reportedUsage.tokensIn;
      tokensOut = reportedUsage.tokensOut;
      actualCost = estimateCost(tokensIn, tokensOut, reservation.config.ai);
      usageKnown = true;
    }
    try {
      value = schema.parse(JSON.parse(content));
    } catch {
      throw Object.assign(new Error(), { code: "invalid_provider_output" });
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : providerContacted ? "invalid_provider_json" : "transport_error";
    if (usageKnown) {
      await logCall(db, userId, purpose, "remote", reservation.model, tokensIn, tokensOut, actualCost, "actual", `${purpose}: failed attempt`, { status: "failed", code }, today, reservation.id);
    } else {
      await markUncertain(db, userId, reservation.id, purpose, reservation.model, code, today);
    }
    return null;
  }
  if (usageKnown) {
    await logCall(db, userId, purpose, "remote", reservation.model, tokensIn, tokensOut, actualCost, "actual", requestSummary, { status: "succeeded" }, today, reservation.id);
    return { value, cost: actualCost };
  }
  const reservedCost = await recordUnknownUsage(db, userId, reservation.id, purpose, reservation.model, today);
  return { value, cost: reservedCost };
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
  if (!remote) (await logCall(db, userId, "weekly_review", "local", "deterministic", 0, 0, 0, "estimated", "weekly_review: local provider", review, today));
  const out: WeeklyReviewResult = { week, provider: remote ? "remote" : "local", review, summary };
  (await setKv(db, userId, cacheKey, out));
  return out;
}

export async function errorAnalysis(db: Db, userId: string, today: string) {
  const groups = (await causeGroups(db, userId, addDaysIso(today, -28)));
  const remote = await remoteCall(db, userId, "error_analysis", "You are a study coach. Reply ONLY JSON {errorGroups:[{cause,count,concepts[],mission}]} — missions are one 25-min actionable step. No personal text.", JSON.stringify({ groups }), analysisSchema, today);
  const value = remote?.value ?? { errorGroups: groups.map((g) => ({ ...g, mission: `3 targeted tests on ${g.concepts[0] ?? g.cause}, then write the takeaway in one line.` })) };
  if (!remote) (await logCall(db, userId, "error_analysis", "local", "deterministic", 0, 0, 0, "estimated", "error_analysis: local provider", value, today));
  return { provider: remote ? ("remote" as const) : ("local" as const), groups: value.errorGroups };
}

export async function narrative(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const total = (await queryOne<{ n: number }>(db, sql`SELECT count(*) n FROM chapters`))!.n;
  const cleared = (await queryOne<{ n: number }>(db, sql`SELECT count(*) n FROM chapter_state WHERE user_id = ${userId} AND cleared_at IS NOT NULL`))!.n;
  const input = { chapterNo: Math.max(1, cleared + 1), cleared, total, weekNo: weekNoOf(today) };
  const remote = await remoteCall(db, userId, "narrative", "You are the narrator of a calm study campaign. Reply ONLY JSON {title,text}. Second person, hopeful, ≤ 900 chars. No personal data.", JSON.stringify(input), narrativeSchema, today);
  const value = remote?.value ?? localNarrative(input);
  if (!remote) (await logCall(db, userId, "narrative", "local", "deterministic", 0, 0, 0, "estimated", "narrative: local provider", value, today));
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
  if (!remote) (await logCall(db, userId, "anomaly_alerts", "local", "deterministic", 0, 0, 0, "estimated", "anomaly_alerts: local provider", value, today));
  return { enabled: true, provider: remote ? ("remote" as const) : ("local" as const), alerts: value.alerts, observed: raw.slice(0, 6) };
}

export async function aiCallLog(db: Db, userId: string) {
  return (await db.select().from(aiCalls).where(eq(aiCalls.userId, userId)).orderBy(sql`created_at DESC`).limit(50));
}
