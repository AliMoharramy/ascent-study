import type { GameConfig } from "@/config/schema";
import { round2 } from "./xp";

/**
 * Sleep Program + Body program (doc 05 §5-6, F-SLP-01, F-BODY-01, T-R2-09).
 * Wake target moves 20 min earlier per *active* week (from week 2) toward 05:30; bedtime follows.
 * Guards → Hold (no shift): avg sleep of the last 3 nights < 6h15, or wake-time spread of the week > 45 min
 * (Friday wakes within ±45 min of the target are graced), or a declared Life Event / illness.
 * Not medical advice — irregular/very short sleep shows a "talk to a professional" note.
 */

export const hm = (m: number) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};
export const mins = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export interface SleepNight {
  date: string; // the morning's game day
  bed: string; // HH:MM
  wake: string; // HH:MM
  weekday?: number; // 0 Sat … 6 Fri
}

export function sleepMinutes(n: { bed: string; wake: string }): number {
  let d = mins(n.wake) - mins(n.bed);
  if (d <= 0) d += 1440;
  return d;
}

export interface HoldCheck {
  hold: boolean;
  reasons: string[];
  avg3h: number | null;
  wakeSpreadMin: number | null;
}

/** Guards for the week's shift. `target` is the current wake target (for the Friday grace). */
export function holdCheck(nights: SleepNight[], targetWake: string, cfg: GameConfig, opts: { lifeEvent?: boolean } = {}): HoldCheck {
  const s = cfg.sleep;
  const reasons: string[] = [];
  const last3 = nights.slice(-3);
  const avg3h = last3.length ? round2(last3.reduce((a, n) => a + sleepMinutes(n), 0) / last3.length / 60) : null;
  if (avg3h !== null && last3.length === 3 && avg3h < s.minSleepHours) reasons.push(`avg sleep of last 3 nights ${avg3h}h < ${s.minSleepHours}h`);
  const t = mins(targetWake);
  const wakes = nights.filter((n) => !(n.weekday === 6 && Math.abs(mins(n.wake) - t) <= s.fridayGraceMinutes)).map((n) => mins(n.wake));
  const wakeSpreadMin = wakes.length >= 2 ? Math.max(...wakes) - Math.min(...wakes) : null;
  if (wakeSpreadMin !== null && wakeSpreadMin > s.maxWakeDeviationMinutes) reasons.push(`wake time varied ${wakeSpreadMin} min this week (> ${s.maxWakeDeviationMinutes})`);
  if (opts.lifeEvent) reasons.push("Life Event / illness declared");
  return { hold: reasons.length > 0, reasons, avg3h, wakeSpreadMin };
}

export interface ProgramWeek {
  week: number;
  wakeTarget: string;
  bedTarget: string;
  hold: boolean;
  reasons: string[];
}

/**
 * Weekly targets. `startWake`/`startBed` = baseline averages (e.g. 08:24 / 01:10). `holds[w]` says whether
 * week w was held (computed at the week's start from the previous week's nights). Only non-held weeks advance.
 */
export function programTargets(startWake: string, startBed: string, weeks: number, holds: Record<number, string[]>, cfg: GameConfig): ProgramWeek[] {
  const s = cfg.sleep;
  const goalWake = mins(s.targetWake);
  const goalBed = mins(s.targetBed) < 12 * 60 ? mins(s.targetBed) + 1440 : mins(s.targetBed);
  let wake = mins(startWake);
  let bed = mins(startBed) < 12 * 60 ? mins(startBed) + 1440 : mins(startBed); // after-midnight bedtimes as 24h+
  const out: ProgramWeek[] = [];
  for (let w = 1; w <= weeks; w++) {
    const reasons = holds[w] ?? [];
    const hold = reasons.length > 0;
    if (w >= s.startWeek && !hold) {
      wake = Math.max(goalWake, wake - s.stepMinutes);
      bed = Math.max(goalBed, bed - s.stepMinutes);
    }
    out.push({ week: w, wakeTarget: hm(wake), bedTarget: hm(bed), hold, reasons });
  }
  return out;
}

export function wakeOnTime(wake: string, target: string, cfg: GameConfig): boolean {
  return mins(wake) <= mins(target) + cfg.sleep.wakeToleranceMinutes;
}

export function bedOnTime(bed: string, target: string, cfg: GameConfig): boolean {
  const norm = (m: number) => (m < 12 * 60 ? m + 1440 : m);
  return norm(mins(bed)) <= norm(mins(target)) + cfg.sleep.bedToleranceMinutes;
}

/** Body program (doc 05 §6): weekly running/walking step; Seed (5 min) on Hold days. */
export function bodyStep(week: number, sleepHold: boolean): { daysPerWeek: number; minutes: number; label: string } {
  if (sleepHold) return { daysPerWeek: 3, minutes: 5, label: "Seed: 5 min walk (sleep program on Hold)" };
  if (week <= 1) return { daysPerWeek: 0, minutes: 0, label: "Baseline: observe only" };
  if (week <= 3) return { daysPerWeek: 3, minutes: 15, label: "3 × 15 min brisk walk / light jog" };
  if (week <= 6) return { daysPerWeek: 4, minutes: 20, label: "4 × 20 min" };
  return { daysPerWeek: 4, minutes: 30, label: "4–5 × 30 min run" };
}

export function sleepConcern(nights: SleepNight[]): string | null {
  const recent = nights.slice(-7);
  if (recent.length >= 5 && recent.filter((n) => sleepMinutes(n) < 300).length >= 3)
    return "Several nights under 5 hours — this program is not medical advice; if this persists, consider talking to a professional.";
  return null;
}
