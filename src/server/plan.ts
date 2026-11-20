import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, queryOne, type Db } from "@/db/client";
import { chapters, chapterState, focusSessions, prereqs, subjects, weekPlanItems, weeks, type Tier } from "@/db/schema";
import type { GameConfig } from "@/config/schema";
import { dayCapacityMinutes, focusFactor, rawWeeklyHours, SAMPLE_WINDOWS, scenarios, weekCapacityHours, weekdaySat, type DayException, type TimeWindow } from "@/domain/capacity";
import { checkOverride, runTriage, type TriageChapter } from "@/domain/triage";
import { burnGap, plan, rebalance, weekPhase, type PlanChapter, type PlanResult, type PlanWeek } from "@/domain/planner";
import { resetWeekCorrection } from "@/domain/score";
import { round2 } from "@/domain/xp";
import { appendEvent } from "@/events/store";
import { addDaysIso, diffDaysIso } from "@/i18n/jalali";
import { TOTAL_WEEKS, weekNoOf, weekStartOf } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";
import { getKv, setKv } from "./kv";
import { getRestDays } from "./restDays";

/**
 * Plan service (T-R1-07/08, T-R2-08): time windows & capacity, Triage, 25-week plan, Rebalance, Reset Week,
 * manual tier overrides and drag-and-drop moves. Every mutation is an event.
 */

/** Study-hour budgets per subject (doc 03 §5) — used to size chapters until real lesson data is linked. */
export const SUBJECT_BUDGET_H: Record<string, number> = { ai: 68, discrete: 56, dsa: 82, logic: 34, arch: 46, toc: 54, os: 56, stats: 38 };
/** Daily-fixed subjects (never planned as chapters). */
export const DAILY_FIXED = new Set(["foundations", "english"]);

export const windowSchema = z.object({ weekday: z.number().int().min(0).max(6), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) });
export const exceptionSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), minutes: z.number().int().min(0).max(1440), reason: z.string().max(120).optional() });

export const getWindows = async (db: Db, userId: string) => (await getKv<TimeWindow[]>(db, userId, "capacity.windows", SAMPLE_WINDOWS));
/** User exceptions merged with Rest Day Passes (0 minutes → the planner re-sizes that week). */
export const getExceptions = async (db: Db, userId: string): Promise<DayException[]> => {
  const rest = (await getRestDays(db, userId));
  const restSet = new Set(rest);
  return [...(await getKv<DayException[]>(db, userId, "capacity.exceptions", [])).filter((e) => !restSet.has(e.date)), ...rest.map((date) => ({ date, minutes: 0, reason: "Rest day" }))];
};

export async function saveWindows(db: Db, userId: string, windows: unknown, exceptions?: unknown) {
  return await withUserTransaction(db, userId, async (tx) => {
  const w = z.array(windowSchema).max(50).parse(windows);
  (await setKv(tx, userId, "capacity.windows", w));
  if (exceptions !== undefined) (await setKv(tx, userId, "capacity.exceptions", z.array(exceptionSchema).max(400).parse(exceptions)));
  (await appendEvent(tx, { userId, type: "windows.updated", payload: { windows: w.length, rawHours: rawWeeklyHours(w) } }));
});
}

/** Moving focus factor from real focus minutes of the last complete weeks. */
export async function measuredFactor(db: Db, userId: string, today: string, cfg: GameConfig) {
  const windows = (await getWindows(db, userId));
  const ex = (await getExceptions(db, userId));
  const cur = weekNoOf(today);
  const data: { focusMinutes: number; rawMinutes: number }[] = [];
  for (let w = Math.max(1, cur - cfg.capacity.movingWeeks); w < cur; w++) {
    const start = weekStartOf(w);
    const end = addDaysIso(start, 6);
    const focus = (await queryOne<{ m: number | null }>(db, sql`SELECT sum(minutes) AS m FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day BETWEEN ${start} AND ${end}`))?.m ?? 0;
    let raw = 0;
    for (let i = 0; i < 7; i++) raw += dayCapacityMinutes(addDaysIso(start, i), windows, ex, 1);
    data.push({ focusMinutes: focus, rawMinutes: raw });
  }
  return focusFactor(data, cfg);
}

