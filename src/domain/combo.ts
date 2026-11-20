/**
 * Combo meter (F-GM-10 / F-DUO-13). A combo counts consecutive *clean* test logs — at least one correct answer
 * and zero wrong answers. It is cosmetic on purpose: it awards no XP, no Gold and no score, so logging more
 * cannot be gamed. A wrong answer (or blank-only log) ends the run.
 */

export interface ComboLog {
  correct: number;
  wrong: number;
}

export interface ComboState {
  current: number;
  clean: boolean;
  nextMilestone: number | null;
}

export const COMBO_MILESTONES = [3, 5, 10, 15, 20, 25, 30, 40, 50] as const;

export const isCleanLog = (l: ComboLog) => l.correct > 0 && l.wrong === 0;

/** Logs must be newest first. */
export function comboState(logs: ComboLog[]): ComboState {
  let current = 0;
  for (const l of logs) {
    if (!isCleanLog(l)) break;
    current += 1;
  }
  return { current, clean: current > 0, nextMilestone: COMBO_MILESTONES.find((m) => m > current) ?? null };
}

export function comboAfter(current: number, log: ComboLog): number {
  return isCleanLog(log) ? current + 1 : 0;
}

export const isComboMilestone = (n: number) => (COMBO_MILESTONES as readonly number[]).includes(n);
