import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { testLogs } from "@/db/schema";
import { aggregateNetPct, netPct, validateCounts } from "@/domain/tests";
import { appendEvent, EventRequestConflict, replayOf } from "@/events/store";
import { newId, nowIso } from "@/lib/ids";
import { gameDay } from "@/lib/time";

/** Test logging (F-LOG-03). The system never stores questions — only counts and metadata (C18). */

const count = z.coerce.number().int().min(0).max(1000);

export const logTestInput = z
  .object({
    subjectId: z.string().max(40).nullish(),
    chapterId: z.string().max(60).nullish(),
    sourceId: z.string().max(60).nullish(),
    sessionId: z.string().max(40).nullish(),
    correct: count,
    wrong: count,
    blank: count.default(0),
    choices: z.coerce.number().int().min(2).max(10).default(4),
    note: z.string().max(500).nullish(),
    seconds: z.coerce.number().int().min(0).max(86_400).nullish(),
    interleaved: z.boolean().default(false),
    groupId: z.string().max(40).nullish(),
    clientRequestId: z.string().max(80).nullish(),
  })
  .superRefine((v, ctx) => {
    const problem = validateCounts(v);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export type LogTestInput = z.input<typeof logTestInput>;

export async function logTest(db: Db, userId: string, input: LogTestInput, opts: { now?: Date; tz?: string; rolloverHour?: number; manual?: boolean; day?: string } = {}) {
  const { clientRequestId, ...d } = logTestInput.parse(input);
  const now = opts.now ?? new Date();
  const pct = netPct(d);
  const day = opts.day ?? gameDay(now, opts.tz, opts.rolloverHour);
  const lateHours = (now.getTime() - Date.parse(`${day}T23:59:59Z`)) / 3_600_000;
  // What the caller asked for (not what the server derived from the clock): a retry must compare equal to it.
  const request = { ...d, day: opts.day ?? null, manual: !!opts.manual };
  return await withUserTransaction(db, userId, async (tx) => {
    const prior = await replayOf(tx, userId, "test.logged", clientRequestId, request);
    if (prior) {
      const originalId = prior.payload.testLogId;
      const original = typeof originalId === "string" ? (await tx.select().from(testLogs).where(and(eq(testLogs.id, originalId), eq(testLogs.userId, userId))).limit(1))[0] : undefined;
      // A retry whose original log was since undone/deleted must not silently succeed or invent a new log.
      if (!original) throw new EventRequestConflict();
      return original;
    }
    const id = newId();
    await appendEvent(tx, {
      userId,
      type: "test.logged",
      payload: { testLogId: id, subjectId: d.subjectId ?? null, chapterId: d.chapterId ?? null, correct: d.correct, wrong: d.wrong, blank: d.blank, choices: d.choices, netPct: pct, manual: !!opts.manual, gameDay: day, late: !!opts.manual && lateHours > 24, seconds: d.seconds ?? null, interleaved: d.interleaved, groupId: d.groupId ?? null, request },
      occurredAt: now.toISOString(),
      gameDay: day,
      clientRequestId,
      source: opts.manual ? "import" : "app",
    });
    const row: typeof testLogs.$inferInsert = {
      id,
      userId,
      sessionId: d.sessionId ?? null,
      subjectId: d.subjectId ?? null,
      chapterId: d.chapterId ?? null,
      sourceId: d.sourceId ?? null,
      correct: d.correct,
      wrong: d.wrong,
      blank: d.blank,
      choices: d.choices,
      netPct: pct,
      gameDay: day,
      loggedAt: now.toISOString(),
      manual: !!opts.manual,
      seconds: d.seconds ?? null,
      interleaved: d.interleaved,
      groupId: d.groupId ?? null,
      note: d.note ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await tx.insert(testLogs).values(row);
    return (await tx.select().from(testLogs).where(eq(testLogs.id, id)).limit(1))[0]!;
  });
}

export async function deleteTestLog(db: Db, userId: string, id: string): Promise<boolean> {
  return await withUserTransaction(db, userId, async (tx) => {
    const r = (await tx.select().from(testLogs).where(and(eq(testLogs.id, id), eq(testLogs.userId, userId))).limit(1))[0];
    if (!r) return false;
    await tx.delete(testLogs).where(and(eq(testLogs.id, id), eq(testLogs.userId, userId)));
    await appendEvent(tx, { userId, type: "test.deleted", payload: { testLogId: id, targetDay: r.gameDay } });
    return true;
  });
}

export async function testsForDay(db: Db, userId: string, day: string) {
  const rows = await db.select().from(testLogs).where(and(eq(testLogs.userId, userId), eq(testLogs.gameDay, day))).orderBy(desc(testLogs.loggedAt));
  const totals = rows.reduce((t, r) => ({ correct: t.correct + r.correct, wrong: t.wrong + r.wrong, blank: t.blank + r.blank }), { correct: 0, wrong: 0, blank: 0 });
  return { rows, totals, netPct: aggregateNetPct(rows), count: totals.correct + totals.wrong + totals.blank };
}
