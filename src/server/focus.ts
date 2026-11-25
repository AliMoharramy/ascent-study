import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { focusSessions, type FocusKind } from "@/db/schema";
import { FOCUS_KINDS } from "@/domain/focus";
export { FOCUS_KINDS };
import { elapsedMs, focusedMinutes, pauseTimer, resumeTimer, startTimer, stopTimer, TimerError, type TimerState } from "@/domain/timer";
import { appendEvent, EventRequestConflict, replayOf } from "@/events/store";
import { newId, nowIso } from "@/lib/ids";
import { gameDay, gameDayBounds, localToUtc } from "@/lib/time";

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

/** A reused request key is a conflict from the caller's point of view, like any other focus conflict. */
async function replayFocus(tx: Db, userId: string, type: "focus.started" | "focus.manual", clientRequestId: string | null | undefined, request: Record<string, unknown>) {
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
    const fn = op === "pause" ? pauseTimer : op === "resume" ? resumeTimer : stopTimer;
    const s = fn(toState(r), now);
    const minutes = s.status === "ended" ? focusedMinutes(s, now) : null;
    await tx.update(focusSessions)
      .set({ status: s.status, pausedAt: s.pausedAt, pausedMs: s.pausedMs, endedAt: s.endedAt, minutes, updatedAt: nowIso() })
      .where(eq(focusSessions.id, r.id));
    const type = op === "pause" ? "focus.paused" : op === "resume" ? "focus.resumed" : "focus.stopped";
    await appendEvent(tx, { userId, type, payload: { sessionId: r.id, ...(minutes !== null ? { minutes, kind: r.kind, subjectId: r.subjectId, chapterId: r.chapterId, surge: r.surge, gameDay: r.gameDay } : {}) }, occurredAt: now.toISOString() });
    return (await tx.select().from(focusSessions).where(eq(focusSessions.id, r.id)).limit(1))[0]!;
  });
}

export const pauseFocus = (db: Db, userId: string, now?: Date) => transition(db, userId, "pause", now);
export const resumeFocus = (db: Db, userId: string, now?: Date) => transition(db, userId, "resume", now);
export const stopFocus = (db: Db, userId: string, now?: Date) => transition(db, userId, "stop", now);

/** Throws away an accidental session (no minutes recorded). */
export async function discardFocus(db: Db, userId: string): Promise<void> {
  await withUserTransaction(db, userId, async (tx) => {
    const r = await openSession(tx, userId);
    if (!r) return;
    await tx.delete(focusSessions).where(eq(focusSessions.id, r.id));
    await appendEvent(tx, { userId, type: "focus.discarded", payload: { sessionId: r.id } });
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
