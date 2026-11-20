import type { GameConfig } from "@/config/schema";
import { round2 } from "./xp";

/**
 * Season Score (SS) engine (doc 04 §3, §6; doc 07 §6.3). SS can go negative, unlike XP.
 * Penalties are floored per day (−40) and per week (−120, or −50 after a Reset Week).
 */

export type MissKind = "core" | "fixed" | "pillar" | "weekly_boss";

export interface Miss {
  kind: MissKind;
  title?: string;
}

export interface ScoreEntry {
  amount: number;
  ruleKey: string;
  reason: string;
  capApplied: boolean;
}

export interface DayCloseContext {
  /** Sum of penalties already booked this week (≤ 0). */
  weekPenaltiesSoFar: number;
  /** A Shield was spent on this day → no penalties. */
  shieldUsed?: boolean;
  /** A Life Event was declared for this day → no penalties. */
  lifeEvent?: boolean;
  /** Week was reset (Reset Week) → weekly floor becomes `resetWeekFloor`. */
  weekReset?: boolean;
}

export function penaltyFor(kind: MissKind, cfg: GameConfig): number {
  const s = cfg.score;
  return { core: s.missCore, fixed: s.missFixed, pillar: s.missPillar, weekly_boss: s.skipWeeklyBoss }[kind];
}

/**
 * Penalties for the misses of one closed day, applying the daily and weekly floors.
 * Seed-tier completion is NOT a miss (callers only pass genuinely missed quests).
 */
export function dayPenalties(misses: Miss[], ctx: DayCloseContext, cfg: GameConfig): ScoreEntry[] {
  if (misses.length === 0) return [];
  if (ctx.shieldUsed || ctx.lifeEvent) {
    const why = ctx.shieldUsed ? "Shield used" : "Life Event declared";
    return [{ amount: 0, ruleKey: ctx.shieldUsed ? "ss.shield" : "ss.life_event", reason: `${why}: ${misses.length} miss(es) forgiven`, capApplied: false }];
  }
  const weekFloor = ctx.weekReset ? cfg.score.resetWeekFloor : cfg.score.weeklyFloor;
  let dayTotal = 0;
  let weekTotal = Math.min(0, ctx.weekPenaltiesSoFar);
  const out: ScoreEntry[] = [];
  for (const m of misses) {
    const raw = penaltyFor(m.kind, cfg);
    const dayRoom = cfg.score.dailyFloor - dayTotal; // ≤ 0
    const weekRoom = weekFloor - weekTotal; // ≤ 0
    const amount = round2(Math.min(0, Math.max(raw, dayRoom, weekRoom)));
    const capApplied = amount > raw + 1e-9;
    const floorNote = capApplied ? (Math.max(dayRoom, weekRoom) === dayRoom ? ` (daily floor ${cfg.score.dailyFloor})` : ` (weekly floor ${weekFloor})`) : "";
    out.push({
      amount,
      ruleKey: `ss.miss.${m.kind}`,
      reason: `missed ${m.kind.replace("_", " ")}${m.title ? `: ${m.title}` : ""}${floorNote}`,
      capApplied,
    });
    dayTotal += amount;
    weekTotal += amount;
  }
  return out;
}

/** Comeback: completing the Comeback quest refunds a share of the missed day's penalties. */
export function comebackRefund(missedDayPenalty: number, cfg: GameConfig): ScoreEntry {
  const amount = round2(Math.max(0, -missedDayPenalty) * cfg.score.comebackRefund);
  return { amount, ruleKey: "ss.comeback", reason: `Comeback: ${cfg.score.comebackRefund * 100}% of ${missedDayPenalty} refunded`, capApplied: false };
}

/**
 * Re-floors an already-booked week after Reset Week: if penalties exceed the reset floor, returns a positive
 * correction entry so the week's penalty total equals the floor.
 */
export function resetWeekCorrection(weekPenalties: number, cfg: GameConfig): ScoreEntry | null {
  const floor = cfg.score.resetWeekFloor;
  if (weekPenalties >= floor) return null;
  return { amount: round2(floor - weekPenalties), ruleKey: "ss.reset_week", reason: `Reset Week: penalties limited to ${floor}`, capApplied: true };
}

/** Boss/Arena SS contribution — based on net % (negative marking included), so a bad guessing run hurts. */
export function bossScore(netPct: number, kind: "weekly_boss" | "mini_trial" | "region_boss" | "mock_exam"): ScoreEntry {
  return { amount: round2(netPct), ruleKey: `ss.${kind}`, reason: `${kind.replace("_", " ")} net ${netPct}%`, capApplied: false };
}

export interface WeekScoreInput {
  studyXp: number;
  bossEntries: number;
  penalties: number; // ≤ 0, already floored
  corrections?: number; // comeback refunds, reset corrections (≥ 0)
}

/** Weekly SS (doc 07 §6.3): study XP of the week + boss results − penalties. */
export function weekScore(w: WeekScoreInput): number {
  return round2(Math.max(0, w.studyXp) + w.bossEntries + Math.min(0, w.penalties) + Math.max(0, w.corrections ?? 0));
}

/** Week id = ISO date of the Saturday starting the week. */
export { weekStartSaturday as weekIdFor } from "@/i18n/jalali";
