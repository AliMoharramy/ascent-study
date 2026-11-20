import type { GameConfig } from "@/config/schema";
import { localParts } from "@/lib/time";

/** Forecast with confidence band, energy pattern, weak-point hunter, mistake mining,
 * time-per-question, skip-strategy math, what-if and rank estimation (issues #95, #99, #100). */

export interface NetSample {
  day: string;
  netPct: number;
  questions: number;
}

/** Recent-weighted mean net % with a confidence band that widens when data is scarce. */
export function forecastNet(samples: NetSample[]): { pct: number; lo: number; hi: number; n: number } {
  const s = [...samples].sort((a, b) => a.day.localeCompare(b.day));
  if (s.length === 0) return { pct: 0, lo: 0, hi: 0, n: 0 };
  const w = s.map((_, i) => 1 + i / Math.max(1, s.length - 1));
  const W = w.reduce((a, b) => a + b, 0);
  const mean = s.reduce((acc, x, i) => acc + x.netPct * w[i]!, 0) / W;
  const variance = s.reduce((acc, x, i) => acc + w[i]! * (x.netPct - mean) ** 2, 0) / W;
  const sd = Math.sqrt(variance);
  const band = Math.max(4, (1.96 * sd) / Math.sqrt(s.length)) + (s.length < 3 ? 6 : 0);
  const pct = Math.round(mean * 10) / 10;
  return { pct, lo: Math.round(Math.max(-100, pct - band) * 10) / 10, hi: Math.round(Math.min(100, pct + band) * 10) / 10, n: s.length };
}

export interface FocusPoint {
  startedAt: string;
  minutes: number;
}

/** Peak hours from real focus logs (F-ANA-05): minutes weighted by hour of day, local time. */
export function energyPattern(points: FocusPoint[], tz: string): { heat: number[]; peaks: number[] } {
  const heat = Array.from({ length: 24 }, () => 0);
  for (const p of points) {
    const h = localParts(new Date(p.startedAt), tz).hour;
    heat[h] = (heat[h] ?? 0) + p.minutes;
  }
  const peaks = heat.map((v, h) => ({ v, h })).sort((a, b) => b.v - a.v).slice(0, 3).filter((x) => x.v > 0).map((x) => x.h);
  return { heat, peaks };
}

export interface ErrorRow {
  cause: string;
  chapterId: string | null;
  subjectId: string | null;
  takeaway: string;
}

const STOP = new Set(["the", "a", "an", "of", "in", "on", "and", "or", "to", "was", "i", "my", "me", "it", "is", "that", "this", "for", "with", "را", "در", "به", "از", "که", "و", "من", "آن", "این", "یک", "برای", "تا", "هم", "ولی", "اما"]);

/** Cluster repeated concepts out of free-text takeaways (F-LRN-02). */
export function mistakeMining(errors: ErrorRow[]): { causes: { cause: string; count: number }[]; concepts: { word: string; count: number }[] } {
  const causes = new Map<string, number>();
  const words = new Map<string, number>();
  for (const e of errors) {
    causes.set(e.cause, (causes.get(e.cause) ?? 0) + 1);
    for (const w of e.takeaway.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (w.length < 3 || STOP.has(w)) continue;
      words.set(w, (words.get(w) ?? 0) + 1);
    }
  }
  return {
    causes: [...causes.entries()].map(([cause, count]) => ({ cause, count })).sort((a, b) => b.count - a.count),
    concepts: [...words.entries()].filter(([, c]) => c >= 2).map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count).slice(0, 12),
  };
}

export interface WeakInput {
  chapterId: string;
  subjectId: string;
  netPct: number | null;
  errors: number;
  cleared: boolean;
}

/** Top-10 weak chapters: low net + repeated errors, uncleared first (F-ERR-05). */
export function weakPoints(rows: WeakInput[]): (WeakInput & { score: number; mission: string })[] {
  return rows
    .map((r) => ({ ...r, score: (r.netPct === null ? 30 : Math.max(0, 60 - r.netPct)) + r.errors * 8 + (r.cleared ? -25 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((r) => ({ ...r, mission: `One 25-min targeted session on ${r.chapterId}: 10 tests + 2 error analyses` }));
}

export function timePerQuestion(logs: { seconds: number | null; correct: number; wrong: number; blank: number }[]): { secPerQ: number | null; slow: boolean; target: number } {
  const withTime = logs.filter((l) => l.seconds !== null && l.seconds > 0);
  const q = withTime.reduce((s, l) => s + l.correct + l.wrong + l.blank, 0);
  const sec = withTime.reduce((s, l) => s + (l.seconds ?? 0), 0);
  const secPerQ = q > 0 ? Math.round(sec / q) : null;
  return { secPerQ, slow: secPerQ !== null && secPerQ > 90, target: 90 };
}

/** Negative marking EV: answer = p − (1−p)/3; skip = 0. Optimal answer threshold p* = 0.25. */
export function answerEV(p: number, choices = 4): number {
  return p - (1 - p) / (choices - 1);
}
export function skipThreshold(choices = 4): number {
  return 1 / choices;
}
export function skipCurve(choices = 4): { p: number; ev: number }[] {
  const out: { p: number; ev: number }[] = [];
  for (let i = 0; i <= 20; i++) out.push({ p: i / 20, ev: Math.round(answerEV(i / 20, choices) * 1000) / 1000 });
  return out;
}

export interface PlanRow {
  chapterId: string;
  tier: "M" | "S" | "C";
  plannedMin: number;
}

/** What-if: drop/add chapters and see load + coverage effect, transparent arithmetic (F-LRN-03). */
export function whatIf(rows: PlanRow[], drop: string[], add: { chapterId: string; tier: "M" | "S" | "C"; plannedMin: number }[], baseForecast: number): { minutes: number; deltaMin: number; coverage: number; forecast: number } {
  const kept = rows.filter((r) => !drop.includes(r.chapterId));
  const all = [...kept, ...add];
  const minutes = all.reduce((s, r) => s + r.plannedMin, 0);
  const baseMin = rows.reduce((s, r) => s + r.plannedMin, 0);
  const mCount = all.filter((r) => r.tier === "M").length;
  const mBase = rows.filter((r) => r.tier === "M").length;
  const coverage = mBase ? mCount / mBase : 1;
  const forecast = Math.round((baseForecast + (coverage - 1) * 20) * 10) / 10;
  return { minutes, deltaMin: minutes - baseMin, coverage: Math.round(coverage * 100) / 100, forecast };
}

/** Monotone pct→rank interpolation on a transparent, user-editable curve (F-LRN-04). */
export function rankEstimate(pct: number, cfg: GameConfig["rank"]): { rank: number; lo: number; hi: number; source: string; assumed: boolean } {
  const c = [...cfg.curve].sort((a, b) => a.pct - b.pct);
  const first = c[0]!;
  const last = c[c.length - 1]!;
  let rank: number;
  if (pct <= first.pct) rank = first.rank;
  else if (pct >= last.pct) rank = last.rank;
  else {
    const i = c.findIndex((x) => x.pct >= pct);
    const a = c[i - 1]!;
    const b = c[i]!;
    const t = (pct - a.pct) / (b.pct - a.pct);
    rank = Math.round(Math.exp(Math.log(a.rank) + t * (Math.log(b.rank) - Math.log(a.rank))));
  }
  return { rank, lo: Math.max(1, Math.round(rank / cfg.bandFactor)), hi: Math.round(rank * cfg.bandFactor), source: cfg.source, assumed: cfg.assumed };
}
