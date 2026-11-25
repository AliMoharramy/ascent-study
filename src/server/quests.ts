import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { withUserTransaction, queryOne, type Db } from "@/db/client";
import { chapters, contractSettlements, dayCloses, events, habitLogs, habits, lifeEvents, lootRolls, quests, shields, subjects, users } from "@/db/schema";
import { capWeeklyContract, contractAmount, habitScheduled } from "@/domain/pillars";
import type { GameConfig } from "@/config/schema";
import { advanceStreak, closeDay as closeDayDomain, comebackQuest, comebackSettlement, emptyStreak, lifeEventAllowed, rollLoot, selectDailyQuests, threeTier, tierRank, tierReached, type QuestSpec, type QuestTarget, type QuestTier } from "@/domain/quests";
import { todayCore } from "@/domain/planner";
import { appendEvent, replayOf } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { addDaysIso, diffDaysIso, weekStartSaturday } from "@/i18n/jalali";
import { PROJECT_START, weekNoOf, WEEK1_START } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";
import { gameDay, gameDayBounds } from "@/lib/time";
import { getKv } from "./kv";
import { ensurePlan, todayCapacityMinutes, weekFocusByChapter, weekIsReset, weekItemsFor, weekdaySat } from "./plan";
import { ACTIVE, seedDefaultHabits } from "./habits";
import { isRestDay } from "./restDays";

/**
 * Quest service (T-R1-06 / T-R1-09): daily generation (Core from the Planner, Comeback, Fixed, Pillars; ≤ 5),
 * live progress, day close (penalties with floors, Shield, Life Event, gold, flame/shields, loot, comeback)
 * and the nightly rollover. Debt never carries over: tomorrow is generated fresh from the plan.
 */

export type QuestRow = typeof quests.$inferSelect;

export class QuestActionDenied extends Error {}

export const baselineConfirmed = async (db: Db, userId: string) => (await getKv<{ on: string } | null>(db, userId, "baseline.confirmed", null));
/** Rules (penalties, Rival) are active only after the Baseline is confirmed and week 1 is over (doc 05 §4.1). */
export const rulesActive = async (db: Db, userId: string, day: string) => !!(await baselineConfirmed(db, userId)) && weekNoOf(day) > 1;

const subjName = async (db: Db, id: string | null) => (id ? (await db.select({ fa: subjects.nameFa, en: subjects.nameEn }).from(subjects).where(eq(subjects.id, id)).limit(1))[0] : undefined);

export async function isLifeEvent(db: Db, userId: string, day: string) {
  return !!(await db.select({ id: lifeEvents.id }).from(lifeEvents).where(and(eq(lifeEvents.userId, userId), eq(lifeEvents.date, day))).limit(1))[0];
}

async function coreSpec(db: Db, userId: string, day: string, cfg: GameConfig): Promise<QuestSpec> {
  return await withUserTransaction(db, userId, async (tx) => {
  const week = weekNoOf(day);
  const life = (await isLifeEvent(tx, userId, day));
  if (week === 1 || day < WEEK1_START) {
    return { kind: "core", title: "Baseline: study as you are, log everything", when: "your usual study time", tiers: { seed: "Start the timer for 2 minutes", standard: "Study block with the timer (any subject)", stretch: "+ 15 scouting tests" }, target: threeTier("minutes", 45, 2, cfg), refType: null, refId: null };
  }
  (await ensurePlan(tx, userId, day, cfg));
  const items = (await weekItemsFor(tx, userId, week)).map((i) => ({ week: i.weekNo, chapterId: i.chapterId, subjectId: i.subjectId, tier: i.tier, plannedMin: i.plannedMin, testsTarget: i.testsTarget }));
  const done = (await weekFocusByChapter(tx, userId, week, items.map((i) => i.chapterId)));
  const cap = (await todayCapacityMinutes(tx, userId, day, cfg, life));
  const daysLeft = 7 - weekdaySat(day);
  const c = todayCore(items, done, cap, daysLeft, cfg);
  const ch = c.chapterId ? (await tx.select({ no: chapters.no, title: chapters.title }).from(chapters).where(eq(chapters.id, c.chapterId)).limit(1))[0] : undefined;
  const s = (await subjName(tx, c.subjectId));
  const title = ch && s ? `${s.en} · Ch.${ch.no} — ${ch.title}` : "Review & tests of this week's chapters";
  const target: QuestTarget = life ? { metric: "minutes", seed: 5, standard: 5, stretch: 15 } : { metric: "minutes", seed: c.seedMin, standard: c.standardMin, stretch: c.stretchMin };
  return {
    kind: "core",
    title,
    when: "your best block today",
    tiers: { seed: `${c.seedMin} min: open it and do the first part`, standard: `${target.standard} focused min + ~${c.testsStandard} tests`, stretch: `${target.stretch} min + ${Math.ceil(c.testsStandard * 1.5)} tests` },
    target,
    refType: c.chapterId ? "chapter" : null,
    refId: c.chapterId,
  };
});
}

