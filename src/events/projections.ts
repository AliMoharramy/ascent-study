import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { queryOne, withUserTransaction, type Db } from "@/db/client";
import { configVersions, events, gemsLedger, goldLedger, scoreLedger, skillUnlocks, xpLedger } from "@/db/schema";
import { DEFAULT_CONFIG, mergeConfig } from "@/config/defaults";
import type { GameConfig } from "@/config/schema";
import { applySkillPerks } from "@/domain/extras";
import { awardXp, emptyDay, round2, settleWeeklyShare, STUDY_BUCKETS, type XpActivity, type XpBucket } from "@/domain/xp";
import { bossScore, penaltyFor } from "@/domain/score";
import { levelFromXp } from "@/domain/levels";
import { weekStartSaturday } from "@/i18n/jalali";
import { newId } from "@/lib/ids";
import { PROJECTED } from "./types";

/**
 * Projections (doc 07 §4, F-CORE-10, T-R1-05). The XP / Score / Gold ledgers are a pure fold of the event log,
 * computed per game day (daily caps live inside a day). Appending an event re-projects its day; `replayAll`
 * rebuilds every day from scratch — both paths produce identical ledgers (property-tested).
 * Rules come from the *current* config by default, so a config change is followed by a replay.
 */

type Ev = { id: string; type: string; occurredAt: string; source: string; payload: Record<string, unknown> };

export async function activeConfig(db: Db, userId: string): Promise<GameConfig> {
  const r = (await db.select({ json: configVersions.json }).from(configVersions).where(eq(configVersions.userId, userId)).orderBy(desc(configVersions.version)).limit(1))[0];
  const cfg = r ? mergeConfig(DEFAULT_CONFIG, JSON.parse(r.json)) : DEFAULT_CONFIG;
  const unlocks = await db.select({ skillId: skillUnlocks.skillId, tier: skillUnlocks.tier }).from(skillUnlocks).where(eq(skillUnlocks.userId, userId));
  return applySkillPerks(cfg, unlocks);
}

const n = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const s = (v: unknown) => (typeof v === "string" ? v : null);

interface Exclusions {
  undone: Set<string>;
  deletedTests: Set<string>;
  lessonsNotDone: Set<string>;
}

async function exclusions(db: Db, userId: string): Promise<Exclusions> {
  const rows = await db
    .select({ type: events.type, payloadJson: events.payloadJson })
    .from(events)
    .where(and(eq(events.userId, userId), inArray(events.type, ["event.undone", "test.deleted", "lesson.status_changed"])))
    .orderBy(events.occurredAt, events.id);
  const undone = new Set<string>();
  const deletedTests = new Set<string>();
  const lastLesson = new Map<string, string>();
  for (const r of rows) {
    const p = JSON.parse(r.payloadJson) as Record<string, unknown>;
    if (r.type === "event.undone" && s(p.targetId)) undone.add(p.targetId as string);
    if (r.type === "test.deleted" && s(p.testLogId)) deletedTests.add(p.testLogId as string);
    if (r.type === "lesson.status_changed" && s(p.lessonId)) lastLesson.set(p.lessonId as string, String(p.to));
  }
  return { undone, deletedTests, lessonsNotDone: new Set([...lastLesson].filter(([, st]) => st !== "done").map(([id]) => id)) };
}

interface Row {
  ledger: "xp" | "score" | "gold" | "gems";
  eventId: string;
  amount: number;
  reason: string;
  ruleKey: string;
  capApplied: boolean;
  occurredAt: string;
}

