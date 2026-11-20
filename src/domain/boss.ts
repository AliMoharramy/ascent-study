import type { GameConfig } from "@/config/schema";
import { netPct } from "./tests";
import { round2 } from "./xp";

/**
 * Bosses (doc 04 §8, F-BOSS-01..03,05, T-R2-04). The system holds NO questions (C18): it only specifies
 * chapters / count / time and records per-chapter results. Weekly Boss threshold rises with level (40 → 55 %).
 */

export type BossKind = "weekly" | "region" | "mini_trial" | "mock" | "final";

export interface BossSpec {
  kind: BossKind;
  title: string;
  questions: number;
  minutes: number;
  threshold: number | null; // null = no fail condition (Mini-Trial)
  chapters: { chapterId: string; questions: number }[];
}

export function weeklyThreshold(level: number, cfg: GameConfig): number {
  const b = cfg.boss;
  return round2(Math.min(b.weeklyThresholdMax, b.weeklyThresholdStart + b.thresholdPerLevel * Math.max(0, level)));
}

/** Spreads `total` questions over chapters proportionally to weights (largest remainder). */
export function distribute(total: number, items: { id: string; weight: number }[]): { chapterId: string; questions: number }[] {
  if (items.length === 0 || total <= 0) return [];
  const sum = items.reduce((s, i) => s + Math.max(0.0001, i.weight), 0);
  const raw = items.map((i) => ({ id: i.id, exact: (total * Math.max(0.0001, i.weight)) / sum }));
  const out = raw.map((r) => ({ chapterId: r.id, questions: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let left = total - out.reduce((s, o) => s + o.questions, 0);
  for (const o of [...out].sort((a, b) => b.rem - a.rem)) {
    if (left <= 0) break;
    o.questions += 1;
    left -= 1;
  }
  return out.filter((o) => o.questions > 0).map(({ chapterId, questions }) => ({ chapterId, questions }));
}

/** Weekly Boss: 25 timed tests, 80 % this week's chapters + 20 % review of earlier ones. */
export function weeklyBossSpec(weekChapters: { id: string; weight: number }[], reviewChapters: { id: string; weight: number }[], level: number, cfg: GameConfig): BossSpec {
  const b = cfg.boss;
  const reviewQ = reviewChapters.length ? Math.round(b.weeklyQuestions * b.weeklyReviewShare) : 0;
  const mainQ = weekChapters.length ? b.weeklyQuestions - reviewQ : 0;
  const chapters = [...distribute(mainQ, weekChapters), ...distribute(reviewChapters.length ? b.weeklyQuestions - mainQ : 0, reviewChapters)];
  return { kind: "weekly", title: "Weekly Boss", questions: b.weeklyQuestions, minutes: b.weeklyMinutes, threshold: weeklyThreshold(level, cfg), chapters };
}

export function regionBossSpec(realm: number, chapters: { id: string; weight: number }[], cfg: GameConfig): BossSpec {
  return { kind: "region", title: `Gatekeeper of Realm ${["I", "II", "III", "IV"][realm - 1] ?? realm}`, questions: cfg.boss.regionQuestions, minutes: cfg.boss.regionMinutes, threshold: cfg.boss.regionThreshold, chapters: distribute(cfg.boss.regionQuestions, chapters) };
}

export function miniTrialSpec(chapters: { id: string; weight: number }[], cfg: GameConfig): BossSpec {
  return { kind: "mini_trial", title: "Mini-Trial", questions: cfg.boss.miniTrialQuestions, minutes: cfg.boss.miniTrialMinutes, threshold: null, chapters: distribute(cfg.boss.miniTrialQuestions, chapters) };
}

export interface ChapterResult {
  chapterId: string;
  correct: number;
  wrong: number;
  blank: number;
}

export interface BossOutcome {
  netPct: number;
  defeated: boolean | null;
  hpLeft: number; // 0..100 (boss HP after the hit)
  perChapter: (ChapterResult & { netPct: number })[];
}

/** Boss HP: 100 at 0 % net, 0 at the threshold (or beyond). */
export function bossOutcome(results: ChapterResult[], threshold: number | null, choices = 4): BossOutcome {
  const t = results.reduce((s, r) => ({ correct: s.correct + r.correct, wrong: s.wrong + r.wrong, blank: s.blank + r.blank, choices }), { correct: 0, wrong: 0, blank: 0, choices });
  const n = t.correct + t.wrong + t.blank ? netPct(t) : 0;
  const thr = threshold ?? 100;
  return {
    netPct: n,
    defeated: threshold === null ? null : n >= threshold,
    hpLeft: Math.round(Math.max(0, Math.min(100, 100 - (Math.max(0, n) / Math.max(1, thr)) * 100))),
    perChapter: results.map((r) => ({ ...r, netPct: r.correct + r.wrong + r.blank ? netPct({ ...r, choices }) : 0 })),
  };
}
