import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, queryOne, queryRows, type Db } from "@/db/client";
import { chapters, dailyCheckins, dayCloses, focusSessions, reviewRounds, reviews, subjects, testLogs } from "@/db/schema";
import { sparkPattern } from "@/domain/pillars";
import { bestBlocks, frictionFix, goalProgress, goalUpgrade, scoutingA0, topFrictions, type DailyGoal } from "@/domain/baseline";
import { consistencyRate } from "@/domain/quests";
import { appendEvent, replayOf } from "@/events/store";
import { activeConfig, xpSummary } from "@/events/projections";
import { addDaysIso, diffDaysIso, weekStartSaturday } from "@/i18n/jalali";
import { weekNoOf, weekStartOf, WEEK1_START } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";
import { localParts } from "@/lib/time";
import { getKv, setKv } from "./kv";
import { capacityView, generatePlan, triage } from "./plan";
import { setA0 } from "./forge";
import { applyScheduler } from "./learning";
import { detourLedger } from "./ideas";
import { councilExperiment } from "./experiments";
import { questsForDay } from "./quests";
import { weekPlanItems } from "@/db/schema";

/**
 * Review rituals and the Baseline (T-R1-15, T-R1-16, T-R2-07 / F-REV-01/02, F-PLAN-03/04, F-DUO-03/16).
 */

// ── nightly review (≤ 2 min) ─────────────────────────────────

export const DEFAULT_ENV_CHECKLIST = ["Book open on the desk at tomorrow's Core chapter", "Shoes and clothes by the door", "Phone charging outside the bedroom", "Water bottle filled", "Tomorrow's first task written on paper"];

export const nightlyInput = z.object({ spark: z.string().trim().max(300).default(""), envDone: z.array(z.string().max(160)).max(30).default([]), checklist: z.array(z.string().trim().min(1).max(160)).max(30).optional(), seconds: z.number().int().min(0).max(3600).optional(), clientRequestId: z.string().max(80).nullish() });

export async function getNightly(db: Db, userId: string, day: string) {
  const r = (await db.select().from(reviews).where(and(eq(reviews.userId, userId), eq(reviews.kind, "nightly"), eq(reviews.date, day))).limit(1))[0];
  return { saved: r ? (JSON.parse(r.json) as z.output<typeof nightlyInput>) : null, checklist: (await getKv<string[]>(db, userId, "review.env_checklist", DEFAULT_ENV_CHECKLIST)), quests: (await questsForDay(db, userId, day)) };
}

async function upsertReview(db: Db, userId: string, kind: "nightly" | "weekly" | "monthly", date: string, json: unknown) {
  return await withUserTransaction(db, userId, async (tx) => {
  const now = nowIso();
  (await tx.insert(reviews).values({ id: newId(), userId, kind, date, json: JSON.stringify(json), createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [reviews.userId, reviews.kind, reviews.date], set: { json: JSON.stringify(json), updatedAt: now } }));
});
}

export async function saveNightly(db: Db, userId: string, day: string, input: z.input<typeof nightlyInput>) {
  const { clientRequestId, ...d } = nightlyInput.parse(input);
  await withUserTransaction(db, userId, async (tx) => {
    if (await replayOf(tx, userId, "review.nightly", clientRequestId, { ...d, day })) return; // retried replay: nothing to rewrite
    if (d.checklist) await setKv(tx, userId, "review.env_checklist", d.checklist);
    await upsertReview(tx, userId, "nightly", day, d);
    await appendEvent(tx, { userId, type: "review.nightly", payload: { day, spark: !!d.spark, env: d.envDone.length, seconds: d.seconds ?? null, request: { ...d, day } }, gameDay: day, clientRequestId });
  });
}

// ── weekly council (7 steps) ─────────────────────────────────

export const councilInput = z.object({
  worked: z.string().trim().max(1000).default(""),
  blocked: z.string().trim().max(1000).default(""),
  oneChange: z.string().trim().min(3, "Pick exactly one change for next week").max(300),
  slotTopic: z.string().trim().max(160).default(""),
  planApproved: z.boolean().default(false),
  bossNote: z.string().trim().max(300).default(""),
});

