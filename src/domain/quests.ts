import type { GameConfig } from "@/config/schema";
import { comebackRefund, dayPenalties, type Miss, type ScoreEntry } from "./score";
import { round2 } from "./xp";

/**
 * Quest engine (doc 04 §5-6, T-R1-06). Pure functions: build the day's ≤ 5 quests, decide which tier was
 * reached, close a day (penalties with floors, Shield / Life Event, gold, flame), Comeback and Shields.
 * Unfinished work is never carried over as debt — the planner simply regenerates tomorrow (doc 04 §6.4).
 */

export type QuestKind = "core" | "fixed" | "pillar" | "side" | "comeback" | "bonus";
export type QuestTier = "seed" | "standard" | "stretch";
export type QuestStatus = "open" | "done" | "missed" | "forgiven";
export type QuestMetric = "minutes" | "tests" | "count" | "check";

export const TIER_ORDER: QuestTier[] = ["seed", "standard", "stretch"];

export interface QuestTarget {
  metric: QuestMetric;
  seed: number;
  standard: number;
  stretch: number;
}

export interface QuestSpec {
  kind: QuestKind;
  title: string;
  /** Anchor / time ("after breakfast") — doc 04 §5.3 */
  when?: string | null;
  /** Exact action per tier */
  tiers: Record<QuestTier, string>;
  target: QuestTarget;
  refType?: "chapter" | "subject" | "habit" | null;
  refId?: string | null;
  habitId?: string | null;
  /** XP of the full (Standard) quest, for Seed = 25 % (pillars only; study quests earn activity XP) */
  xp?: number;
}

/** Highest tier whose threshold `value` reaches (null if not even Seed). */
export function tierReached(target: QuestTarget, value: number): QuestTier | null {
  if (target.metric === "check") return value > 0 ? "standard" : null;
  let best: QuestTier | null = null;
  for (const t of TIER_ORDER) if (value + 1e-9 >= target[t]) best = t;
  return best;
}

export function tierRank(t: QuestTier | null | undefined): number {
  return t ? TIER_ORDER.indexOf(t) + 1 : 0;
}

/** Makes a three-tier target from a Standard amount (Seed fixed small, Stretch ≈ +25 %). */
export function threeTier(metric: QuestMetric, standard: number, seed: number, cfg: GameConfig): QuestTarget {
  const stretch = metric === "check" ? standard : Math.ceil(standard * cfg.quests.stretchFactor);
  return { metric, seed: Math.min(seed, standard), standard, stretch };
}

const KIND_PRIORITY: Record<QuestKind, number> = { core: 0, comeback: 1, fixed: 2, pillar: 3, bonus: 4, side: 5 };

/**
 * The day's active quests: Core + Comeback + 2 Fixed + pillars, capped at `quests.maxPerDay` (doc 04 §5.4).
 * The rest stay "waiting" (returned separately) to keep cognitive load low.
 */
export function selectDailyQuests(candidates: QuestSpec[], cfg: GameConfig): { active: QuestSpec[]; waiting: QuestSpec[] } {
  const sorted = [...candidates].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
  const max = cfg.quests.maxPerDay;
  return { active: sorted.slice(0, max), waiting: sorted.slice(max) };
}

// ── closing a day ────────────────────────────────────────────

export interface QuestOutcome {
  id?: string;
  kind: QuestKind;
  title: string;
  tierDone: QuestTier | null;
}

export interface DayCloseInput {
  quests: QuestOutcome[];
  weekPenaltiesSoFar: number;
  shieldUsed?: boolean;
  lifeEvent?: boolean;
  /** Scheduled Rest Day Pass: forgiven, no penalties, flame untouched (F-DUO-02). */
  restDay?: boolean;
  weekReset?: boolean;
  /** Baseline week / rules not yet active → never penalise (doc 05 §4.1). */
  rulesActive?: boolean;
}

export interface DayCloseResult {
  coreTier: QuestTier | null;
  misses: Miss[];
  penalties: ScoreEntry[];
  penaltyTotal: number;
  gold: { amount: number; reason: string }[];
  /** Core ≥ Standard (flame / shields / loot) */
  standardDay: boolean;
  /** Core ≥ Seed (consistency) */
  seedDay: boolean;
  /** Core missed entirely (not forgiven) → Comeback tomorrow */
  missedCore: boolean;
}

const MISS_KIND: Partial<Record<QuestKind, Miss["kind"]>> = { core: "core", fixed: "fixed", pillar: "pillar", comeback: "core" };

export function closeDay(input: DayCloseInput, cfg: GameConfig): DayCloseResult {
  const core = input.quests.find((q) => q.kind === "core");
  const coreTier = core?.tierDone ?? null;
  // A Seed counts as done: "روز از دست‌رفته حساب نمی‌شود" (doc 04 §5.2). Comeback quests are not penalised twice.
  const misses: Miss[] = input.quests
    .filter((q) => q.tierDone === null && MISS_KIND[q.kind] && q.kind !== "comeback")
    .map((q) => ({ kind: MISS_KIND[q.kind]!, title: q.title }));
  const forgiven = !!input.shieldUsed || !!input.lifeEvent || !!input.restDay;
  const penalties =
    input.restDay
      ? []
      : input.rulesActive === false
        ? misses.length
          ? [{ amount: 0, ruleKey: "ss.baseline", reason: `Baseline week: ${misses.length} miss(es) observed, no penalty`, capApplied: false }]
          : []
        : dayPenalties(misses, { weekPenaltiesSoFar: input.weekPenaltiesSoFar, shieldUsed: input.shieldUsed, lifeEvent: input.lifeEvent, weekReset: input.weekReset }, cfg);
  const penaltyTotal = round2(penalties.reduce((s, p) => s + p.amount, 0));
  const standardDay = tierRank(coreTier) >= tierRank("standard");
  const gold: DayCloseResult["gold"] = [];
  if (standardDay) gold.push({ amount: cfg.gold.standardDay, reason: "Core ≥ Standard" });
  if (coreTier === "stretch") gold.push({ amount: cfg.gold.stretchBonus, reason: "Stretch" });
  return {
    coreTier,
    misses,
    penalties,
    penaltyTotal,
    gold,
    standardDay,
    seedDay: coreTier !== null,
    missedCore: !!core && coreTier === null && !forgiven,
  };
}

