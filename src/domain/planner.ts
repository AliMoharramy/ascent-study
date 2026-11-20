import type { GameConfig } from "@/config/schema";
import type { Tier } from "@/db/schema";
import { round2 } from "./xp";

/**
 * Planner (doc 03 §5-9, doc 07 §6.5, T-R1-08). Fills each remaining week of a subject's phase with its chapters
 * (M > S > C, subjects interleaved, chapter order) up to `capacity × fillFraction` minus the fixed daily work.
 * Nothing is carried as debt: a rebalance recomputes from the current week, drops C first and only *suggests*
 * moving S→C if a deficit remains. Also: Load Ratio, Burn Gap, today's Core quest.
 */

export const TOTAL_WEEKS = 25;

/** Phase layout of the campaign (doc 03 §1). */
export const PHASE_WEEKS: Record<number, [number, number]> = { 1: [2, 6], 2: [7, 11], 3: [12, 15], 4: [16, 19] };

export function weekPhase(no: number): { key: string; label: string; realm: number | null } {
  if (no <= 1) return { key: "awakening", label: "Ch.1 Awakening — Baseline", realm: null };
  for (const [p, [a, b]] of Object.entries(PHASE_WEEKS)) if (no >= a && no <= b) return { key: `realm${p}`, label: `Realm ${["I", "II", "III", "IV"][Number(p) - 1]}`, realm: Number(p) };
  if (no <= 21) return { key: "trials", label: "Ch.3 The Trials", realm: null };
  if (no <= 24) return { key: "arena", label: "Ch.4 The Arena", realm: null };
  return { key: "final", label: "Ch.5 Final Ascent", realm: null };
}

export interface PlanWeek {
  no: number;
  startsOn: string;
  capacityH: number;
}

export interface PlanChapter {
  id: string;
  subjectId: string;
  no: number;
  tier: Tier;
  phase: number; // subject priority_phase 1..4
  hoursRemaining: number;
  done?: boolean;
}

export interface PlanItem {
  week: number;
  chapterId: string;
  subjectId: string;
  tier: Tier;
  plannedMin: number;
  testsTarget: number;
}

export interface WeekSummary {
  no: number;
  startsOn: string;
  phase: string;
  capacityH: number;
  committedH: number;
  loadRatio: number;
  status: "green" | "yellow" | "red";
}

export interface PlanResult {
  items: PlanItem[];
  weeks: WeekSummary[];
  overflow: { chapterId: string; tier: Tier; hours: number }[];
  droppedC: string[];
  suggestions: string[];
}

export function loadStatus(r: number): WeekSummary["status"] {
  return r <= 0.9 ? "green" : r <= 1.0 ? "yellow" : "red";
}

const TIER_RANK: Record<Tier, number> = { M: 0, S: 1, C: 2 };

/** Interleaves subjects so a week holds both subjects of the realm (doc 03 §5). */
function orderQueue(chs: PlanChapter[]): PlanChapter[] {
  const sorted = [...chs].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.no - b.no);
  const out: PlanChapter[] = [];
  for (const tier of ["M", "S", "C"] as Tier[]) {
    const bySub = new Map<string, PlanChapter[]>();
    for (const c of sorted.filter((x) => x.tier === tier)) bySub.set(c.subjectId, [...(bySub.get(c.subjectId) ?? []), c]);
    const lists = [...bySub.values()];
    for (let i = 0; lists.some((l) => l.length > i); i++) for (const l of lists) if (l[i]) out.push(l[i]!);
  }
  return out;
}