export async function councilData(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const week = weekStartSaturday(today);
  const closes = (await db.select().from(dayCloses).where(and(eq(dayCloses.userId, userId), gte(dayCloses.date, week), lte(dayCloses.date, addDaysIso(week, 6)))));
  const no = weekNoOf(today);
  const items = (await db.select().from(weekPlanItems).where(and(eq(weekPlanItems.userId, userId), eq(weekPlanItems.weekNo, no + 1))));
  const saved = (await db.select().from(reviews).where(and(eq(reviews.userId, userId), eq(reviews.kind, "weekly"), eq(reviews.date, week))).limit(1))[0];
  const previous = (await db.select().from(reviews).where(and(eq(reviews.userId, userId), eq(reviews.kind, "weekly"))).orderBy(desc(reviews.date)).limit(4)).map((r) => ({ date: r.date, ...(JSON.parse(r.json) as z.output<typeof councilInput>) }));
  return {
    week,
    weekNo: no,
    xp: (await xpSummary(db, userId, today, cfg)),
    consistency: consistencyRate(closes.map((c) => c.coreTier)),
    standardDays: closes.filter((c) => c.standardDay).length,
    ledger: (await detourLedger(db, userId, today, 7)),
    nextWeekPlanH: Math.round(items.reduce((s, i) => s + i.plannedMin, 0) / 6) / 10,
    saved: saved ? (JSON.parse(saved.json) as z.output<typeof councilInput>) : null,
    previous,
    experiment: (await councilExperiment(db, userId)),
  };
}

export async function saveCouncil(db: Db, userId: string, today: string, input: z.input<typeof councilInput>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = councilInput.parse(input);
  const week = weekStartSaturday(today);
  const ledger = (await detourLedger(tx, userId, today, 7));
  (await upsertReview(tx, userId, "weekly", week, { ...d, detourTop: ledger.topKinds }));
  (await appendEvent(tx, { userId, type: "council.completed", payload: { week, oneChange: d.oneChange, planApproved: d.planApproved, detourMinutes: ledger.totalMinutes } }));
  return d;
});
}

// ── daily goal (F-DUO-03) ────────────────────────────────────

export const goalInput = z.object({ minutes: z.coerce.number().int().min(5).max(720), tier: z.enum(["seed", "standard", "stretch"]).default("standard") });

export async function getGoal(db: Db, userId: string): Promise<DailyGoal | null> {
  return (await getKv<DailyGoal | null>(db, userId, "goal.daily", null));
}

export async function setGoal(db: Db, userId: string, today: string, input: z.input<typeof goalInput>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = goalInput.parse(input);
  const g: DailyGoal = { ...d, setOn: today };
  (await setKv(tx, userId, "goal.daily", g));
  (await appendEvent(tx, { userId, type: "goal.set", payload: { ...g } }));
  return g;
});
}

export async function goalView(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const goal = (await getGoal(db, userId)) ?? { minutes: cfg.goal.defaultMinutes, tier: "standard" as const, setOn: today };
  const focus = (await queryOne<{ m: number | null }>(db, sql`SELECT sum(coalesce(minutes, 0)) AS m FROM focus_sessions WHERE user_id = ${userId} AND game_day = ${today} AND status = 'ended'`))?.m ?? 0;
  const hitRows = (await queryRows<{ d: string; m: number }>(db, sql`SELECT game_day AS d, sum(minutes) AS m FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day >= ${addDaysIso(today, -14)} AND game_day < ${today} GROUP BY game_day`));
  const hits = Array.from({ length: 14 }, (_, i) => (hitRows.find((r) => r.d === addDaysIso(today, -14 + i))?.m ?? 0) >= goal.minutes);
  return { goal, explicit: !!(await getGoal(db, userId)), focus, ...goalProgress(goal, focus), upgrade: goalUpgrade(goal, today, hits, cfg, diffDaysIso) };
}

// ── onboarding (F-DUO-16) ────────────────────────────────────

export const onboardingState = async (db: Db, userId: string) => (await getKv<{ done: string | null; runs: number }>(db, userId, "onboarding", { done: null, runs: 0 }));

export async function completeOnboarding(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const s = (await onboardingState(tx, userId));
  (await setKv(tx, userId, "onboarding", { done: today, runs: s.runs + 1 }));
  (await appendEvent(tx, { userId, type: "onboarding.completed", payload: { runs: s.runs + 1 } }));
});
}

// ── Baseline Report (8 sections) ─────────────────────────────

