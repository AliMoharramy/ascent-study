import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { courses, focusSessions, habitLogs, lessons, personalTasks, quests, type FocusKind } from "@/db/schema";
import { FOCUS_KINDS } from "@/domain/focus";
export { FOCUS_KINDS };
import { elapsedMs, FOCUS_BLOCK_MINUTES, FOCUS_BLOCK_MS, focusedMinutes, isFocusBlockDue, pauseTimer, resumeTimer, startTimer, stopTimer, TimerError, type TimerState } from "@/domain/timer";
import { appendEvent, EventRequestConflict, replayOf } from "@/events/store";
import { newId, nowIso } from "@/lib/ids";
import { gameDay, gameDayBounds, localToUtc } from "@/lib/time";
import { setLessonStatus } from "./courses";
import { updatePersonalTask } from "./personalTasks";
import { setQuestTier } from "./quests";

/** Focus session service (F-LOG-01): server-clock timer persisted in `focus_sessions`. */

export const startFocusInput = z.object({
  subjectId: z.string().max(40).nullish(),
  chapterId: z.string().max(60).nullish(),
  taskSource: z.enum(["Today", "Courses", "Mine", "AI"]).nullish(),
  taskId: z.string().max(120).nullish(),
  taskTitle: z.string().trim().min(1).max(200).nullish(),
  kind: z.enum(FOCUS_KINDS).default("video"),
  surge: z.boolean().optional(),
  note: z.string().max(500).nullish(),
  clientRequestId: z.string().max(80).nullish(),
});

type Row = typeof focusSessions.$inferSelect;

const toState = (r: Row): TimerState => ({ status: r.status, startedAt: r.startedAt, pausedAt: r.pausedAt, pausedMs: r.pausedMs, endedAt: r.endedAt });

export interface FocusView {
  id: string;
  kind: FocusKind;
  subjectId: string | null;
  chapterId: string | null;
  taskSource: string | null;
  taskId: string | null;
  taskTitle: string | null;
  taskAutoCompleted: boolean;
  status: Row["status"];
  startedAt: string;
  pausedAt: string | null;
  pausedMs: number;
  elapsedMs: number;
  minutes: number;
  surge: boolean;
  gameDay: string;
  serverNow: string;
}

export function view(r: Row, now = new Date()): FocusView {
  const s = toState(r);
  return {
    id: r.id,
    kind: r.kind,
    subjectId: r.subjectId,
    chapterId: r.chapterId,
    taskSource: r.taskSource,
    taskId: r.taskId,
    taskTitle: r.taskTitle,
    taskAutoCompleted: r.taskAutoCompleted,
    status: r.status,
    startedAt: r.startedAt,
    pausedAt: r.pausedAt,
    pausedMs: r.pausedMs,
    elapsedMs: elapsedMs(s, now),
    minutes: r.minutes ?? focusedMinutes(s, now),
    surge: r.surge,
    gameDay: r.gameDay,
    serverNow: now.toISOString(),
  };
}

export async function openSession(db: Db, userId: string): Promise<Row | undefined> {
  return (await db.select().from(focusSessions).where(and(eq(focusSessions.userId, userId), ne(focusSessions.status, "ended"))).limit(1))[0];
}

export class FocusConflict extends Error {}

async function completeSelectedFocusTask(tx: Db, userId: string, session: Row): Promise<boolean> {
  if (!session.taskSource || !session.taskId) return false;

  if (session.taskSource === "Courses") {
    const lesson = (await tx.select({ id: lessons.id, courseId: lessons.courseId, status: lessons.status })
      .from(lessons)
      .innerJoin(courses, eq(lessons.courseId, courses.id))
      .where(and(eq(lessons.id, session.taskId), eq(courses.userId, userId)))
      .limit(1))[0];
    if (!lesson || lesson.status === "done") return false;
    await setLessonStatus(tx, userId, lesson.id, "done");
    return true;
  }

  if (session.taskSource === "Mine") {
    const task = (await tx.select().from(personalTasks)
      .where(and(eq(personalTasks.id, session.taskId), eq(personalTasks.userId, userId)))
      .limit(1))[0];
    if (!task || task.status === "done") return false;
    await updatePersonalTask(tx, userId, task.id, {
      status: "done",
      clientRequestId: `focus-task-${session.id}`,
    });
    return true;
  }

  if (session.taskSource === "Today") {
    const quest = (await tx.select().from(quests)
      .where(and(eq(quests.id, session.taskId), eq(quests.userId, userId)))
      .limit(1))[0];
    if (!quest || quest.status !== "open") return false;
    let metric: unknown;
    try {
      metric = (JSON.parse(quest.targetJson) as { metric?: unknown }).metric;
    } catch {
      return false;
    }
    if (!quest.habitId && metric !== "check") return false;

    if (quest.habitId) {
      const existingLog = (await tx.select({ tierDone: habitLogs.tierDone })
        .from(habitLogs)
        .where(and(eq(habitLogs.habitId, quest.habitId), eq(habitLogs.userId, userId), eq(habitLogs.date, quest.date)))
        .limit(1))[0];
      if (existingLog?.tierDone === "standard" || existingLog?.tierDone === "stretch") return false;
    }

    if (quest.tierDone === "standard" || quest.tierDone === "stretch") return false;
    await setQuestTier(tx, userId, quest.id, "standard");
    return true;
  }

  return false;
}