/** Pure fold of one day's events → ledger rows. */
export function foldDay(evs: Ev[], ex: Exclusions, cfg: GameConfig): Row[] {
  const rows: Row[] = [];
  let day = emptyDay();
  const xp = (e: Ev, a: XpActivity) => {
    const r = awardXp(a, day, cfg);
    day = r.day;
    for (const w of r.awards) if (w.amount > 0 || w.capApplied) rows.push({ ledger: "xp", eventId: e.id, amount: w.amount, reason: w.reason, ruleKey: w.ruleKey, capApplied: w.capApplied, occurredAt: e.occurredAt });
  };
  const add = (ledger: Row["ledger"], e: Ev, amount: number, ruleKey: string, reason: string, capApplied = false) => rows.push({ ledger, eventId: e.id, amount: round2(amount), reason, ruleKey, capApplied, occurredAt: e.occurredAt });
  // last progress per quest / habit wins (a quest is paid once, at its final tier of the day)
  const pillar = new Map<string, { e: Ev; tier: string | null; xp: number; sleep?: boolean }>();

  for (const e of evs) {
    if (ex.undone.has(e.id)) continue;
    const p = e.payload;
    const late = p.late === true;
    switch (e.type) {
      case "focus.stopped":
      case "focus.manual":
        if (e.source === "import") break; // Day-0 kit: observation only, no XP (doc 09 §3)
        xp(e, { kind: "focus", minutes: n(p.minutes), surge: p.surge === true, manualLate: late });
        break;
      case "test.logged":
        if (e.source === "import" || ex.deletedTests.has(String(p.testLogId))) break;
        xp(e, { kind: "tests", correct: n(p.correct), wrong: n(p.wrong), manualLate: late, interleaved: p.interleaved === true });
        if (n(p.wrong) === 0 && n(p.blank) === 0 && n(p.correct) >= 10) add("gems", e, cfg.gems.perfectRun, "gems.perfect_run", "Perfect run (≥ 10 tests, no misses)");
        break;
      case "lesson.status_changed":
        if (p.to === "done" && p.from !== "done" && !ex.lessonsNotDone.has(String(p.lessonId))) xp(e, { kind: "video_lesson", manualLate: late });
        break;
      case "error.logged":
        if (p.analyzed !== false) xp(e, { kind: "error_analyzed" });
        break;
      case "review.answered":
        xp(e, { kind: "review_card" });
        break;
      case "forge.created":
        xp(e, { kind: "forge_artifact" });
        break;
      case "chapter.cleared":
        xp(e, { kind: "chapter_clear", tier: (p.tier as "M" | "S" | "C") ?? "S" });
        add("gems", e, cfg.gems.chapterClear, "gems.chapter_clear", "Chapter cleared");
        break;
      case "boss.result": {
        const kind = String(p.kind);
        const pct = n(p.netPct);
        xp(e, kind === "mini_trial" ? { kind: "mini_trial", netPct: pct } : { kind: "weekly_boss", netPct: pct });
        add("score", e, bossScore(pct, kind === "mini_trial" ? "mini_trial" : kind === "region" ? "region_boss" : "weekly_boss").amount, `ss.${kind}`, `${kind.replace("_", " ")} net ${round2(pct)}%`);
        if (p.defeated === true && kind === "weekly") add("gold", e, cfg.gold.weeklyBossDefeated, "gold.weekly_boss", "Weekly Boss defeated");
        if (p.defeated === true && kind === "region") add("gold", e, cfg.gold.regionBoss, "gold.region_boss", "Region Boss defeated");
        if (p.defeated === true && (kind === "weekly" || kind === "region")) add("gems", e, cfg.gems.bossWin, "gems.boss_win", "Boss defeated");
        break;
      }
      case "boss.skipped":
        if (p.kind === "weekly") add("score", e, penaltyFor("weekly_boss", cfg), "ss.miss.weekly_boss", "Weekly Boss skipped");
        break;
      case "mock.logged":
        xp(e, { kind: "mock_exam", netPct: n(p.netPct), beatShadow: p.beatShadow === true });
        add("score", e, bossScore(n(p.netPct), "mock_exam").amount, "ss.mock_exam", `mock exam ${p.mockNo ?? ""} net ${round2(n(p.netPct))}%`);
        break;
      case "quest.progress":
        if (n(p.xp) > 0 && s(p.questId)) pillar.set(`q:${p.questId}`, { e, tier: s(p.tier), xp: n(p.xp) });
        break;
      case "habit.logged":
        if (n(p.xp) > 0 && s(p.habitId) && p.pillar !== "mind") pillar.set(`h:${p.habitId}`, { e, tier: s(p.tier), xp: n(p.xp), sleep: p.sleepOnTime === true });
        break;
      case "sleep.logged":
        if (p.wakeOnTime === true) pillar.set("sleep:wake", { e, tier: "standard", xp: cfg.xp.pillarQuest });
        if (p.bedOnTime === true) pillar.set("sleep:bed", { e, tier: "standard", xp: cfg.xp.pillarSleepOnTime, sleep: true });
        break;
      case "day.closed":
        for (const x of (p.penalties as { amount: number; ruleKey: string; reason: string; capApplied: boolean }[]) ?? []) if (x.amount !== 0) add("score", e, x.amount, x.ruleKey, x.reason, x.capApplied);
        for (const g of (p.gold as { amount: number; reason: string }[]) ?? []) add("gold", e, g.amount, "gold.day", g.reason);
        break;
      case "comeback.settled":
        add("score", e, n(p.amount), "ss.comeback", String(p.reason ?? "Comeback refund"));
        break;
      case "week.reset":
        if (n(p.amount) > 0) add("score", e, n(p.amount), "ss.reset_week", String(p.reason ?? "Reset Week"), true);
        break;
      case "goal.completed":
        add("gold", e, n(p.gold, cfg.goal.goldOnComplete), "gold.goal", "Daily goal reached");
        break;
      case "duel.settled":
        if (n(p.gold) > 0) add("gold", e, n(p.gold), "gold.duel", "Duel won");
        if (p.winner === "user") add("gems", e, cfg.gems.duelWin, "gems.duel_win", "Duel won");
        break;
      case "reward.claimed":
        add("gold", e, -Math.abs(n(p.gold)), "gold.reward", `Reward: ${String(p.title ?? "")}`);
        break;
      case "board.claimed":
        if (n(p.gold) > 0) add("gold", e, n(p.gold), "gold.board", "Quest Board completed");
        break;
      // R3 extras / R4 (#87, #91): gems + reward gold stay a pure fold of events, so Replay rebuilds them too.
      case "gems.awarded":
        add("gems", e, n(p.amount), s(p.ruleKey) ?? "gems.award", s(p.note) ?? "Gems awarded");
        break;
      case "gems.spent":
        add("gems", e, -Math.abs(n(p.amount)), s(p.ruleKey) ?? "gems.spend", s(p.note) ?? "Gems spent");
        break;
      case "season.claimed":
        if (n(p.gold) > 0) add("gold", e, n(p.gold), "gold.season", `Season Pass week ${String(p.week ?? "")}`);
        if (n(p.gems) > 0) add("gems", e, n(p.gems), "gems.season", `Season Pass week ${String(p.week ?? "")}`);
        break;
      case "card.claimed":
        if (n(p.gold) > 0) add("gold", e, n(p.gold), "gold.card", "Challenge card completed");
        if (n(p.gems) > 0) add("gems", e, n(p.gems), "gems.card", "Challenge card completed");
        break;
      case "rush.finished":
        if (n(p.gold) > 0) add("gold", e, n(p.gold), "gold.rush", "Boss Rush finished");
        if (n(p.gems) > 0) add("gems", e, n(p.gems), "gems.rush", "Boss Rush finished");
        break;
    }
  }

  for (const v of pillar.values()) {
    if (!v.tier) continue;
    const full = v.xp;
    const amount = v.tier === "seed" ? full * cfg.xp.seedFraction : full;
    const r = awardXp({ kind: "pillar_quest", sleepOnTime: v.sleep }, day, { ...cfg, xp: { ...cfg.xp, pillarQuest: amount, pillarSleepOnTime: amount } });
    day = r.day;
    for (const w of r.awards) rows.push({ ledger: "xp", eventId: v.e.id, amount: w.amount, reason: `${w.reason}${v.tier === "seed" ? " (Seed 25%)" : ""}`, ruleKey: w.ruleKey, capApplied: w.capApplied, occurredAt: v.e.occurredAt });
  }
  return rows;
}

