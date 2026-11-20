import type { GameConfig } from "@/config/schema";
import { netPct } from "./tests";
import { round2 } from "./xp";

/**
 * Baseline Report (doc 05 §4.4, F-PLAN-03/04, T-R1-16) and the Daily Goal (F-DUO-03).
 * Pure aggregations over week-1 data; the server feeds rows and renders the 8 sections.
 */

export interface FocusBlock {
  startedAtLocal: { weekday: number; hour: number }; // weekday 0 = Sat
  minutes: number;
}

/** Best time blocks: 2-hour slots by weekday ranked by focused minutes. */
export function bestBlocks(blocks: FocusBlock[], top = 3): { weekday: number; from: number; to: number; minutes: number }[] {
  const m = new Map<string, number>();
  for (const b of blocks) {
    const slot = Math.floor(b.startedAtLocal.hour / 2) * 2;
    const k = `${b.startedAtLocal.weekday}:${slot}`;
    m.set(k, (m.get(k) ?? 0) + b.minutes);
  }
  return [...m.entries()]
    .map(([k, minutes]) => {
      const [weekday, from] = k.split(":").map(Number);
      return { weekday: weekday!, from: from!, to: from! + 2, minutes };
    })
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, top);
}

/** Top frictions from check-in blockers (normalised free text). */
export function topFrictions(blockers: (string | null)[], top = 5): { text: string; count: number }[] {
  const m = new Map<string, { text: string; count: number }>();
  for (const b of blockers) {
    const t = (b ?? "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    const e = m.get(k) ?? { text: t, count: 0 };
    e.count += 1;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, top);
}

const FRICTION_FIX: [RegExp, string][] = [
  [/خست|tired|sleep|خواب/i, "Move the hardest block to your best time slot; protect sleep (Sleep Program)."],
  [/گوشی|phone|mobile|instagram|social/i, "Phone in another room during Core; use Focus Mode (F)."],
  [/کلاس|class|uni|دانشگاه/i, "Declare class days as exceptions in your time windows."],
  [/انگیزه|motivat|حوصله/i, "Start with Seed (2 minutes) — motivation follows action."],
  [/کد|code|idea|ایده/i, "Park it in the Idea Vault (N); Builder Hour is for that."],
];

export function frictionFix(text: string): string {
  return FRICTION_FIX.find(([re]) => re.test(text))?.[1] ?? "Make the first step smaller and prepare it the night before.";
}

/** a0 per chapter from scouting tests (≥ 2 questions on the chapter). Returned as 0..1. */
export function scoutingA0(logs: { chapterId: string | null; correct: number; wrong: number; blank: number; choices: number }[]): Record<string, { a0: number; questions: number }> {
  const agg = new Map<string, { correct: number; wrong: number; blank: number; choices: number }>();
  for (const l of logs) {
    if (!l.chapterId) continue;
    const a = agg.get(l.chapterId) ?? { correct: 0, wrong: 0, blank: 0, choices: l.choices };
    agg.set(l.chapterId, { correct: a.correct + l.correct, wrong: a.wrong + l.wrong, blank: a.blank + l.blank, choices: l.choices });
  }
  const out: Record<string, { a0: number; questions: number }> = {};
  for (const [id, a] of agg) {
    const q = a.correct + a.wrong + a.blank;
    if (q >= 2) out[id] = { a0: round2(Math.max(0, netPct(a)) / 100), questions: q };
  }
  return out;
}

// ── Daily goal (F-DUO-03) ─────────────────────────────────────

export interface DailyGoal {
  minutes: number;
  tier: "seed" | "standard" | "stretch";
  setOn: string;
}

const MAX_SUGGESTED_DAILY_GOAL_MINUTES = 240;

export function goalProgress(goal: DailyGoal, focusMin: number): { value: number; done: boolean } {
  return { value: Math.min(1, focusMin / Math.max(1, goal.minutes)), done: focusMin >= goal.minutes };
}

/** After a successful day, suggest a 2% increase rounded to 5 minutes, capped at the current 4h daily average. */
export function goalUpgrade(goal: DailyGoal, today: string, hits: boolean[], cfg: GameConfig, daysSince: (a: string, b: string) => number): { suggest: boolean; minutes: number; hitRate: number } {
  const window = hits.slice(-cfg.goal.upgradeEveryDays);
  const hitRate = window.length ? window.filter(Boolean).length / window.length : 0;
  const due = daysSince(today, goal.setOn) >= cfg.goal.upgradeEveryDays && window.length >= cfg.goal.upgradeEveryDays;
  const next = Math.ceil((goal.minutes * cfg.goal.upgradeFactor) / 5) * 5;
  const minutes = goal.minutes >= MAX_SUGGESTED_DAILY_GOAL_MINUTES ? goal.minutes : Math.min(MAX_SUGGESTED_DAILY_GOAL_MINUTES, next);
  return { suggest: due && hitRate >= cfg.goal.upgradeHitRate && goal.minutes < MAX_SUGGESTED_DAILY_GOAL_MINUTES, minutes, hitRate: round2(hitRate) };
}