async function finishFocusBlock(tx: Db, userId: string, session: Row): Promise<Row> {
  const request = { sessionId: session.id, blockMinutes: FOCUS_BLOCK_MINUTES };
  const clientRequestId = `focus-block-${session.id}`;
  const prior = await replayFocus(tx, userId, "focus.stopped", clientRequestId, request);
  if (prior) {
    const original = (await tx.select().from(focusSessions)
      .where(and(eq(focusSessions.id, session.id), eq(focusSessions.userId, userId)))
      .limit(1))[0];
    if (!original || original.status !== "ended") throw new FocusConflict("The completed focus block is inconsistent — refresh and try again");
    return original;
  }

  const endedAt = new Date(Date.parse(session.startedAt) + session.pausedMs + FOCUS_BLOCK_MS);
  const state = stopTimer(toState(session), endedAt);
  const taskAutoCompleted = await completeSelectedFocusTask(tx, userId, session);
  const minutes = focusedMinutes(state, endedAt);
  await tx.update(focusSessions)
    .set({
      status: state.status,
      pausedAt: state.pausedAt,
      pausedMs: state.pausedMs,
      endedAt: state.endedAt,
      minutes,
      taskAutoCompleted,
      updatedAt: endedAt.toISOString(),
    })
    .where(and(eq(focusSessions.id, session.id), eq(focusSessions.userId, userId)));
  await appendEvent(tx, {
    userId,
    type: "focus.stopped",
    payload: {
      sessionId: session.id,
      minutes,
      kind: session.kind,
      subjectId: session.subjectId,
      chapterId: session.chapterId,
      surge: session.surge,
      gameDay: session.gameDay,
      blockMinutes: FOCUS_BLOCK_MINUTES,
      taskAutoCompleted,
      request,
    },
    occurredAt: endedAt.toISOString(),
    clientRequestId,
  });
  return (await tx.select().from(focusSessions).where(eq(focusSessions.id, session.id)).limit(1))[0]!;
}

/** A reused request key is a conflict from the caller's point of view, like any other focus conflict. */
async function replayFocus(tx: Db, userId: string, type: "focus.started" | "focus.manual" | "focus.stopped", clientRequestId: string | null | undefined, request: Record<string, unknown>) {
  try {
    return await replayOf(tx, userId, type, clientRequestId, request);
  } catch (error) {
    if (error instanceof EventRequestConflict) throw new FocusConflict(error.message);
    throw error;
  }
}

