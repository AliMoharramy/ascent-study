import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, queryOne, queryRows, type Db } from "@/db/client";
import { rewardClaims, rewards, userAchievements } from "@/db/schema";
import { ACHIEVEMENTS, detectAnomalies, evaluateAchievements, type PlayerStats } from "@/domain/achievements";
import { appendEvent } from "@/events/store";
import { activeConfig, xpSummary } from "@/events/projections";
import { newId, nowIso } from "@/lib/ids";

/** Gold, Reward Shop, Achievements, anti-gaming log (T-R2-10 / F-GAME-07/08/12, doc 04 §9, §11). */

export const DEFAULT_REWARDS = [
  { title: "Free walk / run with a podcast", goldCost: 40, moneyCost: 0 },
  { title: "One episode of a series / a film", goldCost: 80, moneyCost: 0 },
  { title: "One hour of gaming", goldCost: 100, moneyCost: 0 },
  { title: "Favourite food (out / delivery)", goldCost: 200, moneyCost: 1 },
  { title: "Guilt-Free Day", goldCost: 400, moneyCost: 0 },
  { title: "A small purchase (book / tool)", goldCost: 500, moneyCost: 1 },
];

export async function ensureRewards(db: Db, userId: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  if ((await tx.select({ id: rewards.id }).from(rewards).where(eq(rewards.userId, userId)).limit(1))[0]) return;
  for (const r of DEFAULT_REWARDS) (await tx.insert(rewards).values({ id: newId(), userId, ...r, enabled: true, createdAt: nowIso() }));
});
}

export const rewardInput = z.object({ title: z.string().trim().min(2).max(120), goldCost: z.coerce.number().min(0).max(100000), moneyCost: z.coerce.number().min(0).max(1e9).default(0), enabled: z.boolean().default(true) });

export async function saveReward(db: Db, userId: string, input: z.input<typeof rewardInput>, id?: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = rewardInput.parse(input);
  if (id) (await tx.update(rewards).set(d).where(and(eq(rewards.id, id), eq(rewards.userId, userId))));
  else (await tx.insert(rewards).values({ id: newId(), userId, ...d, createdAt: nowIso() }));
});
}

export async function shopView(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  (await ensureRewards(tx, userId));
  const cfg = (await activeConfig(tx, userId));
  const month = today.slice(0, 7);
  const spent = (await queryOne<{ v: number | null }>(tx, sql`SELECT sum(money) AS v FROM reward_claims WHERE user_id = ${userId} AND month_key = ${month}`))?.v ?? 0;
  return {
    gold: (await xpSummary(tx, userId, today, cfg)).gold,
    budget: cfg.shop.monthlyMoneyBudget,
    spent,
    rewards: (await tx.select().from(rewards).where(eq(rewards.userId, userId)).orderBy(asc(rewards.goldCost))),
    claims: (await tx.select().from(rewardClaims).where(eq(rewardClaims.userId, userId)).orderBy(desc(rewardClaims.claimedAt)).limit(20)),
    enabled: cfg.flags.shop,
  };
});
}

export class ClaimDenied extends Error {}

export async function claimReward(db: Db, userId: string, rewardId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const v = (await shopView(tx, userId, today));
  const r = v.rewards.find((x) => x.id === rewardId && x.enabled);
  if (!r) throw new ClaimDenied("Unknown or disabled reward");
  if (v.gold < r.goldCost) throw new ClaimDenied(`Not enough Gold (${v.gold} / ${r.goldCost})`);
  if (r.moneyCost > 0 && v.spent + r.moneyCost > v.budget) throw new ClaimDenied(`Over this month's money budget (${v.budget}). Raise it in Settings if you really want this.`);
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.insert(rewardClaims).values({ id: newId(), userId, rewardId, title: r.title, gold: r.goldCost, money: r.moneyCost, monthKey: today.slice(0, 7), claimedAt: nowIso() }));
    (await appendEvent(tx, { userId, type: "reward.claimed", payload: { rewardId, title: r.title, gold: r.goldCost, money: r.moneyCost }, gameDay: today }));
  }));
});
}

// ── stats + achievements ─────────────────────────────────────