export async function capacityView(db: Db, userId: string, today: string, cfg: GameConfig) {
  const windows = (await getWindows(db, userId));
  const m = (await measuredFactor(db, userId, today, cfg));
  return { windows, exceptions: (await getExceptions(db, userId)), rawHours: rawWeeklyHours(windows), factor: m, scenarios: scenarios(windows, cfg, m.source === "measured" ? m.factor : null) };
}

export async function todayCapacityMinutes(db: Db, userId: string, day: string, cfg: GameConfig, lifeEvent = false): Promise<number> {
  const m = (await measuredFactor(db, userId, day, cfg));
  return dayCapacityMinutes(day, (await getWindows(db, userId)), (await getExceptions(db, userId)), m.factor, { lifeEvent });
}

// ── chapters for triage / planning ───────────────────────────

export interface ChapterRow {
  id: string;
  subjectId: string;
  no: number;
  title: string;
  optional: boolean;
  tier: Tier | null;
  tierLocked: boolean;
  eq: number | null;
  phase: number;
  a0: number | null;
  cleared: boolean;
  focusMin: number;
  hours: number;
}

export async function plannableChapters(db: Db, userId: string): Promise<ChapterRow[]> {
  const rows = (await db
    .select({ id: chapters.id, subjectId: chapters.subjectId, no: chapters.no, title: chapters.title, optional: chapters.optional, tier: chapters.tier, tierLocked: chapters.tierLocked, eq: chapters.eqWeight, phase: subjects.priorityPhase, status: subjects.status })
    .from(chapters)
    .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .orderBy(asc(subjects.sort), asc(chapters.no)))
    .filter((r) => r.status === "active" && !DAILY_FIXED.has(r.subjectId) && r.phase != null);
  const st = new Map((await db.select().from(chapterState).where(eq(chapterState.userId, userId))).map((s) => [s.chapterId, s]));
  const focus = new Map(
    (await db
      .select({ ch: focusSessions.chapterId, m: sql<number>`sum(coalesce(${focusSessions.minutes}, 0))` })
      .from(focusSessions)
      .where(and(eq(focusSessions.userId, userId), eq(focusSessions.status, "ended")))
      .groupBy(focusSessions.chapterId))
      .map((r) => [r.ch, r.m]),
  );
  const eqSum = new Map<string, number>();
  for (const r of rows) if (!r.optional) eqSum.set(r.subjectId, (eqSum.get(r.subjectId) ?? 0) + (r.eq ?? 0));
  return rows.map((r) => {
    const count = rows.filter((x) => x.subjectId === r.subjectId && !x.optional).length || 1;
    const total = eqSum.get(r.subjectId) || 0;
    const share = total > 0 ? Math.max(r.eq ?? 0, 0.02) / total : 1 / count;
    const hours = round2(Math.max(1.5, (SUBJECT_BUDGET_H[r.subjectId] ?? 40) * share * (r.optional ? 0.5 : 1)));
    const s = st.get(r.id);
    return { id: r.id, subjectId: r.subjectId, no: r.no, title: r.title, optional: r.optional, tier: r.tier, tierLocked: r.tierLocked, eq: r.eq, phase: r.phase!, a0: s?.a0 ?? null, cleared: !!s?.clearedAt, focusMin: focus.get(r.id) ?? 0, hours };
  });
}

export async function prereqList(db: Db) {
  return (await db.select().from(prereqs)).map((p) => ({ chapterId: p.chapterId, requires: p.requiresChapterId }));
}