export async function baselineReport(db: Db, userId: string, today: string, tz?: string) {
  const cfg = (await activeConfig(db, userId));
  const start = WEEK1_START;
  const end = addDaysIso(start, 6);
  const sessions = (await db.select().from(focusSessions).where(and(eq(focusSessions.userId, userId), eq(focusSessions.status, "ended"), gte(focusSessions.gameDay, start), lte(focusSessions.gameDay, end))));
  const focusMin = sessions.reduce((s, r) => s + (r.minutes ?? 0), 0);
  const cap = (await capacityView(db, userId, today, cfg));
  const factor = cap.rawHours > 0 ? Math.round((focusMin / 60 / cap.rawHours) * 100) / 100 : 0;
  // 2. best blocks
  const blocks = bestBlocks(
    sessions.map((s) => {
      const lp = localParts(new Date(s.startedAt), tz);
      const wd = (new Date(`${lp.date}T12:00:00Z`).getUTCDay() + 1) % 7;
      return { startedAtLocal: { weekday: wd, hour: lp.hour }, minutes: s.minutes ?? 0 };
    }),
  );
  // 3. anchors: wake times + first study start per day
  const checks = (await db.select().from(dailyCheckins).where(and(eq(dailyCheckins.userId, userId), gte(dailyCheckins.date, start), lte(dailyCheckins.date, end))));
  const wakes = checks.map((c) => c.wakeAt).filter(Boolean) as string[];
  const anchors = [
    wakes.length ? `After waking (~${wakes.sort()[Math.floor(wakes.length / 2)]}) and a glass of water → morning walk` : "After waking and a glass of water → morning walk",
    blocks[0] ? `At ${String(blocks[0].from).padStart(2, "0")}:00 (your strongest block) → Core Study Block` : "After breakfast → Core Study Block",
    "After brushing teeth → book before bed",
  ];
  // 4. frictions
  const frictions = topFrictions(checks.map((c) => c.blocker)).map((f) => ({ ...f, fix: frictionFix(f.text) }));
  // 5. detours
  const ledger = (await detourLedger(db, userId, end, 7));
  // 6. a0 per chapter from scouting tests
  const logs = (await db.select().from(testLogs).where(and(eq(testLogs.userId, userId), gte(testLogs.gameDay, start), lte(testLogs.gameDay, end))));
  const a0 = scoutingA0(logs);
  const chs = (await db.select({ id: chapters.id, title: chapters.title, subjectId: chapters.subjectId, no: chapters.no, tier: chapters.tier }).from(chapters).innerJoin(subjects, eq(subjects.id, chapters.subjectId)).where(eq(subjects.status, "active")).orderBy(asc(subjects.sort), asc(chapters.no)));
  const scouted = chs.filter((c) => a0[c.id]).map((c) => ({ ...c, a0: a0[c.id]!.a0, questions: a0[c.id]!.questions }));
  const tierCount = { M: chs.filter((c) => c.tier === "M").length, S: chs.filter((c) => c.tier === "S").length, C: chs.filter((c) => c.tier === "C").length };
  return {
    confirmed: (await getKv<{ on: string } | null>(db, userId, "baseline.confirmed", null)),
    capacity: { focusHours: Math.round(focusMin / 6) / 10, rawHours: cap.rawHours, factor, scenarios: cap.scenarios, days: new Set(sessions.map((s) => s.gameDay)).size },
    blocks,
    anchors,
    frictions,
    ledger,
    scouted,
    tierCount,
    weekOver: today > end,
  };
}

/** Confirms the Baseline: stores a0, re-runs Triage, builds the 25-week plan, activates the rules (end of Ch.1). */
export async function confirmBaseline(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  const r = (await baselineReport(tx, userId, today));
  return (await withUserTransaction(tx, userId, async (tx) => {
    for (const c of r.scouted) (await setA0(tx, userId, c.id, c.a0));
    const t = (await triage(tx, userId, cfg));
    const p = (await generatePlan(tx, userId, today, cfg, { fromWeek: Math.max(2, weekNoOf(today)) }));
    (await setKv(tx, userId, "baseline.confirmed", { on: today }));
    (await appendEvent(tx, { userId, type: "baseline.confirmed", payload: { scouted: r.scouted.length, factor: r.capacity.factor, tiers: t.results.length, planItems: p.items.length } }));
    return { triage: t, plan: p };
  }));
});
}

// ── three review rounds (TOC ×3) + monthly review + Spark pattern (issue #81) ──

export const ROUND_GAP_DAYS = 7;

/** Creates rounds 1..3 for every active subject (7 days apart), idempotently. */
export async function ensureReviewRounds(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const subs = (await tx.select({ id: subjects.id }).from(subjects).where(eq(subjects.status, "active")));
  const now = nowIso();
  for (const s of subs) {
    for (const round of [1, 2, 3]) {
      (await tx.insert(reviewRounds)
        .values({ id: newId(), userId, subjectId: s.id, round, scheduledOn: addDaysIso(today, (round - 1) * ROUND_GAP_DAYS), status: "pending", note: "", createdAt: now })
        .onConflictDoNothing());
    }
  }
});
}

