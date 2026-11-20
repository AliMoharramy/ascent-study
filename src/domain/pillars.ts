import { weekPhase } from "./planner";

/**
 * Life-pillar rules (doc 05 §7-11, doc 04 §9.4-9.5, doc 11 §4.1/4.3/4.6).
 * Pure functions so the caps, gates and seeded ghosts can be tested without a database.
 */

// ── habit contracts (doc 05 §11) ────────────────────────────
/** A contract is a capped cost, never an open-ended debt. */
export const CONTRACT_DAILY_CAP = -8;
export const CONTRACT_WEEKLY_CAP = -12;

export function contractAmount(contractSs: number): number {
  return contractSs < 0 ? Math.max(CONTRACT_DAILY_CAP, contractSs) : 0;
}

/** Apply the weekly cap on top of the settlements already recorded this week. */
export function capWeeklyContract(weekSoFar: number, todayAmounts: number[]): number[] {
  let room = Math.min(0, CONTRACT_WEEKLY_CAP - weekSoFar);
  return todayAmounts.map((a) => {
    const taken = Math.max(a, room);
    room -= taken;
    return taken;
  });
}

/** Same scheduling rule as pillar quests: daysPerWeek mapped evenly across the Saturday week. */
export function habitScheduled(daysPerWeek: number, weekdaySat: number): boolean {
  if (daysPerWeek >= 7) return true;
  return Math.floor((weekdaySat * daysPerWeek) / 7) !== Math.floor(((weekdaySat + 1) * daysPerWeek) / 7);
}

// ── exploration slot (doc 05 §7) ─────────────────────────────
export const EXPLORATION_WEEKLY_TARGET = 3;
export const EXPLORATION_SESSION_CAP_MIN = 30;
export const EXPLORATION_REVIEW_MIN = 5;
export const EXPLORATION_SHARE = 0.1;
export const EXPLORATION_ARCHIVE_REVIEW_DAYS = 28;

export function explorationSuspended(weekNo: number): { suspended: boolean; phase: string } {
  const phase = weekPhase(weekNo);
  return { suspended: ["trials", "arena", "final"].includes(phase.key), phase: phase.label };
}

export function explorationBudget(studyMinutes: number, explorationMinutes: number, forgeMinutes: number) {
  const capMinutes = Math.floor(Math.max(0, studyMinutes) * EXPLORATION_SHARE);
  const usedMinutes = Math.max(0, explorationMinutes) + Math.max(0, forgeMinutes);
  return { capMinutes, usedMinutes, remainingMinutes: Math.max(0, capMinutes - usedMinutes), over: usedMinutes > capMinutes, sharePct: studyMinutes > 0 ? Math.round((usedMinutes / studyMinutes) * 1000) / 10 : 0 };
}

// ── Builder Hour (doc 04 §9.4) ───────────────────────────────
export const BUILDER_BASE_MIN = 60;
export const BUILDER_BONUS_MIN = 60;
export const BUILDER_OVERRUN_GRACE_MIN = 15;

export function builderEligibility(consistency: number, coreDays: number, minConsistency: number, minCoreDays: number) {
  return { eligible: consistency >= minConsistency && coreDays >= minCoreDays, consistency, coreDays };
}

/** 1 h base + 1 h per boss + 1 h per duel, capped at the config's weekly ceiling. */
export function builderWeekCredit(eligible: boolean, bossesDefeated: number, duelsWon: number, weeklyCapMinutes: number) {
  if (!eligible) return 0;
  return Math.min(weeklyCapMinutes, BUILDER_BASE_MIN + Math.max(0, bossesDefeated) * BUILDER_BONUS_MIN + Math.max(0, duelsWon) * BUILDER_BONUS_MIN);
}

export function builderBalance(entries: { minutes: number }[], bankCapMinutes: number) {
  const raw = entries.reduce((s, e) => s + e.minutes, 0);
  return { raw, balance: Math.max(-bankCapMinutes, Math.min(bankCapMinutes, raw)) };
}

