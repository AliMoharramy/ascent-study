import type { GameConfig } from "@/config/schema";
import { round2 } from "./xp";

/**
 * Shadow Rival (doc 04 §7, F-RIV-01/02, T-R2-03). The Shadow walks the *planned* path:
 *   MP(t) = Σ tier weights (M3 S2 C1) of chapters planned to finish by week t
 *   pace p ∈ [0.85, 1.10]; each week p ← clamp(0.5·p + 0.5·(user_pace_4w × 1.05))
 *   Shadow(t) = MP(t) × p   → never more than 110 % of the plan
 *   Shadow accuracy = linear from a0 baseline to the target net % (35 %)
 * If the user is ≥ 20 % behind for 2 weeks: "Shadow Rests" — the gap shrinks by 10 %. Every number has a "why".
 */

export interface RivalWeekInput {
  week: number;
  planMp: number; // cumulative planned MP by end of week
  userMp: number; // cumulative MP the user actually earned (cleared chapters)
}

export interface RivalWeek {
  week: number;
  pace: number;
  planMp: number;
  shadowMp: number;
  userMp: number;
  gap: number; // user − shadow
  rested: boolean;
  why: string;
}

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function nextPace(pace: number, userPace4w: number, cfg: GameConfig): number {
  const r = cfg.rival;
  return round2(clamp(0.5 * pace + 0.5 * (userPace4w * r.userPaceBoost), r.paceMin, r.paceMax));
}

/** Simulates the rivalry week by week (pure; replayable). */
export function simulateRival(weeks: RivalWeekInput[], cfg: GameConfig): RivalWeek[] {
  const r = cfg.rival;
  let pace = r.paceStart;
  let behindStreak = 0;
  let restCut = 0; // cumulative MP the Shadow gave back
  const out: RivalWeek[] = [];
  weeks.forEach((w, i) => {
    let shadow = Math.max(0, w.planMp * pace - restCut);
    let rested = false;
    const behind = shadow > 0 ? (shadow - w.userMp) / shadow : 0;
    behindStreak = behind >= r.restsBehind ? behindStreak + 1 : 0;
    if (behindStreak >= r.restsWeeks) {
      const cut = (shadow - w.userMp) * r.restsGapCut;
      restCut += cut;
      shadow -= cut;
      rested = true;
      behindStreak = 0;
    }
    shadow = Math.min(shadow, w.planMp * r.paceMax); // hard guarantee: ≤ 110 % of the path
    out.push({
      week: w.week,
      pace,
      planMp: round2(w.planMp),
      shadowMp: round2(shadow),
      userMp: round2(w.userMp),
      gap: round2(w.userMp - shadow),
      rested,
      why: `Shadow = plan MP ${round2(w.planMp)} × pace ${pace}${restCut > 0 ? ` − ${round2(restCut)} given back (Shadow Rests)` : ""}`,
    });
    // pace for next week from the user's last 4 weeks vs plan
    const prev = i >= 4 ? weeks[i - 4]! : { planMp: 0, userMp: 0 };
    const planD = w.planMp - prev.planMp;
    const userD = w.userMp - prev.userMp;
    const userPace = planD > 0 ? userD / planD : 1;
    pace = nextPace(pace, userPace, cfg);
  });
  return out;
}

/** Target accuracy the Shadow holds in week t (linear a0 → target by the last study week). */
export function shadowAccuracy(week: number, a0Pct: number, cfg: GameConfig, lastWeek = 24): number {
  const t = clamp((week - 1) / Math.max(1, lastWeek - 1), 0, 1);
  return round2(a0Pct + (cfg.rival.targetNetPct - a0Pct) * t);
}

export interface DuelSide {
  mp: number;
  netPct: number;
  analyses: number;
  consistency: number; // 0..1
  bossPct: number | null;
}

export interface DuelRound {
  key: "mp" | "net" | "analyses" | "consistency" | "boss";
  label: string;
  you: number;
  shadow: number;
  winner: "user" | "shadow" | "draw";
}

/** Weekly duel, best of 5 (doc 04 §7.3). */
export function duel(you: DuelSide, shadow: DuelSide): { rounds: DuelRound[]; winner: "user" | "shadow" | "draw"; score: [number, number] } {
  const cmp = (a: number, b: number) => (Math.abs(a - b) < 1e-9 ? "draw" : a > b ? "user" : "shadow") as DuelRound["winner"];
  const rounds: DuelRound[] = [
    { key: "mp", label: "Mastery Points", you: you.mp, shadow: shadow.mp, winner: cmp(you.mp, shadow.mp) },
    { key: "net", label: "Net %", you: you.netPct, shadow: shadow.netPct, winner: cmp(you.netPct, shadow.netPct) },
    { key: "analyses", label: "Error analyses", you: you.analyses, shadow: shadow.analyses, winner: cmp(you.analyses, shadow.analyses) },
    { key: "consistency", label: "Consistency", you: Math.round(you.consistency * 100), shadow: Math.round(shadow.consistency * 100), winner: cmp(you.consistency, shadow.consistency) },
    { key: "boss", label: "Weekly Boss", you: you.bossPct ?? 0, shadow: shadow.bossPct ?? 0, winner: you.bossPct == null ? "shadow" : cmp(you.bossPct, shadow.bossPct ?? 0) },
  ];
  const u = rounds.filter((r) => r.winner === "user").length;
  const s = rounds.filter((r) => r.winner === "shadow").length;
  return { rounds, winner: u > s ? "user" : s > u ? "shadow" : "draw", score: [u, s] };
}

/** The Shadow's side for a week: plan-based, with "Shadow" norms for the habit rounds. */
export function shadowSide(week: RivalWeek, accuracy: number, weekPlanMp: number, threshold: number): DuelSide {
  return { mp: round2(weekPlanMp * week.pace), netPct: accuracy, analyses: 15, consistency: 0.8, bossPct: threshold };
}