export async function projectDay(db: Db, userId: string, day: string, cfg?: GameConfig): Promise<number> {
  return await withUserTransaction(db, userId, async (tx) => {
    const config = cfg ?? await activeConfig(tx, userId);
    const evs: Ev[] = (await tx
      .select({ id: events.id, type: events.type, occurredAt: events.occurredAt, source: events.source, payloadJson: events.payloadJson })
      .from(events)
      .where(and(eq(events.userId, userId), eq(events.gameDay, day)))
      .orderBy(events.occurredAt, events.id))
      .map((e) => ({ id: e.id, type: e.type, occurredAt: e.occurredAt, source: e.source, payload: JSON.parse(e.payloadJson) as Record<string, unknown> }));
    const rows = foldDay(evs, await exclusions(tx, userId), config);
    const weekId = weekStartSaturday(day);
    await tx.delete(xpLedger).where(and(eq(xpLedger.userId, userId), eq(xpLedger.gameDay, day)));
    await tx.delete(scoreLedger).where(and(eq(scoreLedger.userId, userId), eq(scoreLedger.gameDay, day)));
    await tx.delete(goldLedger).where(and(eq(goldLedger.userId, userId), eq(goldLedger.gameDay, day)));
    await tx.delete(gemsLedger).where(and(eq(gemsLedger.userId, userId), eq(gemsLedger.gameDay, day)));
    for (const r of rows) {
      const base = { id: newId(), userId, eventId: r.eventId, amount: r.amount, reason: r.reason, ruleKey: r.ruleKey, gameDay: day, occurredAt: r.occurredAt };
      if (r.ledger === "xp") await tx.insert(xpLedger).values({ ...base, capApplied: r.capApplied, weekId });
      else if (r.ledger === "score") await tx.insert(scoreLedger).values({ ...base, capApplied: r.capApplied, weekId });
      else if (r.ledger === "gems") await tx.insert(gemsLedger).values({ id: newId(), userId, amount: r.amount, ruleKey: r.ruleKey, note: r.reason, gameDay: day, createdAt: r.occurredAt });
      else await tx.insert(goldLedger).values(base);
    }
    return rows.length;
  });
}

