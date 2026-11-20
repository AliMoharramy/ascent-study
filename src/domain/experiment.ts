import type { GameConfig } from "@/config/schema";

/**
 * Experiment Lab (#105, F-DUO-17): compare a 2-week single-change window against its baseline.
 * All comparisons are per-day normalized so unequal window lengths stay fair. Thresholds are config-driven
 * and shown verbatim in the result — the verdict must be explainable.
 */

export type ExperimentMetric = "consistency" | "net" | "focus";

export interface ExperimentAggregate {
  days: number;
  standardDays: number;
  focusMinutes: number;
  netSum: number; // sum of per-test net %
  netCount: number;
}

export interface ExperimentResult {
  metric: ExperimentMetric;
  baseline: number | null; // consistency %, net %, or focus min/day
  during: number | null;
  delta: number | null; // percentage points (consistency, net) or relative % (focus)
  threshold: number;
  thresholdLabel: string;
  verdict: "worked" | "didnt" | "inconclusive";
  reasons: string[];
}

export function metricValue(a: ExperimentAggregate, metric: ExperimentMetric): number | null {
  if (metric === "consistency") return a.days > 0 ? Math.round((a.standardDays / a.days) * 1000) / 10 : null;
  if (metric === "net") return a.netCount > 0 ? Math.round((a.netSum / a.netCount) * 10) / 10 : null;
  return a.days > 0 ? Math.round(a.focusMinutes / a.days) : null;
}

export function compareExperiment(baseline: ExperimentAggregate, during: ExperimentAggregate, metric: ExperimentMetric, cfg: GameConfig["experiment"]): ExperimentResult {
  const reasons: string[] = [];
  const threshold = metric === "consistency" ? cfg.consistencyDeltaPp : metric === "net" ? cfg.netDeltaPp : cfg.focusDeltaPct;
  const thresholdLabel = metric === "focus" ? `+${threshold}% focus minutes/day` : `+${threshold} percentage points`;
  const b = metricValue(baseline, metric);
  const d = metricValue(during, metric);
  if (during.days < cfg.minDays) reasons.push(`Only ${during.days} days of data — need at least ${cfg.minDays} for a verdict.`);
  if (b === null) reasons.push("No baseline data for this metric.");
  if (d === null) reasons.push(metric === "net" ? "No graded tests during the experiment window." : "No data during the experiment window.");
  if (reasons.length) return { metric, baseline: b, during: d, delta: null, threshold, thresholdLabel, verdict: "inconclusive", reasons };
  const delta = metric === "focus" ? (b! > 0 ? Math.round(((d! - b!) / b!) * 1000) / 10 : null) : Math.round((d! - b!) * 10) / 10;
  if (delta === null) return { metric, baseline: b, during: d, delta: null, threshold, thresholdLabel, verdict: "inconclusive", reasons: ["Baseline focus was zero — relative change is undefined."] };
  const verdict = delta >= threshold ? "worked" : delta <= -threshold ? "didnt" : "inconclusive";
  reasons.push(verdict === "worked" ? `Change beat the threshold (${thresholdLabel}).` : verdict === "didnt" ? `Metric dropped past the negative threshold (−${threshold}${metric === "focus" ? "%" : " pp"}).` : `Change stayed inside the noise band (±${threshold}${metric === "focus" ? "%" : " pp"}).`);
  return { metric, baseline: b, during: d, delta, threshold, thresholdLabel, verdict, reasons };
}