export function plan(weeks: PlanWeek[], chapters: PlanChapter[], cfg: GameConfig, opts: { fromWeek?: number; dropC?: boolean; extraCommittedH?: Record<number, number> } = {}): PlanResult {
  const from = opts.fromWeek ?? 1;
  const fixedH = (cfg.capacity.fixedDailyMinutes * 7) / 60;
  const items: PlanItem[] = [];
  const overflow: PlanResult["overflow"] = [];
  const droppedC: string[] = [];
  const committed = new Map<number, number>();
  const testsShare = 0.3;

  for (const [p, [a, b]] of Object.entries(PHASE_WEEKS)) {
    const phaseWeeks = weeks.filter((w) => w.no >= Math.max(a, from) && w.no <= b);
    let queue = orderQueue(chapters.filter((c) => c.phase === Number(p) && !c.done && c.hoursRemaining > 0));
    if (opts.dropC) {
      droppedC.push(...queue.filter((c) => c.tier === "C").map((c) => c.id));
      queue = queue.filter((c) => c.tier !== "C");
    }
    let qi = 0;
    let left = queue[0]?.hoursRemaining ?? 0;
    for (const w of phaseWeeks) {
      let room = Math.max(0, w.capacityH * cfg.planner.fillFraction - fixedH);
      while (qi < queue.length && room > 0.05) {
        const c = queue[qi]!;
        const take = Math.min(room, left);
        items.push({ week: w.no, chapterId: c.id, subjectId: c.subjectId, tier: c.tier, plannedMin: Math.round(take * 60), testsTarget: Math.round(take * testsShare * cfg.planner.testsPerHour) });
        committed.set(w.no, (committed.get(w.no) ?? 0) + take);
        room -= take;
        left -= take;
        if (left <= 0.05) {
          qi++;
          left = queue[qi]?.hoursRemaining ?? 0;
        }
      }
    }
    for (let i = qi; i < queue.length; i++) overflow.push({ chapterId: queue[i]!.id, tier: queue[i]!.tier, hours: round2(i === qi ? left : queue[i]!.hoursRemaining) });
  }

  const summaries: WeekSummary[] = weeks.map((w) => {
    const c = round2((committed.get(w.no) ?? 0) + fixedH + (opts.extraCommittedH?.[w.no] ?? 0));
    const r = w.capacityH > 0 ? round2(c / w.capacityH) : c > 0 ? 9.99 : 0;
    return { no: w.no, startsOn: w.startsOn, phase: weekPhase(w.no).label, capacityH: w.capacityH, committedH: c, loadRatio: r, status: loadStatus(r) };
  });

  const suggestions: string[] = [];
  const missingMS = overflow.filter((o) => o.tier !== "C");
  if (missingMS.length) {
    const h = round2(missingMS.reduce((s, o) => s + o.hours, 0));
    suggestions.push(`${h}h of M/S work does not fit its phase. Consider moving these S chapters to C: ${overflow.filter((o) => o.tier === "S").map((o) => o.chapterId).join(", ") || "—"}`);
    suggestions.push("…or raise the playback speed of tips-and-tests videos (2×), or add a window to your week.");
  }
  return { items, weeks: summaries, overflow, droppedC, suggestions };
}

/** Rebalance (doc 03 §6): recompute from the current week with the measured capacity; C dropped, no debt. */
export function rebalance(weeks: PlanWeek[], chapters: PlanChapter[], currentWeek: number, cfg: GameConfig): PlanResult {
  const keep = plan(weeks, chapters, cfg, { fromWeek: currentWeek });
  if (keep.overflow.some((o) => o.tier !== "C")) return plan(weeks, chapters, cfg, { fromWeek: currentWeek, dropC: true });
  return keep;
}

/** Burn gap = hours still needed for M+S − study hours left before the end of Realm IV (positive = deficit). */
export function burnGap(chapters: PlanChapter[], weeks: PlanWeek[], currentWeek: number, cfg: GameConfig): { needH: number; haveH: number; gapH: number } {
  const needH = round2(chapters.filter((c) => !c.done && c.tier !== "C").reduce((s, c) => s + c.hoursRemaining, 0));
  const fixedH = (cfg.capacity.fixedDailyMinutes * 7) / 60;
  const haveH = round2(weeks.filter((w) => w.no >= currentWeek && w.no <= 19).reduce((s, w) => s + Math.max(0, w.capacityH * cfg.planner.fillFraction - fixedH), 0));
  return { needH, haveH, gapH: round2(needH - haveH) };
}

export interface CoreSuggestion {
  chapterId: string | null;
  subjectId: string | null;
  standardMin: number;
  seedMin: number;
  stretchMin: number;
  testsStandard: number;
}

/**
 * Today's Core quest: the first plan item of the week with minutes left, sized to today's capacity
 * (minus fixed daily work). A Life Event / zero-capacity day → Seed-only Core.
 */
export function todayCore(weekItems: PlanItem[], doneMinByChapter: Record<string, number>, dayCapacityMin: number, daysLeftInWeek: number, cfg: GameConfig): CoreSuggestion {
  const avail = Math.max(0, dayCapacityMin - cfg.capacity.fixedDailyMinutes);
  const item = weekItems.find((i) => (doneMinByChapter[i.chapterId] ?? 0) < i.plannedMin);
  if (!item) {
    const m = Math.max(15, Math.min(60, avail));
    return { chapterId: null, subjectId: null, standardMin: avail > 0 ? m : 5, seedMin: 5, stretchMin: Math.ceil((avail > 0 ? m : 5) * cfg.quests.stretchFactor), testsStandard: 10 };
  }
  const remainingWeek = weekItems.reduce((s, i) => s + Math.max(0, i.plannedMin - (doneMinByChapter[i.chapterId] ?? 0)), 0);
  const share = Math.ceil(remainingWeek / Math.max(1, daysLeftInWeek));
  const standard = avail <= 0 ? 5 : Math.max(20, Math.min(avail, share));
  const tests = Math.max(5, Math.round((item.testsTarget * standard) / Math.max(1, item.plannedMin)));
  return { chapterId: item.chapterId, subjectId: item.subjectId, standardMin: standard, seedMin: 5, stretchMin: Math.ceil(standard * cfg.quests.stretchFactor), testsStandard: tests };
}