/** Rebuilds every ledger; the event/config snapshot is read only after acquiring the user lock. */
export async function replayAll(db: Db, userId: string): Promise<{ days: number; rows: number }> {
  return await withUserTransaction(db, userId, async (tx) => {
    const cfg = await activeConfig(tx, userId);
    const types = [...PROJECTED, "event.undone"];
    const days = (await tx.selectDistinct({ d: events.gameDay }).from(events)
      .where(and(eq(events.userId, userId), inArray(events.type, types))))
      .map((r) => r.d).filter((d): d is string => !!d);
    await tx.delete(xpLedger).where(eq(xpLedger.userId, userId));
    await tx.delete(scoreLedger).where(eq(scoreLedger.userId, userId));
    await tx.delete(goldLedger).where(eq(goldLedger.userId, userId));
    await tx.delete(gemsLedger).where(eq(gemsLedger.userId, userId));
    let rows = 0;
    for (const d of days) rows += await projectDay(tx, userId, d, cfg);
    return { days: days.length, rows };
  });
}

/** Canonical ledger snapshot (for the replay property test and the Replay tool's diff). */
export async function ledgerSnapshot(db: Db, userId: string): Promise<string[]> {
  const x = (await db.select().from(xpLedger).where(eq(xpLedger.userId, userId))).map((r) => `xp|${r.gameDay}|${r.eventId}|${r.ruleKey}|${r.amount}|${r.capApplied}`);
  const sc = (await db.select().from(scoreLedger).where(eq(scoreLedger.userId, userId))).map((r) => `ss|${r.gameDay}|${r.eventId}|${r.ruleKey}|${r.amount}`);
  const g = (await db.select().from(goldLedger).where(eq(goldLedger.userId, userId))).map((r) => `gold|${r.gameDay}|${r.eventId}|${r.ruleKey}|${r.amount}`);
  const gm = (await db.select().from(gemsLedger).where(eq(gemsLedger.userId, userId))).map((r) => `gems|${r.gameDay}|${r.ruleKey}|${r.amount}`);
  return [...x, ...sc, ...g, ...gm].sort();
}