export async function startFocus(db: Db, userId: string, input: z.input<typeof startFocusInput> | Record<string, unknown>, opts: { tz?: string; rolloverHour?: number; now?: Date } = {}): Promise<Row> {
  const { clientRequestId, ...data } = startFocusInput.parse(input);
  const now = opts.now ?? new Date();
  const request = { ...data, surge: !!data.surge };
  return await withUserTransaction(db, userId, async (tx) => {
    // A retried start (even after the session was stopped) returns the original session instead of a new one.
    const prior = await replayFocus(tx, userId, "focus.started", clientRequestId, request);
    if (prior) {
      const original = typeof prior.payload.sessionId === "string"
        ? (await tx.select().from(focusSessions).where(and(eq(focusSessions.id, prior.payload.sessionId), eq(focusSessions.userId, userId))).limit(1))[0]
        : undefined;
      if (!original) throw new FocusConflict("That session no longer exists — start a new one");
      return original;
    }
    const open = await openSession(tx, userId);
    if (open) throw new FocusConflict("A session is already running — stop it first");
    const s = startTimer(now);
    const id = newId();
    const row: typeof focusSessions.$inferInsert = {
      id,
      userId,
      subjectId: data.subjectId ?? null,
      chapterId: data.chapterId ?? null,
      taskSource: data.taskSource ?? null,
      taskId: data.taskId ?? null,
      taskTitle: data.taskTitle ?? null,
      kind: data.kind,
      status: s.status,
      startedAt: s.startedAt,
      pausedMs: 0,
      gameDay: gameDay(now, opts.tz, opts.rolloverHour),
      surge: !!data.surge,
      note: data.note ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await tx.insert(focusSessions).values(row);
    await appendEvent(tx, { userId, type: "focus.started", payload: { sessionId: id, kind: data.kind, subjectId: row.subjectId, chapterId: row.chapterId, surge: row.surge, request }, occurredAt: s.startedAt, clientRequestId });
    return (await tx.select().from(focusSessions).where(eq(focusSessions.id, id)).limit(1))[0]!;
  });
}

async function transition(db: Db, userId: string, op: "pause" | "resume" | "stop", now = new Date()): Promise<Row> {
  return await withUserTransaction(db, userId, async (tx) => {
    const r = await openSession(tx, userId);
    if (!r) throw new TimerError("No running session");
    const current = toState(r);
    if (isFocusBlockDue(current.status, elapsedMs(current, now))) return await finishFocusBlock(tx, userId, r);
    const fn = op === "pause" ? pauseTimer : op === "resume" ? resumeTimer : stopTimer;
    const s = fn(current, now);
    const minutes = s.status === "ended" ? focusedMinutes(s, now) : null;
    await tx.update(focusSessions)
      .set({ status: s.status, pausedAt: s.pausedAt, pausedMs: s.pausedMs, endedAt: s.endedAt, minutes, taskAutoCompleted: false, updatedAt: nowIso() })
      .where(eq(focusSessions.id, r.id));
    const type = op === "pause" ? "focus.paused" : op === "resume" ? "focus.resumed" : "focus.stopped";
    await appendEvent(tx, { userId, type, payload: { sessionId: r.id, ...(minutes !== null ? { minutes, kind: r.kind, subjectId: r.subjectId, chapterId: r.chapterId, surge: r.surge, gameDay: r.gameDay } : {}) }, occurredAt: now.toISOString() });
    return (await tx.select().from(focusSessions).where(eq(focusSessions.id, r.id)).limit(1))[0]!;
  });
}

export async function completeFocusBlock(db: Db, userId: string, sessionId: string, now = new Date()): Promise<{ session: Row; blockCompleted: boolean; taskAutoCompleted: boolean }> {
  return await withUserTransaction(db, userId, async (tx) => {
    const current = await openSession(tx, userId);
    if (!current || current.id !== sessionId) {
      const prior = (await tx.select().from(focusSessions)
        .where(and(eq(focusSessions.id, sessionId), eq(focusSessions.userId, userId)))
        .limit(1))[0];
      if (prior?.status === "ended") {
        const blockCompleted = !prior.manual && (prior.minutes ?? 0) >= FOCUS_BLOCK_MINUTES;
        return { session: prior, blockCompleted, taskAutoCompleted: prior.taskAutoCompleted };
      }
      if (current) throw new FocusConflict("The active focus session changed before the block completed");
      throw new TimerError("No running session");
    }

    const state = toState(current);
    if (!isFocusBlockDue(state.status, elapsedMs(state, now))) {
      return { session: current, blockCompleted: false, taskAutoCompleted: false };
    }

    const session = await finishFocusBlock(tx, userId, current);
    return { session, blockCompleted: true, taskAutoCompleted: session.taskAutoCompleted };
  });
}

export const pauseFocus = (db: Db, userId: string, now?: Date) => transition(db, userId, "pause", now);
export const resumeFocus = (db: Db, userId: string, now?: Date) => transition(db, userId, "resume", now);
export const stopFocus = (db: Db, userId: string, now?: Date) => transition(db, userId, "stop", now);

/** Throws away an accidental session (no minutes recorded). */
export async function discardFocus(db: Db, userId: string, now = new Date()): Promise<{ session: Row | null; blockCompleted: boolean; taskAutoCompleted: boolean }> {
  return await withUserTransaction(db, userId, async (tx) => {
    const r = await openSession(tx, userId);
    if (!r) return { session: null, blockCompleted: false, taskAutoCompleted: false };
    const state = toState(r);
    if (isFocusBlockDue(state.status, elapsedMs(state, now))) {
      const session = await finishFocusBlock(tx, userId, r);
      return { session, blockCompleted: true, taskAutoCompleted: session.taskAutoCompleted };
    }
    await tx.delete(focusSessions).where(eq(focusSessions.id, r.id));
    await appendEvent(tx, { userId, type: "focus.discarded", payload: { sessionId: r.id } });
    return { session: null, blockCompleted: false, taskAutoCompleted: false };
  });
}

export async function sessionsForDay(db: Db, userId: string, day: string): Promise<Row[]> {
  return await db.select().from(focusSessions).where(and(eq(focusSessions.userId, userId), eq(focusSessions.gameDay, day))).orderBy(desc(focusSessions.startedAt));
}

export async function minutesForDay(db: Db, userId: string, day: string, now = new Date()): Promise<number> {
  return (await sessionsForDay(db, userId, day)).reduce((sum, r) => sum + (r.status === "ended" ? (r.minutes ?? 0) : focusedMinutes(toState(r), now)), 0);
}

// ── R1: idle detection, manual entry (F-LOG-06/07) ───────────

/** Client saw no interaction for `idleMinutes` → pause and count it (anti-gaming, doc 04 §11). */
export async function idlePause(db: Db, userId: string, now = new Date()) {
  return await withUserTransaction(db, userId, async (tx) => {
    const r = await openSession(tx, userId);
    if (!r || r.status !== "running") return null;
    const paused = await pauseFocus(tx, userId, now);
    if (paused.status === "ended") return paused;
    await tx.update(focusSessions).set({ idlePauses: r.idlePauses + 1 }).where(eq(focusSessions.id, r.id));
    await appendEvent(tx, { userId, type: "focus.idle", payload: { sessionId: r.id } });
    return paused;
  });
}

export const manualFocusInput = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  minutes: z.coerce.number().int().min(1).max(600),
  kind: z.enum(FOCUS_KINDS).default("other"),
  subjectId: z.string().max(40).nullish(),
  chapterId: z.string().max(60).nullish(),
  note: z.string().max(500).nullish(),
  clientRequestId: z.string().max(80).nullish(),
});