export async function playerStats(db: Db, userId: string, today: string): Promise<PlayerStats> {
  const one = async (q: ReturnType<typeof sql>) => Number((await queryOne<{ v: number | null }>(db, q))?.v ?? 0);
  const closes = (await queryRows<{ s: number }>(db, sql`SELECT standard_day AS s FROM day_closes WHERE user_id = ${userId} ORDER BY date`));
  let streak = 0;
  let maxStreak = 0;
  for (const c of closes) maxStreak = Math.max(maxStreak, (streak = c.s ? streak + 1 : 0));
  const wakes = (await queryRows<{ w: string }>(db, sql`SELECT wake_at AS w FROM sleep_logs WHERE user_id = ${userId} ORDER BY date`));
  let dawn = 0;
  let dawnMax = 0;
  for (const w of wakes) dawnMax = Math.max(dawnMax, (dawn = w.w <= "06:30" ? dawn + 1 : 0));
  const duelRows = (await queryRows<{ w: string }>(db, sql`SELECT winner AS w FROM duels WHERE user_id = ${userId} ORDER BY week_no`));
  let ds = 0;
  let dsMax = 0;
  for (const d of duelRows) dsMax = Math.max(dsMax, (ds = d.w === "user" ? ds + 1 : 0));
  return {
    chaptersCleared: (await one(sql`SELECT count(*)::int AS v FROM chapter_state WHERE user_id = ${userId} AND cleared_at IS NOT NULL`)),
    maxStandardStreak: maxStreak,
    comebacks: (await one(sql`SELECT count(*)::int AS v FROM events WHERE user_id = ${userId} AND type = 'comeback.settled'`)),
    errorAnalyses: (await one(sql`SELECT count(*)::int AS v FROM error_items WHERE user_id = ${userId}`)),
    dawnWakeStreak: dawnMax,
    duelWinStreak: dsMax,
    duelWins: duelRows.filter((d) => d.w === "user").length,
    tocPasses: (await one(sql`SELECT count(DISTINCT game_day)::int / 7 AS v FROM test_logs WHERE user_id = ${userId} AND subject_id = 'toc'`)) >= 3 ? 3 : 0,
    testsTotal: (await one(sql`SELECT sum(correct + wrong + blank) AS v FROM test_logs WHERE user_id = ${userId}`)),
    focusHours: Math.floor((await one(sql`SELECT sum(minutes) AS v FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended'`)) / 60),
    level: (await xpSummary(db, userId, today)).level,
    weeklyBossesDefeated: (await one(sql`SELECT count(*)::int AS v FROM bosses WHERE user_id = ${userId} AND kind = 'weekly' AND defeated = true`)),
    regionBossesDefeated: (await one(sql`SELECT count(*)::int AS v FROM bosses WHERE user_id = ${userId} AND kind = 'region' AND defeated = true`)),
    mocksTaken: (await one(sql`SELECT count(*)::int AS v FROM mock_results WHERE user_id = ${userId}`)),
    reviewCards: (await one(sql`SELECT count(*)::int AS v FROM events WHERE user_id = ${userId} AND type = 'review.answered'`)),
    forgeArtifacts: (await one(sql`SELECT count(*)::int AS v FROM forge_artifacts WHERE user_id = ${userId}`)),
    ideasParked: (await one(sql`SELECT count(*)::int AS v FROM ideas WHERE user_id = ${userId}`)),
    nightlyReviews: (await one(sql`SELECT count(*)::int AS v FROM reviews WHERE user_id = ${userId} AND kind = 'nightly'`)),
    weeklyCouncils: (await one(sql`SELECT count(*)::int AS v FROM reviews WHERE user_id = ${userId} AND kind = 'weekly'`)),
    habitsMastered: (await one(sql`SELECT count(*)::int AS v FROM habits WHERE user_id = ${userId} AND status = 'mastered'`)),
    shieldsEarned: (await one(sql`SELECT count(*)::int AS v FROM shields WHERE user_id = ${userId}`)),
    surges: (await one(sql`SELECT count(*)::int AS v FROM focus_sessions WHERE user_id = ${userId} AND surge = true`)),
    bestDayFocusMin: (await one(sql`SELECT max(m) AS v FROM (SELECT sum(minutes) AS m FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' GROUP BY game_day)`)),
    goalDays: (await one(sql`SELECT count(*)::int AS v FROM events WHERE user_id = ${userId} AND type = 'goal.completed'`)),
  };
}

/** Evaluates rules and records new unlocks (idempotent). */
export async function checkAchievements(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const have = new Set((await tx.select({ k: userAchievements.key }).from(userAchievements).where(eq(userAchievements.userId, userId))).map((r) => r.k));
  const stats = (await playerStats(tx, userId, today));
  const fresh = evaluateAchievements(stats, have);
  for (const k of fresh) {
    (await tx.insert(userAchievements).values({ userId, key: k, unlockedAt: nowIso() }).onConflictDoNothing());
    (await appendEvent(tx, { userId, type: "achievement.unlocked", payload: { key: k }, gameDay: today }));
  }
  return { stats, fresh, unlocked: (await tx.select().from(userAchievements).where(eq(userAchievements.userId, userId))) };
});
}

export async function achievementsView(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const r = (await checkAchievements(tx, userId, today));
  const at = new Map(r.unlocked.map((u) => [u.key, u.unlockedAt]));
  return ACHIEVEMENTS.map((a) => ({ key: a.key, name: a.name, description: a.description, tier: a.tier, icon: a.icon, unlockedAt: at.get(a.key) ?? null, progress: a.progress(r.stats) }));
});
}

/** Anti-gaming log: per-day anomaly warnings (never penalties — Honesty Pact). */
export async function anomalyLog(db: Db, userId: string) {
  const cfg = (await activeConfig(db, userId));
  const days = (await queryRows<{ day: string; tests: number; correct: number; focusMin: number; manualItems: number; totalItems: number }>(db, sql`
    SELECT d.day AS day,
      coalesce((SELECT sum(correct + wrong + blank) FROM test_logs t WHERE t.user_id = ${userId} AND t.game_day = d.day), 0) AS tests,
      coalesce((SELECT sum(correct) FROM test_logs t WHERE t.user_id = ${userId} AND t.game_day = d.day), 0) AS correct,
      coalesce((SELECT sum(minutes) FROM focus_sessions f WHERE f.user_id = ${userId} AND f.game_day = d.day AND f.status = 'ended'), 0) AS focusMin,
      (SELECT count(*)::int FROM focus_sessions f WHERE f.user_id = ${userId} AND f.game_day = d.day AND f.manual = true) + (SELECT count(*)::int FROM test_logs t WHERE t.user_id = ${userId} AND t.game_day = d.day AND t.manual = true) AS manualItems,
      (SELECT count(*)::int FROM focus_sessions f WHERE f.user_id = ${userId} AND f.game_day = d.day) + (SELECT count(*)::int FROM test_logs t WHERE t.user_id = ${userId} AND t.game_day = d.day) AS totalItems
    FROM (SELECT DISTINCT game_day AS day FROM focus_sessions WHERE user_id = ${userId} UNION SELECT DISTINCT game_day FROM test_logs WHERE user_id = ${userId}) d
    ORDER BY d.day DESC LIMIT 60`));
  return detectAnomalies(days, cfg);
}
