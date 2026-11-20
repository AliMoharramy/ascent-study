import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { events, reviewRounds, subjects } from "@/db/schema";
import { ASCENT_RULES, BOX_BREATHING, GROUNDING, PLAYBOOK, preExamSleepPlan } from "@/domain/final";
import { appendEvent } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { addDaysIso, diffDaysIso } from "@/i18n/jalali";
import { daysToExam, EXAM_DATE, EXAM_DATE_JALALI, TOTAL_WEEKS, weekNoOf } from "@/lib/campaign";
import { weakView } from "./insights";
import { getKv, setKv } from "./kv";
import { programView } from "./rest";

/** Exam-day playbook + pre-exam sleep plan (#104, F-FIN-02/03). The sleep plan derives from the Sleep Program. */

const CHECKLIST_KEY = "final.checklist";

/**
 * Last-7-days review plan (#112, F-FIN-04): review-only, derived from the weak-point hunter and the
 * pending review rounds. Overdue rounds land on day 1; rounds scheduled past the window compress into
 * the last day. The exam eve never gets new material.
 */
export async function finalReviewPlan(db: Db, userId: string, today: string) {
  const daysLeft = daysToExam(today);
  const days = Math.max(1, Math.min(7, daysLeft));
  const weak = (await weakView(db, userId));
  const names = new Map((await db.select({ id: subjects.id, en: subjects.nameEn }).from(subjects)).map((s) => [s.id, s.en]));
  const rounds = (await db.select().from(reviewRounds).where(and(eq(reviewRounds.userId, userId), eq(reviewRounds.status, "pending"))));
  const eve = addDaysIso(EXAM_DATE, -1);
  return Array.from({ length: days }, (_, i) => {
    const date = addDaysIso(today, i);
    const due = rounds.filter((r) => (r.scheduledOn < today ? 0 : Math.min(days - 1, diffDaysIso(r.scheduledOn, today))) === i);
    const morning = due.length ? `Review rounds: ${due.map((r) => `${names.get(r.subjectId) ?? r.subjectId} R${r.round}`).join(", ")}` : "Due flashcards + yesterday's error log (20 min)";
    const chs = [weak[i * 2], weak[i * 2 + 1]].filter((c): c is NonNullable<typeof c> => !!c);
    const afternoon = date === eve ? "Pack the bag, lay out clothes, light cheat-sheet read only — nothing new after dinner" : chs.length ? chs.map((c) => `${c.title} (${c.subject}) — light pass: your notes + 10 familiar questions`).join(" · ") : "Mixed familiar questions from cleared chapters — one calm timed set";
    const sheetSubjects = [...new Set(chs.map((c) => c.subject))];
    const evening = date === eve ? "Night-before checklist, screens away 60 min before bed, lights out at the sleep-plan time" : `Read your own cheat-sheets${sheetSubjects.length ? ` (${sheetSubjects.join(", ")})` : ""} · nightly review · wind-down at the sleep-plan time`;
    return { date, daysToExam: daysLeft - i, morning, afternoon, evening, examEve: date === eve };
  });
}

async function breathsDone(db: Db, userId: string): Promise<number> {
  return (await db.select({ n: sql<number>`count(*)::int` }).from(events).where(and(eq(events.userId, userId), eq(events.type, "final.breath"))).limit(1))[0]?.n ?? 0;
}

export async function finalView(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const program = (await programView(db, userId, today));
  const sleepPlan = preExamSleepPlan(EXAM_DATE, { wakeTarget: program.week.wakeTarget, bedTarget: program.week.bedTarget }, cfg.sleep);
  const daysLeft = daysToExam(today);
  return {
    examDate: EXAM_DATE,
    examDateJalali: EXAM_DATE_JALALI,
    daysLeft,
    playbook: PLAYBOOK,
    sleepPlan,
    programWeek: program.week,
    checklist: (await getKv<Record<string, boolean>>(db, userId, CHECKLIST_KEY, {})),
    ascent: {
      active: daysLeft <= 7 || weekNoOf(today) === TOTAL_WEEKS,
      rules: ASCENT_RULES,
      reviewPlan: (await finalReviewPlan(db, userId, today)),
      breathing: BOX_BREATHING,
      grounding: GROUNDING,
      breathsDone: (await breathsDone(db, userId)),
    },
  };
}

export const checklistInput = z.object({ key: z.string().trim().min(1).max(120), done: z.boolean() });

export async function tickChecklist(db: Db, userId: string, input: z.input<typeof checklistInput>, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const p = checklistInput.parse(input);
  const current = (await getKv<Record<string, boolean>>(tx, userId, CHECKLIST_KEY, {}));
  const next = { ...current, [p.key]: p.done };
  (await setKv(tx, userId, CHECKLIST_KEY, next));
  (await appendEvent(tx, { userId, type: "final.checklist", payload: { key: p.key, done: p.done }, gameDay: today }));
  return { checklist: next };
});
}

export const breathInput = z.object({ cycles: z.number().int().min(1).max(30), seconds: z.number().int().min(1).max(1800) });

/** Anxiety toolkit (#112, F-FIN-05): a completed breathing run is logged, never scored. */
export async function logBreath(db: Db, userId: string, input: z.input<typeof breathInput>, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = breathInput.parse(input);
  (await appendEvent(tx, { userId, type: "final.breath", payload: { cycles: d.cycles, seconds: d.seconds }, gameDay: today }));
  return { breathsDone: (await breathsDone(tx, userId)) };
});
}