async function triageInput(db: Db, userId: string): Promise<TriageChapter[]> {
  return (await plannableChapters(db, userId)).map((r) => ({ id: r.id, subjectId: r.subjectId, no: r.no, title: r.title, optional: r.optional, eq: r.eq, a0: r.a0, hours: r.hours, lockedTier: r.tierLocked ? r.tier : null }));
}

/** Pure prereq-graph warnings for the Plan UI (#96) — no tier writes. */
export async function prereqWarnings(db: Db, userId: string, cfg: GameConfig): Promise<string[]> {
  return runTriage((await triageInput(db, userId)), (await prereqList(db)), cfg).warnings;
}

export async function triage(db: Db, userId: string, cfg: GameConfig) {
  return await withUserTransaction(db, userId, async (tx) => {
  const res = runTriage((await triageInput(tx, userId)), (await prereqList(tx)), cfg);
  (await withUserTransaction(tx, userId, async (tx) => {
    for (const r of res.results) if (!r.locked) (await tx.update(chapters).set({ tier: r.tier, updatedAt: nowIso() }).where(eq(chapters.id, r.id)));
    const count = (t: Tier) => res.results.filter((r) => r.tier === t).length;
    (await appendEvent(tx, { userId, type: "triage.run", payload: { M: count("M"), S: count("S"), C: count("C"), warnings: res.warnings } }));
  }));
  return res;
});
}

export async function overrideTier(db: Db, userId: string, chapterId: string, tier: Tier | null, reason: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const current = new Map((await plannableChapters(tx, userId)).map((c) => [c.id, (c.tier ?? "S") as Tier]));
  if (!current.has(chapterId)) throw new Error("Unknown or unplannable chapter");
  if (tier === null) {
    (await tx.update(chapters).set({ tierLocked: false, updatedAt: nowIso() }).where(eq(chapters.id, chapterId)));
    (await appendEvent(tx, { userId, type: "tier.overridden", payload: { chapterId, tier: null, reason: reason || "unlock" } }));
    return { ok: true, warnings: [] as string[] };
  }
  const chk = checkOverride(chapterId, tier, reason, current, (await prereqList(tx)));
  if (!chk.ok) return chk;
  (await tx.update(chapters).set({ tier, tierLocked: true, updatedAt: nowIso() }).where(eq(chapters.id, chapterId)));
  (await appendEvent(tx, { userId, type: "tier.overridden", payload: { chapterId, tier, reason, warnings: chk.warnings, from: current.get(chapterId) } }));
  return chk;
});
}

// ── plan ─────────────────────────────────────────────────────

export async function planWeeks(db: Db, userId: string, today: string, cfg: GameConfig): Promise<PlanWeek[]> {
  const f = (await measuredFactor(db, userId, today, cfg)).factor;
  const windows = (await getWindows(db, userId));
  const ex = (await getExceptions(db, userId));
  return Array.from({ length: TOTAL_WEEKS }, (_, i) => ({ no: i + 1, startsOn: weekStartOf(i + 1), capacityH: weekCapacityHours(weekStartOf(i + 1), windows, ex, f, addDaysIso) }));
}

export async function planChapters(db: Db, userId: string): Promise<PlanChapter[]> {
  return (await plannableChapters(db, userId)).map((c) => ({ id: c.id, subjectId: c.subjectId, no: c.no, tier: c.tier ?? (c.optional ? "C" : "S"), phase: c.phase, hoursRemaining: c.cleared ? 0 : round2(Math.max(0, c.hours - c.focusMin / 60)), done: c.cleared }));
}