// ── read models ──────────────────────────────────────────────

const NON_STUDY_PREFIX = ["xp.pillar", "xp.forge"];
const isStudyRule = (k: string) => !NON_STUDY_PREFIX.some((p) => k.startsWith(p));

export interface XpSummary {
  levelXp: number;
  rawXp: number;
  level: number;
  title: string;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number;
  todayXp: number;
  weekSs: number;
  seasonSs: number;
  gold: number;
}

export async function xpSummary(db: Db, userId: string, today: string, cfg?: GameConfig): Promise<XpSummary> {
  cfg ??= await activeConfig(db, userId);
  const byWeek = await db
    .select({ week: xpLedger.weekId, rule: xpLedger.ruleKey, amount: sql<number>`sum(${xpLedger.amount})::double precision` })
    .from(xpLedger)
    .where(eq(xpLedger.userId, userId))
    .groupBy(xpLedger.weekId, xpLedger.ruleKey);
  const weeks = new Map<string, { study: number; non: number }>();
  for (const r of byWeek) {
    const w = weeks.get(r.week) ?? { study: 0, non: 0 };
    if (isStudyRule(r.rule)) w.study += r.amount;
    else w.non += r.amount;
    weeks.set(r.week, w);
  }
  let levelXp = 0;
  let raw = 0;
  let surplusGold = 0;
  for (const w of weeks.values()) {
    const st = settleWeeklyShare(w.study, w.non, cfg);
    levelXp += st.levelXp;
    raw += w.study + w.non;
    surplusGold += st.gold;
  }
  const L = levelFromXp(levelXp, cfg.levels);
  const sum = async (q: ReturnType<typeof sql>) => (await queryOne<{ v: number | null }>(db, q))?.v ?? 0;
  const todayXp = await sum(sql`SELECT sum(amount)::double precision AS v FROM xp_ledger WHERE user_id = ${userId} AND game_day = ${today}`);
  const weekSs = await sum(sql`SELECT sum(amount)::double precision AS v FROM score_ledger WHERE user_id = ${userId} AND week_id = ${weekStartSaturday(today)}`);
  const weekStudyXp = await sum(sql`SELECT sum(amount)::double precision AS v FROM xp_ledger WHERE user_id = ${userId} AND week_id = ${weekStartSaturday(today)} AND rule_key NOT LIKE 'xp.pillar%' AND rule_key NOT LIKE 'xp.forge%'`);
  const seasonSs = await sum(sql`SELECT sum(amount)::double precision AS v FROM score_ledger WHERE user_id = ${userId}`);
  const seasonStudy = [...weeks.values()].reduce((a, w) => a + w.study, 0);
  const gold = await sum(sql`SELECT sum(amount)::double precision AS v FROM gold_ledger WHERE user_id = ${userId}`) + surplusGold;
  return {
    levelXp: round2(levelXp),
    rawXp: round2(raw),
    level: L.level,
    title: L.title,
    xpIntoLevel: round2(L.xpIntoLevel),
    xpForNext: L.xpForNext,
    progress: L.progress,
    todayXp: round2(todayXp),
    // SS = study XP + boss results − penalties (doc 07 §6.3)
    weekSs: round2(weekStudyXp + weekSs),
    seasonSs: round2(seasonStudy + seasonSs),
    gold: round2(gold),
  };
}

export function bucketOf(ruleKey: string): XpBucket | "other" {
  const k = ruleKey.split(".")[1] ?? "";
  const map: Record<string, XpBucket> = { focus: "focus", video: "video", tests: "tests", analysis: "analysis", review: "review", forge: "forge", pillar: "pillars", chapter: "chapter", weekly_boss: "boss", mini_trial: "boss", mock_exam: "boss" };
  return map[k] ?? "other";
}

export { STUDY_BUCKETS };
