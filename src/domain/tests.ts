/**
 * Test scoring (F-LOG-03, doc 07 §6.3).
 * net% = (correct − wrong/(choices−1)) / total × 100, where total = correct + wrong + blank.
 * For 4-choice questions every wrong answer cancels a third of a correct one (negative marking).
 */

export interface TestCounts {
  correct: number;
  wrong: number;
  blank: number;
  choices?: number;
}

export function validateCounts({ correct, wrong, blank, choices = 4 }: TestCounts): string | null {
  for (const [k, v] of Object.entries({ correct, wrong, blank })) {
    if (!Number.isInteger(v) || v < 0) return `${k} must be a non-negative integer`;
  }
  if (!Number.isInteger(choices) || choices < 2) return "choices must be an integer ≥ 2";
  if (correct + wrong + blank === 0) return "at least one question is required";
  if (correct + wrong + blank > 1000) return "too many questions in one log (max 1000)";
  return null;
}

/** Net percentage, rounded to 2 decimals. Can be negative (min −100/(choices−1)). */
export function netPct({ correct, wrong, blank, choices = 4 }: TestCounts): number {
  const total = correct + wrong + blank;
  if (total === 0) return 0;
  const raw = ((correct - wrong / (choices - 1)) / total) * 100;
  return Math.round(raw * 100) / 100;
}

/** Plain accuracy over attempted questions (for display only). */
export function accuracy({ correct, wrong }: TestCounts): number {
  const attempted = correct + wrong;
  return attempted === 0 ? 0 : Math.round((correct / attempted) * 10000) / 100;
}

/** Aggregates several logs into one net% (weighted by question count; same choices assumed per log). */
export function aggregateNetPct(logs: TestCounts[]): number {
  let num = 0;
  let total = 0;
  for (const l of logs) {
    const choices = l.choices ?? 4;
    num += l.correct - l.wrong / (choices - 1);
    total += l.correct + l.wrong + l.blank;
  }
  return total === 0 ? 0 : Math.round((num / total) * 10000) / 100;
}
