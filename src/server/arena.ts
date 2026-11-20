import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, queryOne, type Db } from "@/db/client";
import { bosses, chapters, chapterState, dayCloses, duels, mockExams, mockResults, subjects, weekPlanItems } from "@/db/schema";
import { bossOutcome, miniTrialSpec, regionBossSpec, weeklyBossSpec, type BossSpec } from "@/domain/boss";
import { duel, shadowAccuracy, shadowSide, simulateRival } from "@/domain/rival";
import { consistencyRate } from "@/domain/quests";
import { netPct } from "@/domain/tests";
import { round2 } from "@/domain/xp";
import { appendEvent } from "@/events/store";
import { activeConfig, xpSummary } from "@/events/projections";
import { addDaysIso, jalaliToIso } from "@/i18n/jalali";
import { weekNoOf, weekStartOf } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";
import { PHASE_WEEKS } from "@/domain/planner";
import { rulesActive } from "./quests";

/** Arena (T-R2-03/04/05): bosses, Shadow Rival + weekly duel, cshub mock results. The system holds no questions. */

const REALM_SUBJECTS: Record<number, string[]> = { 1: ["ai", "discrete"], 2: ["dsa", "logic"], 3: ["arch", "toc"], 4: ["os", "stats"] };
export const REALM_END: Record<number, number> = Object.fromEntries(Object.entries(PHASE_WEEKS).map(([r, [, b]]) => [b, Number(r)]));

export type BossRow = typeof bosses.$inferSelect;

async function planChaptersUpTo(db: Db, userId: string, fromWeek: number, toWeek: number) {
  const rows = (await db.select({ ch: weekPlanItems.chapterId, m: sql<number>`sum(${weekPlanItems.plannedMin})` }).from(weekPlanItems).where(and(eq(weekPlanItems.userId, userId), gte(weekPlanItems.weekNo, fromWeek), lte(weekPlanItems.weekNo, toWeek))).groupBy(weekPlanItems.chapterId));
  return rows.map((r) => ({ id: r.ch, weight: r.m }));
}

/** Schedules the week's bosses (idempotent): Weekly Boss (Fri), Mini-Trial (every 2 weeks, Thu), Region Boss (realm end). */
export async function ensureWeekBosses(db: Db, userId: string, weekNo: number) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  if (!cfg.flags.bosses || weekNo < 2 || weekNo > 19) return [];
  const start = weekStartOf(weekNo);
  const level = (await xpSummary(tx, userId, start, cfg)).level;
  const specs: { kind: BossRow["kind"]; day: string; spec: BossSpec }[] = [];
  const thisWeek = (await planChaptersUpTo(tx, userId, weekNo, weekNo));
  const earlier = (await planChaptersUpTo(tx, userId, 2, weekNo - 1));
  if (thisWeek.length) specs.push({ kind: "weekly", day: addDaysIso(start, 6), spec: weeklyBossSpec(thisWeek, earlier, level, cfg) });
  if (weekNo % cfg.boss.miniTrialEveryWeeks === 0) specs.push({ kind: "mini_trial", day: addDaysIso(start, 5), spec: miniTrialSpec((await planChaptersUpTo(tx, userId, 2, weekNo)), cfg) });
  const realm = REALM_END[weekNo];
  if (realm) {
    const subs = REALM_SUBJECTS[realm]!;
    const chs = (await tx.select({ id: chapters.id, w: chapters.eqWeight, tier: chapters.tier, sub: chapters.subjectId }).from(chapters)).filter((c) => subs.includes(c.sub) && c.tier !== "C");
    specs.push({ kind: "region", day: addDaysIso(start, 6), spec: regionBossSpec(realm, chs.map((c) => ({ id: c.id, weight: c.w ?? 0.05 })), cfg) });
  }
  const now = nowIso();
  for (const s of specs)
    (await tx.insert(bosses).values({ id: newId(), userId, kind: s.kind, weekNo, scheduledFor: s.day, specJson: JSON.stringify(s.spec), thresholdPct: s.spec.threshold, createdAt: now, updatedAt: now }).onConflictDoNothing());
  return (await listBosses(tx, userId, weekNo));
});
}

export async function listBosses(db: Db, userId: string, weekNo?: number) {
  return (await db.select().from(bosses).where(and(eq(bosses.userId, userId), weekNo ? eq(bosses.weekNo, weekNo) : undefined)).orderBy(asc(bosses.scheduledFor)));
}