function fixedSpecs(cfg: GameConfig): QuestSpec[] {
  return [
    { kind: "fixed", title: "Foundations: 10 tests", when: "after breakfast", tiers: { seed: "3 tests", standard: "10 tests", stretch: "13 tests" }, target: threeTier("tests", 10, 3, cfg), refType: "subject", refId: "foundations" },
    { kind: "fixed", title: "English: 20 minutes", when: "after lunch", tiers: { seed: "5 min vocabulary", standard: "20 min", stretch: "25 min" }, target: threeTier("minutes", 20, 5, cfg), refType: "subject", refId: "english" },
  ];
}

async function pillarSpecs(db: Db, userId: string, day: string, cfg: GameConfig): Promise<QuestSpec[]> {
  const wd = weekdaySat(day);
  return (await db
    .select()
    .from(habits)
    .where(and(eq(habits.userId, userId)))
    .orderBy(asc(habits.sort)))
    .filter((h) => ACTIVE.includes(h.status) && h.pillar !== "mind")
    .filter((h) => h.daysPerWeek >= 7 || Math.floor((wd * h.daysPerWeek) / 7) !== Math.floor(((wd + 1) * h.daysPerWeek) / 7))
    .map((h) => {
      const t = JSON.parse(h.tiersJson) as Record<QuestTier, string>;
      // tiers map to 1/2/3 so the logged habit tier is the quest tier (XP comes from habit.logged)
      return { kind: "pillar" as const, title: h.title, when: h.anchor || h.timeWindow, tiers: { seed: t.seed, standard: t.standard, stretch: t.stretch || t.standard }, target: { metric: "count" as const, seed: 1, standard: 2, stretch: cfg.quests.stretchFactor > 1 ? 3 : 2 }, refType: "habit" as const, refId: h.id, habitId: h.id, xp: 0 };
    });
}

export async function questsForDay(db: Db, userId: string, day: string): Promise<QuestRow[]> {
  return (await db.select().from(quests).where(and(eq(quests.userId, userId), eq(quests.date, day))).orderBy(asc(quests.sort)));
}

/** Generates the day's quests once (idempotent). */
export async function generateDay(db: Db, userId: string, day: string, cfg?: GameConfig): Promise<QuestRow[]> {
  return await withUserTransaction(db, userId, async (tx) => {
  cfg ??= await activeConfig(tx, userId);
  const existing = (await questsForDay(tx, userId, day));
  if (existing.length) return existing;
  (await seedDefaultHabits(tx, userId, day));
  const prev = (await tx.select().from(dayCloses).where(and(eq(dayCloses.userId, userId), eq(dayCloses.date, addDaysIso(day, -1)))).limit(1))[0];
  const cands: QuestSpec[] = [(await coreSpec(tx, userId, day, cfg))];
  if (prev?.missedCore && prev.rulesActive) cands.push(comebackQuest(null, cfg));
  cands.push(...fixedSpecs(cfg), ...(await pillarSpecs(tx, userId, day, cfg)));
  const { active, waiting } = selectDailyQuests(cands, cfg);
  const now = nowIso();
  (await withUserTransaction(tx, userId, async (tx) => {
    const rows = [...active.map((q) => [q, "open"] as const), ...waiting.map((q) => [q, "waiting"] as const)];
    for (const [i, [q, status]] of rows.entries()) {
      await tx.insert(quests).values({ id: newId(), userId, date: day, kind: q.kind, title: q.title, whenText: q.when ?? null, tiersJson: JSON.stringify(q.tiers), targetJson: JSON.stringify(q.target), refType: q.refType ?? null, refId: q.refId ?? null, habitId: q.habitId ?? null, xp: q.xp ?? 0, status, sort: i, createdAt: now, updatedAt: now });
    }
    (await appendEvent(tx, { userId, type: "quests.generated", payload: { day, active: active.length, waiting: waiting.length, core: active[0]?.title }, gameDay: day, source: "job" }));
  }));
  return (await questsForDay(tx, userId, day));
});
}