async function storePlan(db: Db, userId: string, ws: PlanWeek[], r: PlanResult, fromWeek: number) {
  return await withUserTransaction(db, userId, async (tx) => {
  (await tx.delete(weekPlanItems).where(and(eq(weekPlanItems.userId, userId), gte(weekPlanItems.weekNo, fromWeek))));
  const now = nowIso();
  for (const w of ws)
    (await tx.insert(weeks)
      .values({ userId, no: w.no, startsOn: w.startsOn, capacityH: w.capacityH })
      .onConflictDoUpdate({ target: [weeks.userId, weeks.no], set: { capacityH: w.capacityH, startsOn: w.startsOn } }));
  for (const it of r.items.filter((i) => i.week >= fromWeek))
    (await tx.insert(weekPlanItems).values({ id: newId(), userId, weekNo: it.week, chapterId: it.chapterId, subjectId: it.subjectId, tier: it.tier, plannedMin: it.plannedMin, testsTarget: it.testsTarget, createdAt: now }));
});
}

/** Generates (or regenerates from `fromWeek`) the 25-week plan. Runs triage first if no tiers exist yet. */
export async function generatePlan(db: Db, userId: string, today: string, cfg: GameConfig, opts: { fromWeek?: number; mode?: "generate" | "rebalance" } = {}) {
  return await withUserTransaction(db, userId, async (tx) => {
  if (!(await plannableChapters(tx, userId)).some((c) => c.tier)) (await triage(tx, userId, cfg));
  const ws = (await planWeeks(tx, userId, today, cfg));
  const cur = opts.fromWeek ?? Math.max(1, weekNoOf(today));
  const chs = (await planChapters(tx, userId));
  const r = opts.mode === "rebalance" ? rebalance(ws, chs, cur, cfg) : plan(ws, chs, cfg, { fromWeek: cur });
  (await withUserTransaction(tx, userId, async (tx) => {
    (await storePlan(tx, userId, ws, r, cur));
    (await appendEvent(tx, { userId, type: opts.mode === "rebalance" ? "plan.rebalanced" : "plan.generated", payload: { fromWeek: cur, items: r.items.length, overflow: r.overflow.length, droppedC: r.droppedC } }));
  }));
  return r;
});
}