export async function nextBoss(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  (await ensureWeekBosses(tx, userId, weekNoOf(today)));
  return (await tx.select().from(bosses).where(and(eq(bosses.userId, userId), eq(bosses.status, "scheduled"), gte(bosses.scheduledFor, today))).orderBy(asc(bosses.scheduledFor)).limit(1))[0] ?? null;
});
}

export const bossResultInput = z.object({
  results: z.array(z.object({ chapterId: z.string().max(60), correct: z.coerce.number().int().min(0), wrong: z.coerce.number().int().min(0), blank: z.coerce.number().int().min(0) })).min(1).max(60),
});

export async function logBossResult(db: Db, userId: string, bossId: string, input: z.input<typeof bossResultInput>, day: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = bossResultInput.parse(input);
  const b = (await tx.select().from(bosses).where(and(eq(bosses.id, bossId), eq(bosses.userId, userId))).limit(1))[0];
  if (!b) throw new Error("Unknown boss");
  const o = bossOutcome(d.results, b.thresholdPct);
  return (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.update(bosses).set({ status: "done", resultPct: o.netPct, defeated: o.defeated, resultsJson: JSON.stringify(o.perChapter), updatedAt: nowIso() }).where(eq(bosses.id, bossId)));
    (await appendEvent(tx, { userId, type: "boss.result", payload: { bossId, kind: b.kind, netPct: o.netPct, defeated: o.defeated, hpLeft: o.hpLeft, weekNo: b.weekNo }, gameDay: day }));
    return o;
  }));
});
}

export async function skipBoss(db: Db, userId: string, bossId: string, day: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const b = (await tx.select().from(bosses).where(and(eq(bosses.id, bossId), eq(bosses.userId, userId))).limit(1))[0];
  if (!b) throw new Error("Unknown boss");
  (await tx.update(bosses).set({ status: "skipped", updatedAt: nowIso() }).where(eq(bosses.id, bossId)));
  (await appendEvent(tx, { userId, type: "boss.skipped", payload: { bossId, kind: b.kind }, gameDay: day }));
});
}

/**
 * Shareable result card data (#114, F-SOC-05). Privacy by default: the card renders only net %, verdict,
 * week and date. The per-chapter breakdown is returned separately so the UI can make it strictly opt-in.
 * No names, no ranks, no question content ever leave the device — the image is drawn client-side.
 */
export async function bossShareView(db: Db, userId: string, bossId: string) {
  const b = (await db.select().from(bosses).where(and(eq(bosses.id, bossId), eq(bosses.userId, userId))).limit(1))[0];
  if (!b || b.status !== "done") throw new Error("Unknown boss result");
  const per = b.resultsJson ? (JSON.parse(b.resultsJson) as { chapterId: string; netPct: number }[]) : [];
  const chs = new Map((await db.select({ id: chapters.id, title: chapters.title, sub: chapters.subjectId }).from(chapters)).map((c) => [c.id, c]));
  const subs = new Map((await db.select({ id: subjects.id, en: subjects.nameEn }).from(subjects)).map((s) => [s.id, s.en]));
  return {
    kind: b.kind,
    weekNo: b.weekNo,
    date: b.scheduledFor,
    netPct: b.resultPct ?? 0,
    defeated: b.defeated,
    perChapter: per.map((p) => ({ chapterId: p.chapterId, title: chs.get(p.chapterId)?.title ?? p.chapterId, subject: subs.get(chs.get(p.chapterId)?.sub ?? "") ?? "", netPct: p.netPct })),
  };
}

// ── Shadow Rival ─────────────────────────────────────────────