/** Regenerates today's open quests (e.g. after a Life Event or a plan change), keeping completed ones. */
export async function regenerateDay(db: Db, userId: string, day: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  (await tx.delete(quests).where(and(eq(quests.userId, userId), eq(quests.date, day), eq(quests.status, "open"), sql`${quests.tierDone} IS NULL`)));
  (await tx.delete(quests).where(and(eq(quests.userId, userId), eq(quests.date, day), eq(quests.status, "waiting"))));
  const left = (await questsForDay(tx, userId, day));
  if (left.length === 0) return (await generateDay(tx, userId, day));
  return left;
});
}

// ── progress ─────────────────────────────────────────────────

async function dayMetrics(db: Db, userId: string, day: string) {
  const q = async <T extends Record<string, unknown>>(s: ReturnType<typeof sql>) => (await queryOne<T>(db, s));
  const studyMin = (await q<{ m: number | null }>(sql`SELECT sum(minutes) AS m FROM focus_sessions WHERE user_id = ${userId} AND game_day = ${day} AND status = 'ended' AND coalesce(subject_id, '') NOT IN ('english', 'foundations')`))?.m ?? 0;
  const englishMin = (await q<{ m: number | null }>(sql`SELECT sum(minutes) AS m FROM focus_sessions WHERE user_id = ${userId} AND game_day = ${day} AND status = 'ended' AND subject_id = 'english'`))?.m ?? 0;
  const foundationsTests = (await q<{ n: number | null }>(sql`SELECT sum(correct + wrong + blank) AS n FROM test_logs WHERE user_id = ${userId} AND game_day = ${day} AND subject_id = 'foundations'`))?.n ?? 0;
  const tests = (await q<{ n: number | null }>(sql`SELECT sum(correct + wrong + blank) AS n FROM test_logs WHERE user_id = ${userId} AND game_day = ${day}`))?.n ?? 0;
  const allMin = (await q<{ m: number | null }>(sql`SELECT sum(minutes) AS m FROM focus_sessions WHERE user_id = ${userId} AND game_day = ${day} AND status = 'ended'`))?.m ?? 0;
  return { studyMin, englishMin, foundationsTests, tests, allMin };
}

async function valueFor(db: Db, q: QuestRow, m: Awaited<ReturnType<typeof dayMetrics>>): Promise<number> {
  const target = JSON.parse(q.targetJson) as QuestTarget;
  if (q.kind === "pillar" && q.habitId) {
    const l = (await db.select({ t: habitLogs.tierDone }).from(habitLogs).where(and(eq(habitLogs.habitId, q.habitId), eq(habitLogs.date, q.date))).limit(1))[0];
    return l?.t ? tierRank(l.t) : 0;
  }
  if (q.refId === "foundations") return m.foundationsTests;
  if (q.refId === "english") return m.englishMin;
  if (q.kind === "comeback") return m.tests >= 3 ? m.studyMin : Math.min(m.studyMin, target.seed);
  return target.metric === "tests" ? m.tests : m.studyMin;
}