// ── seeded Ghost League (doc 11 §4.1) ────────────────────────
export const LEAGUE_TIERS = ["Bronze", "Silver", "Gold", "Sapphire", "Ruby", "Emerald", "Amethyst", "Pearl", "Obsidian", "Diamond"] as const;
export const LEAGUE_SIZE = 10;
export const LEAGUE_PROMOTE = 3;
export const LEAGUE_DEMOTE = 2;
export const GHOST_NAMES = ["Aria", "Kian", "Nova", "Rumi", "Sana", "Dara", "Mira", "Taha", "Lina"] as const;

/** FNV-1a → mulberry32: deterministic across replays and devices. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number) {
  const u = Math.max(1e-9, rand());
  const v = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface Ghost {
  name: string;
  xp: number;
  ghost: true;
}

/**
 * Nine ghosts around `baseline`. z-scores are centred on the sample median so the league median
 * equals the user's recent performance; σ stays 0.25. Same seed → same field every time.
 */
export function ghostField(baselineXp: number, seed: string, sigma = 0.25): Ghost[] {
  const rand = rng(seed);
  const base = Math.max(0, baselineXp);
  const z = Array.from({ length: LEAGUE_SIZE - 1 }, () => gauss(rand));
  const sorted = [...z].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return GHOST_NAMES.map((name, i) => ({ name, ghost: true as const, xp: Math.max(0, Math.round(base * (1 + (z[i]! - median) * sigma))) }));
}

export function leagueBaseline(weeklyStudyXp: number[]): number {
  const recent = weeklyStudyXp.filter((x) => x > 0).slice(-4);
  if (!recent.length) return 200;
  const s = [...recent].sort((a, b) => a - b);
  const m = s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  return Math.max(50, Math.round(m));
}

export type LeagueOutcome = "promoted" | "demoted" | "stayed";

export function leagueOutcome(rank: number, tier: number): LeagueOutcome {
  if (rank <= LEAGUE_PROMOTE && tier < LEAGUE_TIERS.length) return "promoted";
  if (rank > LEAGUE_SIZE - LEAGUE_DEMOTE && tier > 1) return "demoted";
  return "stayed";
}

// ── Streak Society + special map nodes (doc 11 §4.6) ─────────
export const STREAK_MILESTONES = [7, 30, 60, 100] as const;

export const STREAK_STORIES: Record<(typeof STREAK_MILESTONES)[number], string> = {
  7: "Seven suns. A week of Standard days is no longer an accident — it is a rhythm.",
  30: "The month turns. Thirty Standard days and the fog no longer owns your mornings.",
  60: "Two months of showing up. The Summit is still far, but the path is worn by your own feet.",
  100: "One hundred days. The Ascender does not chase motivation any more; the ritual carries them.",
};

export function streakSociety(maxStreak: number, consistency30: number) {
  return STREAK_MILESTONES.map((days) => ({ days, reached: maxStreak >= days && consistency30 >= 0.8, story: STREAK_STORIES[days], progress: Math.min(days, maxStreak) / days, consistency: consistency30 }));
}

/** Longest run of `true` values — the medal streak, which never resets to zero just because today is bad. */
export function maxStandardRun(days: boolean[]): number {
  let run = 0;
  let max = 0;
  for (const d of days) max = Math.max(max, (run = d ? run + 1 : 0));
  return max;
}

export type SpecialNode = "checkpoint" | "legendary" | null;

/** Legendary nodes are the third review round or a hard (region/final) boss. */
export function specialNode(no: number, round3Done: boolean, hardBossDefeated: boolean): SpecialNode {
  if (round3Done || hardBossDefeated) return "legendary";
  if (no % 5 === 0) return "checkpoint";
  return null;
}

// ── Monthly Challenge (doc 11 §4.4) ──────────────────────────
export interface MonthlyTheme {
  key: "fire" | "errors" | "shadows" | "builder";
  name: string;
  target: number;
  unit: string;
  story: string;
}

const THEMES: MonthlyTheme[] = [
  { key: "fire", name: "Month of Fire", target: 20, unit: "Standard days", story: "Twenty Standard days. Keep the flame fed, one Core at a time." },
  { key: "errors", name: "Month of Errors", target: 200, unit: "error analyses", story: "Two hundred wrong answers turned into lessons. Errors are the map." },
  { key: "shadows", name: "Month of Shadows", target: 3, unit: "duels won", story: "Three duels inside one month. The Shadow learns your pace." },
  { key: "builder", name: "Month of Making", target: 240, unit: "Builder minutes", story: "Four hours of building. The Vault was never the destination — the work is." },
];

