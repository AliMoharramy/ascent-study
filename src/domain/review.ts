import type { GameConfig } from "@/config/schema";
import { addDaysIso } from "@/i18n/jalali";

/**
 * Spaced review (doc 07 §6.7, F-ERR-03): simple SM-2 ladder 1, 3, 7, 14, 30 days.
 * "good" → next step, "hard" → back one step, "again" → reset to step 0 (due tomorrow).
 */

export type ReviewAnswer = "again" | "hard" | "good";

export interface CardState {
  step: number; // index into intervals (−1 = new)
  reps: number;
  dueOn: string; // ISO game day
}

export function newCard(today: string, cfg: GameConfig): CardState {
  return { step: -1, reps: 0, dueOn: addDaysIso(today, cfg.review.intervals[0]!) };
}

export function answerCard(s: CardState, answer: ReviewAnswer, today: string, cfg: GameConfig): CardState {
  const iv = cfg.review.intervals;
  const step = answer === "good" ? Math.min(iv.length - 1, s.step + 1) : answer === "hard" ? Math.max(0, s.step - 1) : 0;
  return { step, reps: s.reps + 1, dueOn: addDaysIso(today, iv[step]!) };
}

export const isDue = (s: CardState, today: string) => s.dueOn <= today;
