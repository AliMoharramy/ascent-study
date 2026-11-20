import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { chapterState, chapters, focusSessions, pretests, reviewRounds, subjects, testLogs } from "@/db/schema";
import { MASTERY_LEVELS, interleavePick, masteryLevel, pretestA0, roundDates } from "@/domain/learning";
import { chapterSessions } from "@/domain/mastery";
import { appendEvent } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { weekNoOf } from "@/lib/campaign";
import { nowIso } from "@/lib/ids";
import { setA0 } from "./forge";

/** Learning science (#89): pretest effect, 5 mastery levels, interleaved sessions, round-2/3 scheduler. */

export class LearningDenied extends Error {}

export const pretestInput = z.object({ chapterId: z.string().min(1).max(60), correct: z.number().int().min(0), total: z.number().int().min(1).max(10) }).refine((v) => v.correct <= v.total, { message: "correct cannot exceed total" });

export async function logPretest(db: Db, userId: string, input: z.input<typeof pretestInput>, day: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const p = pretestInput.parse(input);
  const cfg = (await activeConfig(tx, userId));
  if (!cfg.learning.pretest) throw new LearningDenied("Pretests are off in Settings");
  if (!(await tx.select({ id: chapters.id }).from(chapters).where(eq(chapters.id, p.chapterId)).limit(1))[0]) throw new LearningDenied(`Unknown chapter ${p.chapterId}`);
  (await tx.insert(pretests)
    .values({ userId, chapterId: p.chapterId, correct: p.correct, total: p.total, gameDay: day, createdAt: nowIso() })
    .onConflictDoUpdate({ target: [pretests.userId, pretests.chapterId], set: { correct: p.correct, total: p.total, gameDay: day } }));
  const a0 = pretestA0(p.correct, p.total, cfg.learning.pretestA0Weight);
  (await setA0(tx, userId, p.chapterId, a0));
  (await appendEvent(tx, { userId, type: "pretest.logged", payload: { chapterId: p.chapterId, correct: p.correct, total: p.total, a0 }, gameDay: day }));
  return { chapterId: p.chapterId, a0 };
});
}

export async function masteryView(db: Db, userId: string) {
  const cfg = (await activeConfig(db, userId));
  const states = new Map((await db.select().from(chapterState).where(eq(chapterState.userId, userId))).map((s) => [s.chapterId, s]));
  const pre = new Set((await db.select({ c: pretests.chapterId }).from(pretests).where(eq(pretests.userId, userId))).map((r) => r.c));
  const round3 = new Set((await db.select({ s: reviewRounds.subjectId }).from(reviewRounds).where(and(eq(reviewRounds.userId, userId), eq(reviewRounds.round, 3), eq(reviewRounds.status, "done")))).map((r) => r.s));
  const studied = new Set([
    ...(await db.select({ c: focusSessions.chapterId }).from(focusSessions).where(and(eq(focusSessions.userId, userId), isNotNull(focusSessions.chapterId)))).map((r) => r.c!),
    ...(await db.select({ c: testLogs.chapterId }).from(testLogs).where(and(eq(testLogs.userId, userId), isNotNull(testLogs.chapterId)))).map((r) => r.c!),
  ]);
  const logsByChapter = new Map<string, { gameDay: string; correct: number; wrong: number; blank: number; choices: number }[]>();
  for (const l of (await db.select().from(testLogs).where(eq(testLogs.userId, userId)))) {
    if (!l.chapterId) continue;
    logsByChapter.set(l.chapterId, [...(logsByChapter.get(l.chapterId) ?? []), l]);
  }
  const subj = new Map((await db.select().from(subjects)).map((s) => [s.id, s.nameEn]));
  return (await db
    .select()
    .from(chapters))
    .map((c) => {
      const st = states.get(c.id);
      const passing = chapterSessions(logsByChapter.get(c.id) ?? [], cfg).some((s) => s.passes);
      const level = masteryLevel({ hasStudy: studied.has(c.id), hasPassing: passing, cleared: !!st?.clearedAt, round3Done: round3.has(c.subjectId), pretested: pre.has(c.id) });
      return { chapterId: c.id, subjectId: c.subjectId, subject: subj.get(c.subjectId) ?? c.subjectId, no: c.no, title: c.title, level, label: MASTERY_LEVELS[level]!, cleared: !!st?.clearedAt, pretested: pre.has(c.id) };
    })
    .sort((a, b) => b.level - a.level || a.subjectId.localeCompare(b.subjectId) || a.no - b.no);
}

/** Round 2 = round1.doneOn + gap2; round 3 = round2 + gap3. Only pending rounds are moved. */
export async function applyScheduler(db: Db, userId: string): Promise<number> {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  if (!cfg.learning.scheduler) return 0;
  const rounds = (await tx.select().from(reviewRounds).where(eq(reviewRounds.userId, userId)));
  let moved = 0;
  for (const r1 of rounds.filter((r) => r.round === 1 && r.status === "done" && r.doneOn)) {
    const dates = roundDates(r1.doneOn!, cfg.learning.round2GapDays, cfg.learning.round3GapDays);
    for (const [round, on] of [[2, dates.round2], [3, dates.round3]] as const) {
      const r = rounds.find((x) => x.subjectId === r1.subjectId && x.round === round);
      if (r && r.status === "pending" && r.scheduledOn !== on) {
        (await tx.update(reviewRounds).set({ scheduledOn: on }).where(eq(reviewRounds.id, r.id)));
        moved++;
      }
    }
  }
  return moved;
});
}

export async function interleaveView(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const states = (await db.select().from(chapterState).where(and(eq(chapterState.userId, userId), isNotNull(chapterState.netPct))));
  const uncleared = states.filter((s) => !s.clearedAt);
  const subj = new Map((await db.select().from(subjects)).map((s) => [s.id, s.nameEn]));
  const ch = new Map((await db.select().from(chapters)).map((c) => [c.id, c]));
  const picked = interleavePick(uncleared.map((s) => ({ id: s.chapterId, subjectId: ch.get(s.chapterId)?.subjectId ?? "", netPct: s.netPct })), weekNoOf(today));
  return {
    enabled: cfg.learning.interleaving,
    xpBonus: cfg.learning.interleaveXpBonus,
    chapters: picked.map((p) => ({ chapterId: p.id, subject: subj.get(p.subjectId) ?? p.subjectId, title: ch.get(p.id)?.title ?? p.id, netPct: p.netPct })),
  };
}