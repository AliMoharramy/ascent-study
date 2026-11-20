/**
 * Focus-session timer state machine (F-LOG-01). Pure: all timestamps come from the server clock,
 * so a session survives refreshes/closed tabs — the client only renders `elapsedMs(state, now)`.
 *
 *   start ──► running ──pause──► paused ──resume──► running ──stop──► ended
 *                 └──────────────────stop──────────────────────────────┘
 */

export type TimerStatus = "running" | "paused" | "ended";

export interface TimerState {
  status: TimerStatus;
  startedAt: string; // ISO
  pausedAt: string | null; // ISO while paused
  pausedMs: number; // accumulated paused time
  endedAt: string | null;
}

export class TimerError extends Error {}

const t = (iso: string) => new Date(iso).getTime();

export function startTimer(now: Date): TimerState {
  return { status: "running", startedAt: now.toISOString(), pausedAt: null, pausedMs: 0, endedAt: null };
}

export function pauseTimer(s: TimerState, now: Date): TimerState {
  if (s.status !== "running") throw new TimerError(`Cannot pause a ${s.status} session`);
  return { ...s, status: "paused", pausedAt: now.toISOString() };
}

export function resumeTimer(s: TimerState, now: Date): TimerState {
  if (s.status !== "paused" || !s.pausedAt) throw new TimerError(`Cannot resume a ${s.status} session`);
  const extra = Math.max(0, now.getTime() - t(s.pausedAt));
  return { ...s, status: "running", pausedAt: null, pausedMs: s.pausedMs + extra };
}

export function stopTimer(s: TimerState, now: Date): TimerState {
  if (s.status === "ended") throw new TimerError("Session already ended");
  const resumed = s.status === "paused" ? resumeTimer(s, now) : s;
  return { ...resumed, status: "ended", endedAt: now.toISOString() };
}

/** Active (non-paused) milliseconds so far. */
export function elapsedMs(s: TimerState, now: Date): number {
  const end = s.status === "ended" && s.endedAt ? t(s.endedAt) : s.status === "paused" && s.pausedAt ? t(s.pausedAt) : now.getTime();
  return Math.max(0, end - t(s.startedAt) - s.pausedMs);
}

/** Whole focused minutes (floor) — what gets stored and earns XP. */
export function focusedMinutes(s: TimerState, now: Date): number {
  return Math.floor(elapsedMs(s, now) / 60_000);
}

/** Sessions longer than this are almost certainly a forgotten timer; the UI asks to trim. */
export const MAX_SESSION_MINUTES = 6 * 60;

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
