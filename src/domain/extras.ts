import type { GameConfig } from "@/config/schema";

/** Skill tree, Gems, Season Pass, challenge cards, Boss Rush and avatar catalog (issues #87, #91). */

export const SKILLS = [
  { id: "focus", name: "Focus", tiers: ["Deep Start", "Long Surge", "Iron Attention"], perk: "+10 min Surge window per tier" },
  { id: "review", name: "Review", tiers: ["Card Keeper", "Spaced Mind", "Memory Palace"], perk: "+5 review-card XP cap per tier" },
  { id: "speed", name: "Speed", tiers: ["Quick Read", "Fast Filter", "Exam Tempo"], perk: "−10 s/question target per tier" },
  { id: "accuracy", name: "Accuracy", tiers: ["Careful Hand", "Double Check", "Zero Slip"], perk: "+1 Gold per perfect run per tier" },
] as const;
export type SkillId = (typeof SKILLS)[number]["id"];

export function skillTier(unlocks: { skillId: string; tier: number }[], id: SkillId): number {
  return unlocks.find((u) => u.skillId === id)?.tier ?? 0;
}

/** Real, small perks folded into the active config so every engine respects them. */
export function applySkillPerks(cfg: GameConfig, unlocks: { skillId: string; tier: number }[]): GameConfig {
  const f = skillTier(unlocks, "focus");
  const r = skillTier(unlocks, "review");
  return { ...cfg, xp: { ...cfg.xp, surgeMaxMinutes: cfg.xp.surgeMaxMinutes + 10 * f, reviewDailyCap: cfg.xp.reviewDailyCap + 5 * r } };
}

export const BASE_SEC_PER_QUESTION = 90;
export const secTarget = (unlocks: { skillId: string; tier: number }[]) => BASE_SEC_PER_QUESTION - 10 * skillTier(unlocks, "speed");

export interface SeasonStop {
  week: number;
  title: string;
  gold: number;
  gems: number;
  needStandardDays: number;
}
/** Free 25-week reward track (F-GM-03). No real money anywhere; claim only after the week ends. */
export const SEASON_TRACK: SeasonStop[] = Array.from({ length: 25 }, (_, i) => {
  const week = i + 1;
  const big = week % 5 === 0;
  return { week, title: big ? `Realm ${week / 5} chest` : `Week ${week} supply`, gold: big ? 60 : 15, gems: big ? 10 : 2, needStandardDays: big ? 4 : 3 };
});

export const CARD_POOL = [
  { id: "reviews3", text: "Finish 3 review rounds this week", metric: "rounds", target: 3, gold: 20, gems: 3 },
  { id: "inter2", text: "Log 2 interleaved test sessions", metric: "interleaved", target: 2, gold: 20, gems: 3 },
  { id: "focus300", text: "Reach 300 focus minutes", metric: "focus", target: 300, gold: 25, gems: 3 },
  { id: "bond1", text: "Send one real message to a Bond", metric: "bonds", target: 1, gold: 15, gems: 2 },
  { id: "read50", text: "Read 50 pages at bedtime", metric: "pages", target: 50, gold: 15, gems: 2 },
  { id: "err5", text: "Analyze 5 mistakes with a takeaway", metric: "errors", target: 5, gold: 20, gems: 3 },
  { id: "habit5", text: "Keep any habit 5 days", metric: "habit", target: 5, gold: 15, gems: 2 },
  { id: "tests60", text: "Answer 60 tests with ≥ 50 % net", metric: "tests", target: 60, gold: 25, gems: 3 },
] as const;
export type CardMetric = (typeof CARD_POOL)[number]["metric"];

/** Deterministic weekly draw — same user + week always gets the same card. */
export function drawCard(userId: string, weekNo: number): (typeof CARD_POOL)[number] {
  let h = 2166136261;
  const s = `${userId}:${weekNo}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return CARD_POOL[Math.abs(h) % CARD_POOL.length]!;
}

export const RUSH_WEEK = 25;
export const rushAvailable = (weekNo: number, daysToExam: number, enabled: boolean) => enabled && (weekNo >= RUSH_WEEK || daysToExam <= 7);

export const AVATAR_COLORS = ["amber", "mint", "coral", "violet", "sky", "rose"] as const;
export const AVATAR_OUTFITS = [
  { id: "cloak", name: "Ascender cloak", cost: 15 },
  { id: "armor", name: "Summit armor", cost: 25 },
  { id: "hoodie", name: "Scholar hoodie", cost: 10 },
  { id: "scarf", name: "Night scarf", cost: 10 },
] as const;
export const AVATAR_TOOLS = [
  { id: "staff", name: "Focus staff", cost: 10 },
  { id: "lantern", name: "Fog lantern", cost: 15 },
  { id: "book", name: "Codex book", cost: 10 },
  { id: "compass", name: "Path compass", cost: 20 },
] as const;
export type Avatar = { color: (typeof AVATAR_COLORS)[number]; outfit: string | null; tool: string | null; owned: string[] };
export const DEFAULT_AVATAR: Avatar = { color: "amber", outfit: null, tool: null, owned: [] };