export async function rivalView(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  if (!cfg.flags.rival) return { enabled: false as const, reason: "The Shadow Rival is turned off (Settings → Feature flags)." };
  if (!(await rulesActive(db, userId, today))) return { enabled: false as const, reason: "The Shadow sleeps during the Baseline week (Ch.1). It wakes when you confirm your Baseline Report." };
  const w = cfg.triage.tierWeights;
  const tiers = new Map((await db.select({ id: chapters.id, t: chapters.tier }).from(chapters)).map((c) => [c.id, c.t]));
  const lastWeek = new Map((await db.select({ ch: weekPlanItems.chapterId, wk: sql<number>`max(${weekPlanItems.weekNo})` }).from(weekPlanItems).where(eq(weekPlanItems.userId, userId)).groupBy(weekPlanItems.chapterId)).map((r) => [r.ch, r.wk]));
  const cleared = (await db.select({ ch: chapterState.chapterId, at: chapterState.clearedAt }).from(chapterState).where(and(eq(chapterState.userId, userId), sql`${chapterState.clearedAt} IS NOT NULL`)));
  const cur = weekNoOf(today);
  const weeks = [];
  for (let t = 2; t <= Math.max(2, cur); t++) {
    const end = addDaysIso(weekStartOf(t), 6);
    const planMp = [...lastWeek].filter(([, wk]) => wk <= t).reduce((s, [ch]) => s + (w[tiers.get(ch) ?? "C"] ?? 1), 0);
    const userMp = cleared.filter((c) => c.at! <= end).reduce((s, c) => s + (w[tiers.get(c.ch) ?? "C"] ?? 1), 0);
    weeks.push({ week: t, planMp, userMp });
  }
  const sim = simulateRival(weeks, cfg);
  const a0s = (await db.select({ a0: chapterState.a0 }).from(chapterState).where(eq(chapterState.userId, userId))).map((r) => r.a0).filter((x): x is number => x != null);
  const a0Pct = a0s.length ? (a0s.reduce((a, b) => a + b, 0) / a0s.length) * 100 : 15;
  return { enabled: true as const, weeks: sim, current: sim[sim.length - 1]!, accuracy: shadowAccuracy(cur, a0Pct, cfg), a0Pct: round2(a0Pct), duels: (await listDuels(db, userId)) };
}

export async function listDuels(db: Db, userId: string) {
  return (await db.select().from(duels).where(eq(duels.userId, userId)).orderBy(asc(duels.weekNo))).map((d) => ({ ...d, rounds: JSON.parse(d.roundsJson) as ReturnType<typeof duel>["rounds"] }));
}

/** Settles the duel of every finished week (≥ 2) that has none yet (Friday night, after the Weekly Boss). */
export async function settleDuels(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  const view = (await rivalView(tx, userId, today));
  if (!view.enabled) return [];
  const done = new Set((await listDuels(tx, userId)).map((d) => d.weekNo));
  const out = [];
  for (const wk of view.weeks) {
    const end = addDaysIso(weekStartOf(wk.week), 6);
    if (end >= today || done.has(wk.week)) continue;
    const start = weekStartOf(wk.week);
    const prev = view.weeks.find((x) => x.week === wk.week - 1);
    const tests = (await queryOne<{ c: number; w: number; b: number }>(tx, sql`SELECT coalesce(sum(correct),0) c, coalesce(sum(wrong),0) w, coalesce(sum(blank),0) b FROM test_logs WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))!;
    const analyses = (await queryOne<{ n: number }>(tx, sql`SELECT count(*)::int n FROM error_items WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))!.n;
    const closes = (await tx.select({ t: dayCloses.coreTier }).from(dayCloses).where(and(eq(dayCloses.userId, userId), gte(dayCloses.date, start), lte(dayCloses.date, end))));
    const boss = (await tx.select().from(bosses).where(and(eq(bosses.userId, userId), eq(bosses.weekNo, wk.week), eq(bosses.kind, "weekly"))).limit(1))[0];
    const q = tests.c + tests.w + tests.b;
    const you = { mp: wk.userMp - (prev?.userMp ?? 0), netPct: q ? round2(netPct({ correct: tests.c, wrong: tests.w, blank: tests.b, choices: 4 })) : 0, analyses, consistency: consistencyRate(closes.map((c) => c.t)), bossPct: boss?.resultPct ?? null };
    const sh = shadowSide(wk, view.accuracy, wk.planMp - (prev?.planMp ?? 0), boss?.thresholdPct ?? 40);
    const r = duel(you, sh);
    const gold = r.winner === "user" ? cfg.gold.duelWin : 0;
    (await tx.insert(duels).values({ id: newId(), userId, weekNo: wk.week, roundsJson: JSON.stringify(r.rounds), winner: r.winner, goldAwarded: gold, createdAt: nowIso() }).onConflictDoNothing());
    (await appendEvent(tx, { userId, type: "duel.settled", payload: { week: wk.week, winner: r.winner, score: r.score, gold }, gameDay: end, source: "job" }));
    out.push({ week: wk.week, ...r });
  }
  return out;
});
}

