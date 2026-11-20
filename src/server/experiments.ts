import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, queryOne, type Db } from "@/db/client";
import { experiments } from "@/db/schema";
import { compareExperiment, type ExperimentAggregate, type ExperimentMetric, type ExperimentResult } from "@/domain/experiment";
import { appendEvent } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { addDaysIso, diffDaysIso } from "@/i18n/jalali";
import { newId, nowIso } from "@/lib/ids";

/**
 * Experiment Lab (#105, F-DUO-17): one single-change A/B window at a time, baseline = the equally long window
 * immediately before the start. Verdicts are threshold-based and explainable; results feed the Weekly Council.
 */

export class ExperimentDenied extends Error {}

export const experimentInput = z.object({
  changeText: z.string().trim().min(3, "Describe the one change").max(300),
  metric: z.enum(["consistency", "net", "focus"]).default("consistency"),
});

async function aggregate(db: Db, userId: string, from: string, to: string): Promise<ExperimentAggregate> {
  const days = diffDaysIso(to, from) + 1;
  const standardDays = (await queryOne<{ n: number }>(db, sql`SELECT count(*)::int n FROM day_closes WHERE user_id = ${userId} AND standard_day = true AND date BETWEEN ${from} AND ${to}`))!.n;
  const focusMinutes = (await queryOne<{ v: number | null }>(db, sql`SELECT coalesce(sum(minutes),0) v FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day BETWEEN ${from} AND ${to}`))?.v ?? 0;
  const t = (await queryOne<{ s: number | null; n: number }>(db, sql`SELECT sum(net_pct) s, count(*)::int n FROM test_logs WHERE user_id = ${userId} AND game_day BETWEEN ${from} AND ${to}`))!;
  return { days, standardDays, focusMinutes, netSum: t.s ?? 0, netCount: t.n };
}

type Row = typeof experiments.$inferSelect;

function hydrate(r: Row) {
  return { ...r, baseline: JSON.parse(r.baselineJson) as ExperimentAggregate, result: r.resultJson ? (JSON.parse(r.resultJson) as ExperimentResult) : null };
}

const activeOf = async (db: Db, userId: string) => (await db.select().from(experiments).where(and(eq(experiments.userId, userId), eq(experiments.status, "active"))).limit(1))[0];

async function finishRow(db: Db, userId: string, row: Row, on: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  const during = (await aggregate(tx, userId, row.startDay, on));
  const result = compareExperiment(JSON.parse(row.baselineJson) as ExperimentAggregate, during, row.metric, cfg.experiment);
  (await tx.update(experiments).set({ status: "done", resultJson: JSON.stringify(result), finishedAt: nowIso() }).where(eq(experiments.id, row.id)));
  (await appendEvent(tx, { userId, type: "experiment.finished", payload: { id: row.id, metric: row.metric, verdict: result.verdict, delta: result.delta }, gameDay: on }));
  return result;
});
}

export async function experimentsView(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  const active = (await activeOf(tx, userId));
  // Auto-finish once the window has fully elapsed.
  if (active && today > active.endDay) (await finishRow(tx, userId, active, active.endDay));
  const rows = (await tx.select().from(experiments).where(eq(experiments.userId, userId)).orderBy(desc(experiments.createdAt)).limit(20)).map(hydrate);
  const current = rows.find((r) => r.status === "active") ?? null;
  return {
    active: current ? { ...current, daysElapsed: diffDaysIso(today, current.startDay) + 1, daysTotal: diffDaysIso(current.endDay, current.startDay) + 1 } : null,
    history: rows.filter((r) => r.status !== "active"),
    latestResult: rows.find((r) => r.status === "done" && r.result)?.result ?? null,
    config: cfg.experiment,
  };
});
}

export async function startExperiment(db: Db, userId: string, input: z.input<typeof experimentInput>, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const p = experimentInput.parse(input);
  const cfg = (await activeConfig(tx, userId));
  const active = (await activeOf(tx, userId));
  if (active && today <= active.endDay) throw new ExperimentDenied("One experiment at a time — finish or cancel the running one first.");
  if (active) (await finishRow(tx, userId, active, active.endDay));
  const days = cfg.experiment.days;
  const baseline = (await aggregate(tx, userId, addDaysIso(today, -days), addDaysIso(today, -1)));
  const row = { id: newId(), userId, changeText: p.changeText, metric: p.metric as ExperimentMetric, startDay: today, endDay: addDaysIso(today, days - 1), status: "active" as const, baselineJson: JSON.stringify(baseline), resultJson: null, createdAt: nowIso(), finishedAt: null };
  (await tx.insert(experiments).values(row));
  (await appendEvent(tx, { userId, type: "experiment.started", payload: { id: row.id, metric: p.metric, days, baseline }, gameDay: today }));
  return (await experimentsView(tx, userId, today));
});
}

export async function finishExperiment(db: Db, userId: string, id: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  const row = (await tx.select().from(experiments).where(and(eq(experiments.id, id), eq(experiments.userId, userId))).limit(1))[0];
  if (!row || row.status !== "active") throw new ExperimentDenied("Unknown or already finished experiment");
  const elapsed = diffDaysIso(today, row.startDay) + 1;
  if (elapsed < cfg.experiment.minDays) throw new ExperimentDenied(`Too early to judge — ${elapsed}/${cfg.experiment.minDays} minimum days collected.`);
  (await finishRow(tx, userId, row, today));
  return (await experimentsView(tx, userId, today));
});
}

export async function cancelExperiment(db: Db, userId: string, id: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const row = (await tx.select().from(experiments).where(and(eq(experiments.id, id), eq(experiments.userId, userId))).limit(1))[0];
  if (!row || row.status !== "active") throw new ExperimentDenied("Unknown or already finished experiment");
  (await tx.update(experiments).set({ status: "cancelled", finishedAt: nowIso() }).where(eq(experiments.id, id)));
  (await appendEvent(tx, { userId, type: "experiment.cancelled", payload: { id }, gameDay: today }));
  return (await experimentsView(tx, userId, today));
});
}

/** Latest finished result for the Weekly Council "one change" step. */
export async function councilExperiment(db: Db, userId: string) {
  const row = (await db.select().from(experiments).where(and(eq(experiments.userId, userId), eq(experiments.status, "done"))).orderBy(desc(experiments.createdAt)).limit(1))[0];
  if (!row || !row.resultJson) return null;
  return { id: row.id, changeText: row.changeText, metric: row.metric, startDay: row.startDay, endDay: row.endDay, result: JSON.parse(row.resultJson) as ExperimentResult };
}