// ── streaks, shields, consistency ────────────────────────────

export interface StreakState {
  flame: number; // consecutive Standard days (cosmetic)
  shieldProgress: number; // Standard days toward the next Shield
  shields: number;
}

export const emptyStreak = (): StreakState => ({ flame: 0, shieldProgress: 0, shields: 0 });

/** After a closed day: flame, Shield earning (1 per N Standard days in a row, cap `shields.max`). */
export function advanceStreak(s: StreakState, day: { standardDay: boolean; shieldUsed?: boolean; restDay?: boolean }, cfg: GameConfig): { state: StreakState; shieldEarned: boolean } {
  if (day.shieldUsed || day.restDay) return { state: { ...s }, shieldEarned: false }; // keeps the flame alive without progress
  if (!day.standardDay) return { state: { flame: 0, shieldProgress: 0, shields: s.shields }, shieldEarned: false };
  const progress = s.shieldProgress + 1;
  if (progress >= cfg.shields.streakDaysPerShield) {
    const earned = s.shields < cfg.shields.max;
    return { state: { flame: s.flame + 1, shieldProgress: 0, shields: Math.min(cfg.shields.max, s.shields + 1) }, shieldEarned: earned };
  }
  return { state: { flame: s.flame + 1, shieldProgress: progress, shields: s.shields }, shieldEarned: false };
}

/** A Shield may only be spent on a day that ended ≤ `useWithinHours` ago. */
export function canUseShield(dayEnd: Date, now: Date, shields: number, cfg: GameConfig): { ok: boolean; reason?: string } {
  if (shields <= 0) return { ok: false, reason: "No Shield available" };
  const hours = (now.getTime() - dayEnd.getTime()) / 3_600_000;
  if (hours < 0) return { ok: true };
  if (hours > cfg.shields.useWithinHours) return { ok: false, reason: `Shields must be used within ${cfg.shields.useWithinHours}h of the day ending` };
  return { ok: true };
}

/** Consistency rate = share of days with Core ≥ Seed in the window (the real metric, not the streak). */
export function consistencyRate(coreTiers: (QuestTier | null)[]): number {
  if (coreTiers.length === 0) return 0;
  return coreTiers.filter((t) => t !== null).length / coreTiers.length;
}

// ── Life Events ──────────────────────────────────────────────

export function lifeEventAllowed(countThisWeek: number, countThisMonth: number, cfg: GameConfig): { ok: boolean; reflect: boolean; reason?: string } {
  if (countThisWeek >= cfg.lifeEvents.perWeekMax) return { ok: false, reflect: false, reason: `At most ${cfg.lifeEvents.perWeekMax} Life Events per week` };
  return { ok: true, reflect: countThisMonth + 1 > cfg.lifeEvents.reflectAfterPerMonth };
}

// ── Comeback ─────────────────────────────────────────────────

/** Never Miss Twice: after a missed Core, tomorrow gets a small Comeback quest (Seed + 15 min). */
export function comebackQuest(missedTitle: string | null, cfg: GameConfig): QuestSpec {
  return {
    kind: "comeback",
    title: "Comeback",
    when: "first thing after your first anchor",
    tiers: { seed: "Open the book: 3 tests", standard: "15 focused minutes + 3 tests", stretch: "25 focused minutes + 5 tests" },
    target: threeTier("minutes", 15, 3, cfg),
    refType: null,
    refId: null,
    xp: 0,
    ...(missedTitle ? { title: `Comeback — ${missedTitle}`.slice(0, 120) } : {}),
  };
}

/** Completing the Comeback refunds 50 % of the missed day's penalty (doc 04 §6.4). */
export function comebackSettlement(missedDayPenaltyTotal: number, comebackTier: QuestTier | null, cfg: GameConfig): ScoreEntry | null {
  if (!comebackTier || missedDayPenaltyTotal >= 0) return null;
  return comebackRefund(missedDayPenaltyTotal, cfg);
}

// ── Loot (doc 04 §9.5) ───────────────────────────────────────

export type LootResult = "none" | "codex" | "cosmetic" | "shield";

/** Weighted roll with a pity timer: after `pity` empty rolls in a row, the next is guaranteed (never "none"). */
export function rollLoot(rand: number, pityCounter: number, cfg: GameConfig): { result: LootResult; pity: number } {
  const w = cfg.loot;
  const table: [LootResult, number][] = [
    ["none", pityCounter + 1 >= w.pity ? 0 : w.none],
    ["codex", w.codex],
    ["cosmetic", w.cosmetic],
    ["shield", w.shield],
  ];
  const total = table.reduce((s, [, p]) => s + p, 0) || 1;
  let x = Math.max(0, Math.min(0.999999, rand)) * total;
  for (const [r, p] of table) {
    if (x < p) return { result: r, pity: r === "none" ? pityCounter + 1 : 0 };
    x -= p;
  }
  return { result: "codex", pity: 0 };
}
