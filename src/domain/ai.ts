import { z } from "zod";
import type { GameConfig } from "@/config/schema";

/** AI guard + structured outputs + deterministic local provider (issues #92–#94, #97).
 * Privacy (F-AI-06): only numeric summaries leave the device; names, notes and free text never do. */

export const weeklySummarySchema = z.object({
  weekNo: z.number().int(),
  hours: z.number(),
  xp: z.number(),
  testsNet: z.number(),
  consistency: z.number(),
  sleepAvgHours: z.number(),
  topCauses: z.array(z.object({ cause: z.string(), count: z.number() })),
});
export type WeeklySummary = z.infer<typeof weeklySummarySchema>;

/** Strips everything except aggregates — the guard runs before any provider call. */
export function guardSummary(raw: Record<string, unknown>): WeeklySummary {
  return weeklySummarySchema.parse({
    weekNo: raw.weekNo ?? 0,
    hours: raw.hours ?? 0,
    xp: raw.xp ?? 0,
    testsNet: raw.testsNet ?? 0,
    consistency: raw.consistency ?? 0,
    sleepAvgHours: raw.sleepAvgHours ?? 0,
    topCauses: Array.isArray(raw.topCauses) ? raw.topCauses.slice(0, 6) : [],
  });
}

export const weeklyReviewSchema = z.object({
  summary: z.string().min(1).max(600),
  patterns: z.array(z.string().max(200)).max(5),
  oneChange: z.string().min(1).max(200),
  errorGroups: z.array(z.object({ cause: z.string(), count: z.number().int(), concepts: z.array(z.string()).max(6), mission: z.string().max(200) })).max(6),
});
export type WeeklyReview = z.infer<typeof weeklyReviewSchema>;

export const narrativeSchema = z.object({ title: z.string().max(120), text: z.string().max(900) });
export type Narrative = z.infer<typeof narrativeSchema>;

export const anomalyAlertsSchema = z.object({
  alerts: z.array(z.object({ key: z.string(), message: z.string().max(240), severity: z.enum(["info", "warn"]) })).max(6),
});
export type AnomalyAlerts = z.infer<typeof anomalyAlertsSchema>;

export function estimateCost(tokensIn: number, tokensOut: number, ai: GameConfig["ai"]): number {
  return Math.round(((tokensIn / 1000) * ai.pricePer1kIn + (tokensOut / 1000) * ai.pricePer1kOut) * 10000) / 10000;
}

/** Deterministic offline provider — the app is fully useful with AI off (F-AIX-08). */
export function localWeeklyReview(s: WeeklySummary, groups: { cause: string; count: number; concepts: string[] }[]): WeeklyReview {
  const patterns: string[] = [];
  if (s.consistency >= 0.7) patterns.push(`Consistency ${Math.round(s.consistency * 100)} % — the engine is humming.`);
  else patterns.push(`Consistency ${Math.round(s.consistency * 100)} % — protect the Core block before adding anything.`);
  if (s.sleepAvgHours > 0 && s.sleepAvgHours < 7) patterns.push(`Sleep averaged ${s.sleepAvgHours} h; debt compounds quietly.`);
  if (s.testsNet < 40) patterns.push(`Net ${s.testsNet} % — accuracy work beats volume this week.`);
  const top = s.topCauses[0];
  const oneChange = top ? `Batch one 25-min ${top.cause}-cause fix session before the next mock.` : "Keep the nightly review under two minutes.";
  return weeklyReviewSchema.parse({
    summary: `Week ${s.weekNo}: ${s.hours} h focused, ${s.xp} XP, net ${s.testsNet} %. ${patterns[0] ?? ""}`,
    patterns: patterns.slice(0, 5),
    oneChange,
    errorGroups: groups.slice(0, 6).map((g) => ({ ...g, mission: `3 targeted tests on ${g.concepts[0] ?? g.cause}, then write the takeaway in one line.` })),
  });
}

export function localNarrative(input: { chapterNo: number; cleared: number; total: number; weekNo: number }): Narrative {
  const pct = input.total ? Math.round((input.cleared / input.total) * 100) : 0;
  return narrativeSchema.parse({
    title: `Chapter ${input.chapterNo} — the path narrows`,
    text: `Week ${input.weekNo}. ${input.cleared} of ${input.total} nodes burn behind you (${pct} %). The fog ahead is not a wall; it is only unlit path. Shade walks the same road — slower than you think.`,
  });
}

/** Gentle anomaly alerts: a mirror, never a punishment (F-AI-05). */
export function localAnomalies(flags: { perfectAccuracy: boolean; overHours: boolean; manualShare: boolean; testsFlood: boolean }): AnomalyAlerts {
  const alerts: AnomalyAlerts["alerts"] = [];
  if (flags.perfectAccuracy) alerts.push({ key: "perfect", message: "A long perfect streak appeared. If those were real wins, wonderful — if the log drifted, fix it kindly; nothing is deducted.", severity: "info" });
  if (flags.overHours) alerts.push({ key: "hours", message: "More than 14 h of focus logged in a day. Rest is part of the plan — consider a Rest Day Pass.", severity: "warn" });
  if (flags.manualShare) alerts.push({ key: "manual", message: "Most entries today are manual. Live logging keeps the picture honest; no penalty either way.", severity: "info" });
  if (flags.testsFlood) alerts.push({ key: "flood", message: "Unusually many tests in one day. Quality over quantity — the caps already protect your XP.", severity: "info" });
  return anomalyAlertsSchema.parse({ alerts });
}

/** Anchor reminder voices (F-DUO-15): adjustable intensity, zero blame, ≤ 5/day enforced server-side. */
export function reminderText(anchor: string, tone: GameConfig["reminders"]["tone"]): { title: string; body: string } {
  const t = {
    calm: { title: `A quiet nudge: ${anchor}`, body: "Whenever you're ready, the anchor is waiting. One small rep counts." },
    playful: { title: `Psst — ${anchor}!`, body: "Your future self just waved from the Summit. Two minutes now, and the streak smiles." },
    direct: { title: anchor, body: "Scheduled anchor. Do the smallest version, then move on." },
  }[tone];
  return t;
}