/** Manual entry: tagged `manual`; entries made > 24h after the day ended earn 50 % XP (projection). */
export async function manualFocus(db: Db, userId: string, input: z.input<typeof manualFocusInput>, opts: { tz?: string; rolloverHour?: number; now?: Date } = {}) {
  const { clientRequestId, ...d } = manualFocusInput.parse(input);
  const now = opts.now ?? new Date();
  const start = localToUtc(d.day, d.start, opts.tz);
  const end = new Date(start.getTime() + d.minutes * 60_000);
  if (end.getTime() > now.getTime() + 60_000) throw new TimerError("A manual entry can't end in the future");
  const dayEnd = gameDayBounds(d.day, opts.tz, opts.rolloverHour).end;
  const late = (now.getTime() - dayEnd.getTime()) / 3_600_000 > 24;
  return await withUserTransaction(db, userId, async (tx) => {
    // A retry returns the original result; reusing the key for different input is a conflict.
    const prior = await replayFocus(tx, userId, "focus.manual", clientRequestId, d);
    if (prior) {
      const sessionId = prior.payload.sessionId;
      if (typeof sessionId !== "string") throw new FocusConflict("That entry no longer exists");
      return { id: sessionId, late: prior.payload.late === true, eventId: prior.id };
    }
    const id = newId();
    const ev = await appendEvent(tx, { userId, type: "focus.manual", payload: { sessionId: id, minutes: d.minutes, kind: d.kind, subjectId: d.subjectId ?? null, chapterId: d.chapterId ?? null, gameDay: d.day, late, request: d }, gameDay: d.day, occurredAt: end.toISOString(), clientRequestId });
    await tx.insert(focusSessions).values({ id, userId, subjectId: d.subjectId ?? null, chapterId: d.chapterId ?? null, kind: d.kind, status: "ended", startedAt: start.toISOString(), endedAt: end.toISOString(), pausedMs: 0, minutes: d.minutes, gameDay: d.day, manual: true, note: d.note ?? null, createdAt: nowIso(), updatedAt: nowIso() });
    return { id, late, eventId: ev.id };
  });
}
