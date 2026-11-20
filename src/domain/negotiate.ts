/**
 * Plan negotiator (#102, F-AIX-02): "this week is hard — lighten the plan". Pure proposal builder; nothing
 * moves until the user explicitly approves (the server applies an approved proposal, never the chat itself).
 * M-tier chapters are never moved; C first, then S. Whole items move to the next week.
 */

export interface NegotiateItem {
  id: string;
  chapterId: string;
  tier: "M" | "S" | "C";
  plannedMin: number;
  weekNo: number;
}

export interface ProposalChange {
  itemId: string;
  chapterId: string;
  fromWeek: number;
  toWeek: number;
  minutes: number;
}

export interface LightenProposal {
  weekNo: number;
  changes: ProposalChange[];
  beforeMin: number;
  afterMin: number;
  movedMin: number;
  targetMin: number;
  fraction: number;
}

export const LIGHTEN_FRACTION = 0.25;

export function lightenWeek(items: NegotiateItem[], weekNo: number, maxWeek: number, fraction = LIGHTEN_FRACTION): LightenProposal | null {
  if (weekNo >= maxWeek) return null;
  const weekItems = items.filter((i) => i.weekNo === weekNo);
  const beforeMin = weekItems.reduce((s, i) => s + i.plannedMin, 0);
  if (beforeMin <= 0) return null;
  const targetMin = Math.round(beforeMin * (1 - fraction));
  const needMin = beforeMin - targetMin;
  const rank = { C: 0, S: 1, M: 2 } as const;
  const movable = weekItems.filter((i) => i.tier !== "M").sort((a, b) => rank[a.tier] - rank[b.tier] || b.plannedMin - a.plannedMin);
  const changes: ProposalChange[] = [];
  let movedMin = 0;
  for (const it of movable) {
    if (movedMin >= needMin) break;
    changes.push({ itemId: it.id, chapterId: it.chapterId, fromWeek: weekNo, toWeek: weekNo + 1, minutes: it.plannedMin });
    movedMin += it.plannedMin;
  }
  if (changes.length === 0) return null;
  return { weekNo, changes, beforeMin, afterMin: beforeMin - movedMin, movedMin, targetMin, fraction };
}