/** Recomputes tiers of the day's open quests from the logs; emits `quest.progress` when a tier changes. */
export async function refreshProgress(db: Db, userId: string, day: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const qs = (await questsForDay(tx, userId, day)).filter((q) => q.status === "open");
  if (!qs.length) return [];
  const m = (await dayMetrics(tx, userId, day));
  const changed: { id: string; tier: QuestTier | null }[] = [];
  (await withUserTransaction(tx, userId, async (tx) => {
    for (const q of qs) {
      const target = JSON.parse(q.targetJson) as QuestTarget;
      const v = (await valueFor(tx, q, m));
      const tier = tierReached(target, v);
      if (tier !== q.tierDone || Math.abs(v - q.progress) > 1e-9) {
        (await tx.update(quests).set({ tierDone: tier, progress: v, updatedAt: nowIso() }).where(eq(quests.id, q.id)));
        if (tier !== q.tierDone) {
          (await appendEvent(tx, { userId, type: "quest.progress", payload: { questId: q.id, kind: q.kind, tier, from: q.tierDone, xp: q.xp }, gameDay: day }));
          changed.push({ id: q.id, tier });
        }
      }
    }
    // Daily goal (F-DUO-03)
    const goal = (await getKv<{ minutes: number } | null>(tx, userId, "goal.daily", null));
    if (goal && m.allMin >= goal.minutes) {
      const done = (await queryOne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM events WHERE user_id = ${userId} AND type = 'goal.completed' AND game_day = ${day}`))?.n ?? 0;
      if (!done) (await appendEvent(tx, { userId, type: "goal.completed", payload: { minutes: goal.minutes, focus: m.allMin }, gameDay: day }));
    }
  }));
  return changed;
});
}

/** Manual tick for check-type quests without a habit (Nightly Review). */
export async function setQuestTier(db: Db, userId: string, questId: string, tier: QuestTier | null, clientRequestId?: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const q = (await tx.select().from(quests).where(and(eq(quests.id, questId), eq(quests.userId, userId))).limit(1))[0];
  if (!q) throw new Error("Unknown quest");
  if (!q.habitId) {
    let target: QuestTarget;
    try {
      target = JSON.parse(q.targetJson) as QuestTarget;
    } catch {
      throw new QuestActionDenied("This quest cannot be manually completed");
    }
    if (target.metric !== "check") {
      throw new QuestActionDenied("This quest is completed from its tracked study activity");
    }
  }
  const request = { questId, tier };
  const eventType = q.habitId ? "habit.logged" : "quest.progress";
  if (clientRequestId && await replayOf(tx, userId, eventType, clientRequestId, request)) return [{ id: questId, tier }];
  if (q.habitId) {
    // pillar quests are habits: log the habit (XP is projected from habit.logged)
    const h = (await tx.select().from(habits).where(eq(habits.id, q.habitId)).limit(1))[0];
    (await withUserTransaction(tx, userId, async (tx) => {
      (await tx.delete(habitLogs).where(and(eq(habitLogs.habitId, q.habitId!), eq(habitLogs.date, q.date))));
      if (tier) (await tx.insert(habitLogs).values({ id: newId(), habitId: q.habitId!, userId, date: q.date, tierDone: tier, createdAt: nowIso() }));
      (await appendEvent(tx, {
        userId,
        type: "habit.logged",
        payload: { habitId: q.habitId, tier, xp: h?.xp ?? 0, pillar: h?.pillar, gameDay: q.date, ...(clientRequestId ? { request } : {}) },
        gameDay: q.date,
        clientRequestId,
      }));
    }));
    return (await refreshProgress(tx, userId, q.date));
  }
  (await tx.update(quests).set({ tierDone: tier, updatedAt: nowIso() }).where(eq(quests.id, questId)));
  (await appendEvent(tx, {
    userId,
    type: "quest.progress",
    payload: { questId, kind: q.kind, tier, from: q.tierDone, xp: q.xp, manual: true, ...(clientRequestId ? { request } : {}) },
    gameDay: q.date,
    clientRequestId,
  }));
  return [{ id: questId, tier }];
});
}

// ── closing a day ────────────────────────────────────────────

function hashRand(s: string): number {
  return parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16) / 0x100000000;
}

export async function streakBefore(db: Db, userId: string, day: string) {
  const rows = (await db.select().from(dayCloses).where(and(eq(dayCloses.userId, userId), lt(dayCloses.date, day))).orderBy(asc(dayCloses.date)));
  let s = emptyStreak();
  const cfg = (await activeConfig(db, userId));
  for (const r of rows) s = advanceStreak(s, { standardDay: r.standardDay, shieldUsed: r.shieldUsed }, cfg).state;
  return s;
}

export async function availableShields(db: Db, userId: string) {
  return (await db.select().from(shields).where(and(eq(shields.userId, userId), sql`${shields.usedOn} IS NULL`)));
}

/**
 * Habit contracts (issue #75): an active, scheduled habit with a negative contract that was not logged costs
 * a capped amount (−8/day, −12/week). Trials never pay, and Shield / Life Event / Rest Day forgive. The
 * penalties are folded into `day.closed`, so replay reproduces them; the table is only the audit trail.
 */
async function settleContracts(db: Db, userId: string, day: string, forgiven: boolean, activeRules: boolean) {
  return await withUserTransaction(db, userId, async (tx) => {
  (await tx.delete(contractSettlements).where(and(eq(contractSettlements.userId, userId), eq(contractSettlements.gameDay, day))));
  if (forgiven || !activeRules) return [];
  const wd = weekdaySat(day);
  const due = (await tx
    .select()
    .from(habits)
    .where(and(eq(habits.userId, userId), eq(habits.status, "active"))))
    .filter((h) => h.contractSs < 0 && (!h.startedOn || h.startedOn <= day) && habitScheduled(h.daysPerWeek, wd));
  // An async predicate is always truthy, so decide sequentially which contract habits have no log today.
  const missing: typeof due = [];
  for (const h of due) {
    const logged = (await tx.select({ id: habitLogs.id }).from(habitLogs).where(and(eq(habitLogs.habitId, h.id), eq(habitLogs.date, day))).limit(1))[0];
    if (!logged) missing.push(h);
  }
  if (!missing.length) return [];
  const week = weekStartSaturday(day);
  const prior = (await queryOne<{ v: number | null }>(tx, sql`SELECT sum(amount) AS v FROM contract_settlements WHERE user_id = ${userId} AND game_day >= ${week} AND game_day < ${day}`))?.v ?? 0;
  const amounts = capWeeklyContract(prior, missing.map((h) => contractAmount(h.contractSs)));
  const out: { amount: number; ruleKey: string; reason: string; capApplied: boolean }[] = [];
  for (const x of missing.map((h, i) => ({ h, amount: amounts[i] ?? 0 })).filter((x) => x.amount !== 0)) {
    await tx.insert(contractSettlements).values({ id: newId(), userId, habitId: x.h.id, gameDay: day, amount: x.amount, reason: `Contract missed: ${x.h.title}`, createdAt: nowIso() });
    out.push({ amount: x.amount, ruleKey: "ss.contract", reason: `Contract missed: ${x.h.title}`, capApplied: x.amount > contractAmount(x.h.contractSs) });
  }
  return out;
});
}

export async function closeDay(db: Db, userId: string, day: string, opts: { now?: Date; force?: boolean } = {}) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  const existing = (await tx.select().from(dayCloses).where(and(eq(dayCloses.userId, userId), eq(dayCloses.date, day))).limit(1))[0];
  if (existing && !opts.force) return existing;
  (await generateDay(tx, userId, day, cfg));
  (await refreshProgress(tx, userId, day));
  return (await withUserTransaction(tx, userId, async (tx) => {
    if (existing) {
      const prevEvent = (JSON.parse(existing.json) as { eventId?: string }).eventId;
      if (prevEvent) (await appendEvent(tx, { userId, type: "event.undone", payload: { targetId: prevEvent, targetDay: day, reason: "day re-closed" }, gameDay: day, source: "system" }));
      (await tx.delete(dayCloses).where(eq(dayCloses.id, existing.id)));
    }
    const qs = (await questsForDay(tx, userId, day)).filter((q) => q.status !== "waiting");
    const shieldUsed = !!(await tx.select({ id: shields.id }).from(shields).where(and(eq(shields.userId, userId), eq(shields.usedForDate, day))).limit(1))[0];
    const lifeEvent = (await isLifeEvent(tx, userId, day));
    const restDay = (await isRestDay(tx, userId, day));
    const active = (await rulesActive(tx, userId, day));
    const week = weekStartSaturday(day);
    const weekPen = (await queryOne<{ v: number | null }>(tx, sql`SELECT sum(amount) AS v FROM score_ledger WHERE user_id = ${userId} AND week_id = ${week} AND game_day < ${day} AND rule_key LIKE 'ss.miss.%'`))?.v ?? 0;
    const r = closeDayDomain({ quests: qs.map((q) => ({ id: q.id, kind: q.kind, title: q.title, tierDone: q.tierDone })), weekPenaltiesSoFar: weekPen, shieldUsed, lifeEvent, restDay, weekReset: (await weekIsReset(tx, userId, day)), rulesActive: active }, cfg);
    const contractPenalties = (await settleContracts(tx, userId, day, shieldUsed || lifeEvent || restDay, active));
    const penalties = [...r.penalties, ...contractPenalties];
    const penaltyTotal = Math.round(penalties.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const ev = (await appendEvent(tx, { userId, type: "day.closed", payload: { day, coreTier: r.coreTier, penalties, gold: r.gold, standardDay: r.standardDay, missedCore: r.missedCore, shieldUsed, lifeEvent, restDay, rulesActive: active }, gameDay: day, source: "job", occurredAt: opts.now?.toISOString() }));
    for (const q of qs) (await tx.update(quests).set({ status: shieldUsed || lifeEvent || restDay ? (q.tierDone ? "done" : "forgiven") : q.tierDone ? "done" : "missed", updatedAt: nowIso() }).where(eq(quests.id, q.id)));
    (await tx.insert(dayCloses).values({ id: newId(), userId, date: day, coreTier: r.coreTier, penaltyTotal, standardDay: r.standardDay, seedDay: r.seedDay, missedCore: r.missedCore, shieldUsed, lifeEvent, rulesActive: active, json: JSON.stringify({ eventId: ev.id, misses: r.misses, restDay, contracts: contractPenalties }), createdAt: nowIso() }));

    // shields from the Standard streak
    const st = advanceStreak((await streakBefore(tx, userId, day)), { standardDay: r.standardDay, shieldUsed, restDay }, cfg);
    if (st.shieldEarned && (await availableShields(tx, userId)).length < cfg.shields.max) {
      (await tx.insert(shields).values({ id: newId(), userId, earnedOn: day, createdAt: nowIso() }));
      (await appendEvent(tx, { userId, type: "shield.earned", payload: { day, streak: cfg.shields.streakDaysPerShield }, gameDay: day, source: "job" }));
    }
    // Gems at Standard-streak milestones (#87) — event-sourced so Replay rebuilds them.
    if (r.standardDay && [7, 30, 100].includes(st.state.flame)) {
      (await appendEvent(tx, { userId, type: "gems.awarded", payload: { amount: cfg.gems.streakMilestone, ruleKey: "gems.streak", note: `${st.state.flame}-day Standard streak` }, gameDay: day, source: "job" }));
    }
    // loot (deterministic per user+day, so it's replayable)
    if (r.standardDay && cfg.flags.loot && !(await tx.select({ id: lootRolls.id }).from(lootRolls).where(and(eq(lootRolls.userId, userId), eq(lootRolls.date, day))).limit(1))[0]) {
      const lastPity = (await tx.select({ p: lootRolls.pityCounter }).from(lootRolls).where(eq(lootRolls.userId, userId)).orderBy(desc(lootRolls.date)).limit(1))[0]?.p ?? 0;
      const roll = rollLoot(hashRand(`${userId}:${day}`), lastPity, cfg);
      (await tx.insert(lootRolls).values({ id: newId(), userId, date: day, result: roll.result, pityCounter: roll.pity, createdAt: nowIso() }));
      if (roll.result === "shield" && (await availableShields(tx, userId)).length < cfg.shields.max) (await tx.insert(shields).values({ id: newId(), userId, earnedOn: day, createdAt: nowIso() }));
      (await appendEvent(tx, { userId, type: "loot.rolled", payload: { day, result: roll.result, pity: roll.pity }, gameDay: day, source: "job" }));
    }
    // comeback settlement: the Comeback quest of this day pays back 50 % of yesterday's penalty
    const cb = qs.find((q) => q.kind === "comeback");
    if (cb) {
      const y = (await tx.select().from(dayCloses).where(and(eq(dayCloses.userId, userId), eq(dayCloses.date, addDaysIso(day, -1)))).limit(1))[0];
      const s = comebackSettlement(y?.penaltyTotal ?? 0, cb.tierDone, cfg);
      if (s) (await appendEvent(tx, { userId, type: "comeback.settled", payload: { amount: s.amount, reason: s.reason, fromDay: y?.date }, gameDay: day, source: "job" }));
    }
    return (await tx.select().from(dayCloses).where(and(eq(dayCloses.userId, userId), eq(dayCloses.date, day))).limit(1))[0]!;
  }));
});
}

export class ShieldDenied extends Error {}

/** Spend a Shield on a day ending ≤ 24 h ago (re-closes the day if it was already closed). */
export async function useShield(db: Db, userId: string, day: string, now = new Date()) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  const u = (await tx.select().from(users).where(eq(users.id, userId)).limit(1))[0]!;
  const end = gameDayBounds(day, u.timezone, u.rolloverHour).end;
  const avail = (await availableShields(tx, userId));
  if (!avail.length) throw new ShieldDenied("No Shield available");
  if ((now.getTime() - end.getTime()) / 3_600_000 > cfg.shields.useWithinHours) throw new ShieldDenied(`Shields must be used within ${cfg.shields.useWithinHours}h of the day ending`);
  if ((await tx.select({ id: shields.id }).from(shields).where(and(eq(shields.userId, userId), eq(shields.usedForDate, day))).limit(1))[0]) throw new ShieldDenied("A Shield is already protecting that day");
  (await tx.update(shields).set({ usedOn: gameDay(now, u.timezone, u.rolloverHour), usedForDate: day }).where(eq(shields.id, avail[0]!.id)));
  (await appendEvent(tx, { userId, type: "shield.used", payload: { day }, gameDay: day }));
  if ((await tx.select({ id: dayCloses.id }).from(dayCloses).where(and(eq(dayCloses.userId, userId), eq(dayCloses.date, day))).limit(1))[0]) (await closeDay(tx, userId, day, { force: true, now }));
});
}

export class LifeEventDenied extends Error {}

export async function declareLifeEvent(db: Db, userId: string, day: string, reason: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  if (!reason || reason.trim().length < 3) throw new LifeEventDenied("Write one line about what happened");
  const week = weekStartSaturday(day);
  const month = day.slice(0, 7);
  const inWeek = (await queryOne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM life_events WHERE user_id = ${userId} AND date BETWEEN ${week} AND ${addDaysIso(week, 6)}`))?.n ?? 0;
  const inMonth = (await queryOne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM life_events WHERE user_id = ${userId} AND to_char(date, 'YYYY-MM') = ${month}`))?.n ?? 0;
  if ((await isLifeEvent(tx, userId, day))) throw new LifeEventDenied("A Life Event is already declared for that day");
  const ok = lifeEventAllowed(inWeek, inMonth, cfg);
  if (!ok.ok) throw new LifeEventDenied(ok.reason!);
  (await tx.insert(lifeEvents).values({ id: newId(), userId, date: day, reason: reason.trim(), createdAt: nowIso() }));
  (await appendEvent(tx, { userId, type: "life_event.declared", payload: { day, reason: reason.trim(), reflect: ok.reflect }, gameDay: day }));
  if ((await tx.select({ id: dayCloses.id }).from(dayCloses).where(and(eq(dayCloses.userId, userId), eq(dayCloses.date, day))).limit(1))[0]) (await closeDay(tx, userId, day, { force: true }));
  else (await regenerateDay(tx, userId, day));
  return { reflect: ok.reflect };
});
}

/**
 * Nightly rollover (doc 07 §6.1): closes every unclosed day before `today` (up to 14 back, never before the
 * campaign or the user's first event), then generates today's quests.
 */
export async function rollover(db: Db, userId: string, today: string, now = new Date()) {
  return await withUserTransaction(db, userId, async (tx) => {
  const first = (await tx.select({ d: events.gameDay }).from(events).where(eq(events.userId, userId)).orderBy(asc(events.gameDay)).limit(1))[0]?.d ?? today;
  const lastClosed = (await tx.select({ d: dayCloses.date }).from(dayCloses).where(eq(dayCloses.userId, userId)).orderBy(desc(dayCloses.date)).limit(1))[0]?.d;
  let d = lastClosed ? addDaysIso(lastClosed, 1) : first;
  if (diffDaysIso(today, d) > 14) d = addDaysIso(today, -14);
  if (d < PROJECT_START) d = PROJECT_START;
  const closed: string[] = [];
  for (; d < today; d = addDaysIso(d, 1)) {
    (await closeDay(tx, userId, d, { now }));
    closed.push(d);
  }
  const qs = (await generateDay(tx, userId, today));
  (await refreshProgress(tx, userId, today));
  return { closed, quests: qs.length };
});
}