export async function ensurePlan(db: Db, userId: string, today: string, cfg: GameConfig) {
  return await withUserTransaction(db, userId, async (tx) => {
  const has = (await queryOne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM week_plan_items WHERE user_id = ${userId}`))?.n ?? 0;
  if (!has) (await generatePlan(tx, userId, today, cfg, { fromWeek: 1 }));
});
}

export async function moveItem(db: Db, userId: string, itemId: string, toWeek: number) {
  return await withUserTransaction(db, userId, async (tx) => {
  if (toWeek < 1 || toWeek > TOTAL_WEEKS) throw new Error("Week out of range");
  const it = (await tx.select().from(weekPlanItems).where(and(eq(weekPlanItems.id, itemId), eq(weekPlanItems.userId, userId))).limit(1))[0];
  if (!it) throw new Error("Unknown plan item");
  (await tx.update(weekPlanItems).set({ weekNo: toWeek, manual: true }).where(eq(weekPlanItems.id, itemId)));
  (await appendEvent(tx, { userId, type: "plan.item_moved", payload: { itemId, chapterId: it.chapterId, from: it.weekNo, to: toWeek } }));
});
}

export class ResetWeekDenied extends Error {}

/** Reset Week (doc 04 §6.4): once per 30 days; penalties of the week limited to −50, plan rebuilt from today. */
export async function resetWeek(db: Db, userId: string, today: string, cfg: GameConfig) {
  return await withUserTransaction(db, userId, async (tx) => {
  const no = weekNoOf(today);
  const last = (await tx.select({ at: weeks.resetAt }).from(weeks).where(and(eq(weeks.userId, userId), eq(weeks.resetUsed, true)))).map((r) => r.at).filter(Boolean).sort().pop();
  if (last && diffDaysIso(today, last.slice(0, 10)) < 30) throw new ResetWeekDenied(`Reset Week is available once a month (last used ${last.slice(0, 10)})`);
  const start = weekStartOf(no);
  const pen = (await queryOne<{ v: number | null }>(tx, sql`SELECT sum(amount) AS v FROM score_ledger WHERE user_id = ${userId} AND week_id = ${start} AND amount < 0`))?.v ?? 0;
  const corr = resetWeekCorrection(pen, cfg);
  return (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.insert(weeks).values({ userId, no, startsOn: start, resetUsed: true, resetAt: today }).onConflictDoUpdate({ target: [weeks.userId, weeks.no], set: { resetUsed: true, resetAt: today } }));
    (await appendEvent(tx, { userId, type: "week.reset", payload: { week: no, penalties: pen, amount: corr?.amount ?? 0, reason: corr?.reason ?? "Reset Week (penalties already within the limit)" } }));
    return { week: no, correction: corr?.amount ?? 0, plan: (await generatePlan(tx, userId, today, cfg, { fromWeek: no, mode: "rebalance" })) };
  }));
});
}

export async function weekIsReset(db: Db, userId: string, day: string): Promise<boolean> {
  return !!(await db.select({ r: weeks.resetUsed }).from(weeks).where(and(eq(weeks.userId, userId), eq(weeks.no, weekNoOf(day)))).limit(1))[0]?.r;
}

export async function planView(db: Db, userId: string, today: string, cfg: GameConfig) {
  return await withUserTransaction(db, userId, async (tx) => {
  (await ensurePlan(tx, userId, today, cfg));
  const ws = (await planWeeks(tx, userId, today, cfg));
  const items = (await tx.select().from(weekPlanItems).where(eq(weekPlanItems.userId, userId)).orderBy(asc(weekPlanItems.weekNo), asc(weekPlanItems.createdAt)));
  const fixedH = (cfg.capacity.fixedDailyMinutes * 7) / 60;
  const resets = new Map((await tx.select().from(weeks).where(eq(weeks.userId, userId))).map((w) => [w.no, w]));
  const summaries = ws.map((w) => {
    const committed = round2(items.filter((i) => i.weekNo === w.no).reduce((s, i) => s + i.plannedMin, 0) / 60 + fixedH);
    const ratio = w.capacityH > 0 ? round2(committed / w.capacityH) : 0;
    return { ...w, phase: weekPhase(w.no).label, committedH: committed, loadRatio: ratio, status: ratio <= 0.9 ? "green" : ratio <= 1 ? "yellow" : "red", reset: !!resets.get(w.no)?.resetUsed };
  });
  const chs = (await planChapters(tx, userId));
  const cur = weekNoOf(today);
  return { currentWeek: cur, weeks: summaries, items, gap: burnGap(chs, ws, cur, cfg), chapters: (await plannableChapters(tx, userId)), prereqWarnings: (await prereqWarnings(tx, userId, cfg)) };
});
}

export async function weekItemsFor(db: Db, userId: string, weekNo: number) {
  return (await db.select().from(weekPlanItems).where(and(eq(weekPlanItems.userId, userId), eq(weekPlanItems.weekNo, weekNo))).orderBy(asc(weekPlanItems.createdAt)));
}

/** Minutes of focus per chapter within a week (for today's Core sizing). */
export async function weekFocusByChapter(db: Db, userId: string, weekNo: number, chapterIds: string[]): Promise<Record<string, number>> {
  if (chapterIds.length === 0) return {};
  const start = weekStartOf(weekNo);
  const rows = (await db
    .select({ ch: focusSessions.chapterId, m: sql<number>`sum(coalesce(${focusSessions.minutes}, 0))` })
    .from(focusSessions)
    .where(and(eq(focusSessions.userId, userId), inArray(focusSessions.chapterId, chapterIds), sql`${focusSessions.gameDay} BETWEEN ${start} AND ${addDaysIso(start, 6)}`))
    .groupBy(focusSessions.chapterId));
  return Object.fromEntries(rows.map((r) => [r.ch!, r.m]));
}

export { weekdaySat };
