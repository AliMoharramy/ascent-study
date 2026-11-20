import { netPct } from "./tests";

/**
 * Exam simulator (F-LRN-01). The answer sheet stores one mark per question — never the question itself.
 * A suspect mark is an independent flag ("review this if time remains"), so it never changes the net score.
 */

export type ExamMark = "blank" | "correct" | "wrong";
export type ExamMode = "correct" | "wrong" | "suspect" | "clear";

export const EXAM_MARK_CYCLE: Record<ExamMark, ExamMark> = { blank: "correct", correct: "wrong", wrong: "blank" };

/** Applies a marking mode to one cell. Suspect toggles the flag and leaves the answer untouched. */
export function applyMark(mark: ExamMark, suspect: boolean, mode: ExamMode): { mark: ExamMark; suspect: boolean } {
  if (mode === "suspect") return { mark, suspect: !suspect };
  if (mode === "clear") return { mark: "blank", suspect: false };
  if (mode === "correct") return { mark: mark === "correct" ? "blank" : "correct", suspect };
  return { mark: mark === "wrong" ? "blank" : "wrong", suspect };
}

export function examCounts(marks: ExamMark[]): { correct: number; wrong: number; blank: number } {
  return marks.reduce(
    (a, m) => ({ correct: a.correct + (m === "correct" ? 1 : 0), wrong: a.wrong + (m === "wrong" ? 1 : 0), blank: a.blank + (m === "blank" ? 1 : 0) }),
    { correct: 0, wrong: 0, blank: 0 },
  );
}

/** Exact net score: (correct − wrong/(choices−1)) / total × 100, rounded to 2 decimals. */
export function examNet(marks: ExamMark[], choices = 4): number {
  return netPct({ ...examCounts(marks), choices });
}

export function answeredCount(marks: ExamMark[]): number {
  return marks.reduce((n, m) => n + (m === "blank" ? 0 : 1), 0);
}

export function suspectCount(flags: boolean[]): number {
  return flags.reduce((n, f) => n + (f ? 1 : 0), 0);
}

/** mm:ss for the exam clock (never negative). */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