export function monthlyTheme(monthKey: string): MonthlyTheme {
  const m = Number(monthKey.slice(5, 7)) || 1;
  const y = Number(monthKey.slice(0, 4)) || 2026;
  return THEMES[(y * 12 + m) % THEMES.length]!;
}

export interface MonthlyMetrics {
  standardDays: number;
  errorAnalyses: number;
  duelsWon: number;
  builderMinutes: number;
}

export function monthlyProgress(theme: MonthlyTheme, m: MonthlyMetrics) {
  const value = theme.key === "fire" ? m.standardDays : theme.key === "errors" ? m.errorAnalyses : theme.key === "shadows" ? m.duelsWon : m.builderMinutes;
  return { value, target: theme.target, done: value >= theme.target, pct: Math.min(1, value / Math.max(1, theme.target)) };
}

// ── Quest Board (doc 11 §4.4 / issue #84) ────────────────────
export type BoardMetric = "tests" | "errors" | "cards" | "core" | "pages" | "bonds" | "body";

export interface BoardMission {
  key: string;
  title: string;
  metric: BoardMetric;
  target: number;
  gold: number;
}

const BOARD_POOL: BoardMission[] = [
  { key: "tests10", title: "Warm-up: 10 tests", metric: "tests", target: 10, gold: 5 },
  { key: "error1", title: "One honest error analysis", metric: "errors", target: 1, gold: 5 },
  { key: "cards10", title: "Ten review cards", metric: "cards", target: 10, gold: 5 },
  { key: "core1", title: "Core at Standard", metric: "core", target: 1, gold: 8 },
  { key: "pages10", title: "Read 10 pages before bed", metric: "pages", target: 10, gold: 5 },
  { key: "bond1", title: "One real message to a bond", metric: "bonds", target: 1, gold: 5 },
  { key: "body1", title: "One body habit logged", metric: "body", target: 1, gold: 5 },
];

/** Three missions rotate deterministically by game day; the board never asks more than it gives. */
export function boardMissions(day: string): BoardMission[] {
  let h = 0;
  for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) >>> 0;
  const start = h % BOARD_POOL.length;
  return [0, 1, 2].map((i) => BOARD_POOL[(start + i * 3) % BOARD_POOL.length]!);
}

export function boardProgress(missions: BoardMission[], metrics: Record<BoardMetric, number>) {
  const items = missions.map((m) => {
    const value = metrics[m.metric] ?? 0;
    return { ...m, value, done: value >= m.target, pct: Math.min(1, value / Math.max(1, m.target)) };
  });
  return { items, allDone: items.every((i) => i.done), gold: items.reduce((s, i) => s + i.gold, 0) };
}

// ── Spark Log pattern (doc 05 §10.1 / issue #81) ─────────────
const STOP = new Set(["the", "and", "was", "were", "with", "that", "this", "have", "from", "today", "good", "very", "really", "just", "but", "for", "not", "you", "your", "هم", "و", "که", "این", "آن", "بود", "شد", "با", "برای", "از", "به", "یک", "را", "می", "هم", "خیلی", "امروز", "خوب"]);

export function sparkPattern(sparks: { day: string; text: string }[], minDays = 14) {
  const filled = sparks.filter((s) => s.text.trim().length > 0);
  if (filled.length < minDays) return { ready: false, days: filled.length, needed: minDays, topWords: [] as { word: string; count: number }[], note: "" };
  const freq = new Map<string, number>();
  for (const s of filled)
    for (const raw of s.text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      const w = raw.trim();
      if (w.length < 3 || STOP.has(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  const topWords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([word, count]) => ({ word, count }));
  const note = topWords.length ? `Your sparks keep returning to “${topWords.map((w) => w.word).join("”, “")}”. Put one of them in tomorrow's environment.` : "Enough sparks to see a pattern — keep writing one line a night.";
  return { ready: true, days: filled.length, needed: minDays, topWords, note };
}
