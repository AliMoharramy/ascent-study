import type { GameConfig } from "@/config/schema";
import { diffDaysIso } from "@/i18n/jalali";
import { netPct } from "./tests";

/**
 * Chapter Clear rule (doc 04 §11, F-MAP-02, T-R2-02). A chapter is Cleared when there are ≥ 2 *spaced* test
 * sessions (≥ 2 days apart) on it, each with ≥ minQuestions questions and net ≥ 60 %. Anti-gaming: a single
 * cram day, tiny sessions or guessing (negative marking) can't clear a chapter.
 */

export interface ChapterTestLog {
  gameDay: string;
  correct: number;
  wrong: number;
  blank: number;
  choices: number;
}

export interface ClearSession {
  day: string;
  questions: number;
  netPct: number;
  passes: boolean;
}

/** One session = all logs of a game day on the chapter. */
export function chapterSessions(logs: ChapterTestLog[], cfg: GameConfig): ClearSession[] {
  const byDay = new Map<string, ChapterTestLog[]>();
  for (const l of logs) byDay.set(l.gameDay, [...(byDay.get(l.gameDay) ?? []), l]);
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, ls]) => {
      const t = ls.reduce((s, l) => ({ correct: s.correct + l.correct, wrong: s.wrong + l.wrong, blank: s.blank + l.blank, choices: l.choices }), { correct: 0, wrong: 0, blank: 0, choices: 4 });
      const q = t.correct + t.wrong + t.blank;
      const n = q ? netPct(t) : 0;
      return { day, questions: q, netPct: n, passes: q >= cfg.clear.minQuestions && n >= cfg.clear.minNetPct };
    });
}

export interface ClearStatus {
  cleared: boolean;
  clearedOn: string | null;
  passing: ClearSession[];
  why: string;
}

export function clearStatus(logs: ChapterTestLog[], cfg: GameConfig): ClearStatus {
  const c = cfg.clear;
  const passing = chapterSessions(logs, cfg).filter((s) => s.passes);
  // greedy: earliest chain of minSessions passing sessions each ≥ minGapDays after the previous
  const chain: ClearSession[] = [];
  for (const s of passing) if (chain.length === 0 || diffDaysIso(s.day, chain[chain.length - 1]!.day) >= c.minGapDays) chain.push(s);
  const cleared = chain.length >= c.minSessions;
  const why = cleared
    ? `Cleared on ${chain[c.minSessions - 1]!.day}: ${c.minSessions} sessions ≥ ${c.minNetPct}% net, ≥ ${c.minGapDays} days apart`
    : passing.length === 0
      ? `Needs a test session with ≥ ${c.minQuestions} questions at ≥ ${c.minNetPct}% net`
      : `${chain.length}/${c.minSessions} spaced passing sessions — next one at least ${c.minGapDays} days after ${chain[chain.length - 1]!.day}`;
  return { cleared, clearedOn: cleared ? chain[c.minSessions - 1]!.day : null, passing, why };
}
