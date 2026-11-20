import type { GameConfig } from "@/config/schema";
import { round2 } from "./xp";

/**
 * Capacity model (doc 03 §2, T-R1-07 / F-PLAN-01/02). Weekly time windows + per-date exceptions give the raw
 * hours; a focus factor (moving average of the last N weeks of real focus ÷ raw, else the config default)
 * turns them into study hours. Three scenarios are always shown.
 */

/** weekday: 0 = Saturday … 6 = Friday (Saturday-based week). */
export interface TimeWindow {
  weekday: number;
  start: string; // HH:MM
  end: string; // HH:MM (may be < start → crosses midnight)
}

export interface DayException {
  date: string; // ISO
  minutes: number; // raw available minutes that day (0 = unavailable)
  reason?: string;
}

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function windowMinutes(w: TimeWindow): number {
  const d = toMin(w.end) - toMin(w.start);
  return d >= 0 ? d : d + 1440;
}

export function rawMinutesForWeekday(windows: TimeWindow[], weekday: number): number {
  return windows.filter((w) => w.weekday === weekday).reduce((s, w) => s + windowMinutes(w), 0);
}

export function rawWeeklyHours(windows: TimeWindow[]): number {
  return round2(windows.reduce((s, w) => s + windowMinutes(w), 0) / 60);
}

/** Saturday-based weekday of an ISO date. */
export function weekdaySat(iso: string): number {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return (d + 1) % 7;
}

/** The user's declared week (doc 03 §2): Sat 4h, Sun 10–17, Mon free (≈8h), Tue 12–20, Wed/Thu 14–20, Fri ≈6h → 45h raw. */
export const SAMPLE_WINDOWS: TimeWindow[] = [
  { weekday: 0, start: "14:00", end: "18:00" },
  { weekday: 1, start: "10:00", end: "17:00" },
  { weekday: 2, start: "09:00", end: "17:00" },
  { weekday: 3, start: "12:00", end: "20:00" },
  { weekday: 4, start: "14:00", end: "20:00" },
  { weekday: 5, start: "14:00", end: "20:00" },
  { weekday: 6, start: "09:00", end: "15:00" },
];

/**
 * Moving focus factor: Σ real focus minutes ÷ Σ raw window minutes over the last `movingWeeks` complete weeks.
 * Weeks with no data are skipped; no data at all → config default (0.65 base scenario).
 */
export function focusFactor(weeks: { focusMinutes: number; rawMinutes: number }[], cfg: GameConfig): { factor: number; source: "measured" | "default"; weeks: number } {
  const used = weeks.filter((w) => w.rawMinutes > 0 && w.focusMinutes > 0).slice(-cfg.capacity.movingWeeks);
  if (used.length === 0) return { factor: cfg.capacity.defaultFocusFactor, source: "default", weeks: 0 };
  const f = used.reduce((s, w) => s + w.focusMinutes, 0) / used.reduce((s, w) => s + w.rawMinutes, 0);
  return { factor: round2(Math.max(0.05, Math.min(1, f))), source: "measured", weeks: used.length };
}

export interface Scenario {
  key: "cautious" | "base" | "optimistic" | "measured";
  factor: number;
  hours: number;
}

export function scenarios(windows: TimeWindow[], cfg: GameConfig, measured?: number | null): Scenario[] {
  const raw = rawWeeklyHours(windows);
  const s = cfg.capacity.scenarios;
  const out: Scenario[] = [
    { key: "cautious", factor: s.cautious, hours: round2(raw * s.cautious) },
    { key: "base", factor: s.base, hours: round2(raw * s.base) },
    { key: "optimistic", factor: s.optimistic, hours: round2(raw * s.optimistic) },
  ];
  if (measured != null) out.push({ key: "measured", factor: measured, hours: round2(raw * measured) });
  return out;
}

/** Study minutes available on a date: raw (window or exception) × factor; Life Event → Seed-only (0 planned). */
export function dayCapacityMinutes(date: string, windows: TimeWindow[], exceptions: DayException[], factor: number, opts: { lifeEvent?: boolean } = {}): number {
  if (opts.lifeEvent) return 0;
  const ex = exceptions.find((e) => e.date === date);
  const raw = ex ? ex.minutes : rawMinutesForWeekday(windows, weekdaySat(date));
  return Math.round(raw * factor);
}

/** Study hours of a week (7 days from `weekStart`), honouring exceptions. */
export function weekCapacityHours(weekStart: string, windows: TimeWindow[], exceptions: DayException[], factor: number, addDays: (iso: string, n: number) => string): number {
  let m = 0;
  for (let i = 0; i < 7; i++) m += dayCapacityMinutes(addDays(weekStart, i), windows, exceptions, factor);
  return round2(m / 60);
}
