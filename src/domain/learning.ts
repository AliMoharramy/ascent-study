import { addDaysIso } from "@/i18n/jalali";

/** Interleaving, pretest effect, 5 mastery levels and round-2/3 scheduling (issue #89, F-LRN-05/06/14/15). */

export const MASTERY_LEVELS = ["Seen", "Familiar", "Practiced", "Strong", "Legendary"] as const;
export type MasteryLevel = 0 | 1 | 2 | 3 | 4;

export function masteryLevel(s: { hasStudy: boolean; hasPassing: boolean; cleared: boolean; round3Done: boolean; pretested: boolean }): MasteryLevel {
  if (s.cleared && s.round3Done) return 4;
  if (s.cleared) return 3;
  if (s.hasPassing || s.pretested) return 2;
  if (s.hasStudy) return 1;
  return 0;
}

/** Pretest (3 questions before the video) nudges the a0 prior used by Triage — retrieval first. */
export function pretestA0(correct: number, total: number, weight: number): number {
  return Math.min(1, Math.max(0, (correct / Math.max(1, total)) * weight));
}

/** Pick up to 3 chapters from different subjects for a mixed (interleaved) session. */
export function interleavePick<T extends { id: string; subjectId: string }>(chapters: T[], seed: number): T[] {
  const bySubject = new Map<string, T[]>();
  for (const c of chapters) bySubject.set(c.subjectId, [...(bySubject.get(c.subjectId) ?? []), c]);
  const subjects = [...bySubject.keys()].sort();
  const out: T[] = [];
  for (let i = 0; i < Math.min(3, subjects.length); i++) {
    const list = bySubject.get(subjects[(seed + i) % subjects.length]!)!;
    out.push(list[(seed + i * 7) % list.length]!);
  }
  return out;
}

/** Round 2 lands round2GapDays after round 1 is done; round 3 another round3GapDays later. */
export function roundDates(round1DoneOn: string, round2GapDays: number, round3GapDays: number): { round2: string; round3: string } {
  const round2 = addDaysIso(round1DoneOn, round2GapDays);
  return { round2, round3: addDaysIso(round2, round3GapDays) };
}