export async function reviewRoundsView(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  (await ensureReviewRounds(tx, userId, today));
  (await applyScheduler(tx, userId));
  const names = new Map((await tx.select({ id: subjects.id, en: subjects.nameEn, fa: subjects.nameFa, status: subjects.status }).from(subjects)).map((s) => [s.id, s]));
  const rows = (await tx.select().from(reviewRounds).where(eq(reviewRounds.userId, userId)).orderBy(asc(reviewRounds.scheduledOn), asc(reviewRounds.round)));
  const rounds = rows.map((r) => ({ ...r, subject: names.get(r.subjectId) ?? null, due: r.status === "pending" && r.scheduledOn <= today, overdue: r.status === "pending" && r.scheduledOn < today }));
  const bySubject = [...new Set(rows.map((r) => r.subjectId))].map((id) => ({
    id,
    subject: names.get(id) ?? null,
    rounds: rounds.filter((r) => r.subjectId === id),
    done: rounds.filter((r) => r.subjectId === id && r.status === "done").length,
    round3Done: rounds.some((r) => r.subjectId === id && r.round === 3 && r.status === "done"),
  }));
  return {
    rounds,
    bySubject,
    due: rounds.filter((r) => r.due),
    overdue: rounds.filter((r) => r.overdue).length,
    done: rounds.filter((r) => r.status === "done").length,
    total: rounds.length,
    toc: bySubject.find((s) => s.id === "toc") ?? null,
  };
});
}

export async function setReviewRound(db: Db, userId: string, id: string, status: "pending" | "done" | "skipped", today: string, note = "", scheduledOn?: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const r = (await tx.select().from(reviewRounds).where(and(eq(reviewRounds.id, id), eq(reviewRounds.userId, userId))).limit(1))[0];
  if (!r) throw new Error("Unknown review round");
  (await tx.update(reviewRounds)
    .set({ status, doneOn: status === "done" ? today : null, note: note.trim(), scheduledOn: scheduledOn ?? r.scheduledOn })
    .where(eq(reviewRounds.id, id)));
  (await appendEvent(tx, { userId, type: "review.round", payload: { roundId: id, subjectId: r.subjectId, round: r.round, status }, gameDay: today }));
  if (status === "done" && r.round === 1) (await applyScheduler(tx, userId));
  return { status };
});
}

export const monthlyInput = z.object({
  wins: z.string().trim().max(1200).default(""),
  risks: z.string().trim().max(1200).default(""),
  oneChange: z.string().trim().min(3, "Pick one change for next month").max(300),
  linearAlgebra: z.enum(["keep_dropped", "activate", "reduce_weight", "keep_active"]).default("keep_dropped"),
  confidence: z.coerce.number().int().min(1).max(5).default(3),
  note: z.string().trim().max(500).default(""),
});

export async function saveMonthly(db: Db, userId: string, today: string, input: z.input<typeof monthlyInput>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = monthlyInput.parse(input);
  const month = today.slice(0, 7);
  // `reviews.date` is a real DATE column: a month is stored as its first day (never the bare "YYYY-MM").
  (await upsertReview(tx, userId, "monthly", `${month}-01`, d));
  (await appendEvent(tx, { userId, type: "review.monthly", payload: { month, linearAlgebra: d.linearAlgebra, confidence: d.confidence, oneChange: d.oneChange }, gameDay: today }));
  return d;
});
}

export async function sparkLogView(db: Db, userId: string) {
  const rows = (await db.select().from(reviews).where(and(eq(reviews.userId, userId), eq(reviews.kind, "nightly"))).orderBy(desc(reviews.date)).limit(90));
  const sparks = rows
    .map((r) => ({ day: r.date, text: String((JSON.parse(r.json) as { spark?: string }).spark ?? "") }))
    .filter((s) => s.text.trim().length > 0);
  return { ...sparkPattern(sparks), sparks: sparks.slice(0, 14) };
}

export async function monthlyReviewView(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const month = today.slice(0, 7);
  const saved = (await tx.select().from(reviews).where(and(eq(reviews.userId, userId), eq(reviews.kind, "monthly"), eq(reviews.date, `${month}-01`))).limit(1))[0];
  const la = (await tx.select().from(subjects).where(eq(subjects.id, "linear_algebra")).limit(1))[0] ?? null;
  const rounds = (await reviewRoundsView(tx, userId, today));
  return {
    month,
    saved: saved ? (JSON.parse(saved.json) as z.output<typeof monthlyInput>) : null,
    linearAlgebra: la ? { id: la.id, nameEn: la.nameEn, nameFa: la.nameFa, status: la.status } : null,
    rounds,
    spark: (await sparkLogView(tx, userId)),
    history: (await tx.select().from(reviews).where(and(eq(reviews.userId, userId), eq(reviews.kind, "monthly"))).orderBy(desc(reviews.date)).limit(6)).map((r) => ({ date: r.date.slice(0, 7), ...(JSON.parse(r.json) as z.output<typeof monthlyInput>) })),
  };
});
}

export const weekStartForNo = weekStartOf;