// ── Arena: cshub mock exams (F-BOSS-04) ──────────────────────

/** Subjects the user deliberately skips (intentional blank, not weakness) — linear algebra (dropped). */
export async function skippedSubjects(db: Db): Promise<Set<string>> {
  return new Set((await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.status, "dropped"))).map((s) => s.id));
}

export async function listMocks(db: Db, userId: string) {
  const res = (await db.select().from(mockResults).where(eq(mockResults.userId, userId)).orderBy(asc(mockResults.mockNo)));
  return (await db
    .select()
    .from(mockExams)
    .orderBy(asc(mockExams.no)))
    .map((m) => {
      const budget = JSON.parse(m.budgetJson) as Record<string, { questions: number }>;
      const first = m.dateJalali.split("/")[0]!;
      let iso: string | null = null;
      try {
        iso = jalaliToIso(first.length === 10 ? first : m.dateJalali.slice(0, 10));
      } catch {
        iso = null;
      }
      return { ...m, date: iso, budget, results: res.filter((r) => r.mockNo === m.no).map((r) => ({ ...r, perSubject: JSON.parse(r.perSubjectJson) })) };
    });
}

export const mockInput = z.object({
  mockNo: z.coerce.number().int().min(1).max(30),
  perSubject: z.record(z.string(), z.object({ correct: z.coerce.number().int().min(0), wrong: z.coerce.number().int().min(0), blank: z.coerce.number().int().min(0) })),
  rank: z.coerce.number().int().min(1).nullish(),
  /** Exam simulator metadata — counts only, never question text (C18). */
  suspects: z.coerce.number().int().min(0).max(1000).nullish(),
  elapsedSec: z.coerce.number().int().min(0).max(24 * 3600).nullish(),
  mode: z.enum(["quick", "exam"]).default("quick"),
});

export async function logMock(db: Db, userId: string, input: z.input<typeof mockInput>, day: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = mockInput.parse(input);
  const m = (await tx.select().from(mockExams).where(eq(mockExams.no, d.mockNo)).limit(1))[0];
  if (!m) throw new Error("Unknown mock exam");
  const budget = JSON.parse(m.budgetJson) as Record<string, { questions: number }>;
  const skip = (await skippedSubjects(tx));
  const per = { ...d.perSubject };
  // intentional skip: dropped subjects count as blank with their budgeted question count
  for (const s of skip) if (budget[s]?.questions) per[s] = { correct: 0, wrong: 0, blank: budget[s]!.questions };
  const sum = (keys: string[]) => keys.reduce((a, k) => ({ correct: a.correct + per[k]!.correct, wrong: a.wrong + per[k]!.wrong, blank: a.blank + per[k]!.blank }), { correct: 0, wrong: 0, blank: 0 });
  const all = sum(Object.keys(per));
  const noSkip = sum(Object.keys(per).filter((k) => !skip.has(k)));
  const pct = (t: { correct: number; wrong: number; blank: number }) => (t.correct + t.wrong + t.blank ? round2(netPct({ ...t, choices: 4 })) : 0);
  const rival = (await rivalView(tx, userId, day));
  const beat = rival.enabled ? pct(noSkip) > rival.accuracy : false;
  const total = all.correct + all.wrong + all.blank;
  const suspects = Math.min(d.suspects ?? 0, total);
  return (await withUserTransaction(tx, userId, async (tx) => {
    const id = newId();
    (await tx.insert(mockResults).values({ id, userId, mockNo: d.mockNo, gameDay: day, ...all, netPct: pct(all), netPctNoSkip: pct(noSkip), rankInSite: d.rank ?? null, perSubjectJson: JSON.stringify(Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { ...v, netPct: pct(v), skipped: skip.has(k) }]))), createdAt: nowIso() }));
    (await appendEvent(tx, {
      userId,
      type: "mock.logged",
      payload: { mockNo: d.mockNo, netPct: pct(noSkip), netPctAll: pct(all), beatShadow: beat, mode: d.mode, suspects, elapsedSec: d.elapsedSec ?? null, total },
      gameDay: day,
    }));
    return { id, netPct: pct(all), netPctNoSkip: pct(noSkip), beatShadow: beat, suspects, elapsedSec: d.elapsedSec ?? null, total };
  }));
});
}
