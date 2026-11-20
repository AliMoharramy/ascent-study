import { diffDaysIso } from "@/i18n/jalali";

/** Light wellness suite: weekly sleep debt and +5 % habit shaping (issues #88, #96). */

export interface SleepNight {
  date: string;
  minutes: number;
}

/** Debt = hours below target across the last 7 logged nights; never a penalty, only a mirror. */
export function sleepDebt(logs: SleepNight[], targetHours: number, today: string): { debtHours: number; nights: { date: string; shortHours: number }[]; logged: number } {
  const week = logs.filter((l) => diffDaysIso(today, l.date) >= 0 && diffDaysIso(today, l.date) < 7);
  const nights = week.map((l) => ({ date: l.date, shortHours: Math.max(0, targetHours - l.minutes / 60) }));
  return { debtHours: Math.round(nights.reduce((s, n) => s + n.shortHours, 0) * 10) / 10, nights, logged: week.length };
}

/** After 7 consecutive successful days, propose a +5 % step (F-HAB-07). One suggestion per habit at a time. */
export function shapingSuggestion(successDays: string[], today: string, currentTarget: number | null): { streak: number; propose: number | null } {
  const set = new Set(successDays);
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = addDays(today, -i);
    if (set.has(d)) streak++;
    else break;
  }
  if (streak < 7 || currentTarget === null || currentTarget <= 0) return { streak, propose: null };
  const propose = Math.max(currentTarget + 1, Math.round(currentTarget * 1.05));
  return { streak, propose };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
