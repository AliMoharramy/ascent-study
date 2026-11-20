import { addDaysIso, diffDaysIso, jalaliToIso } from "@/i18n/jalali";

/** Plan lock uses the earliest reported exam date for the exam (T-DATA-01). */
export const EXAM_DATE_JALALI = "1406-02-16";
export const EXAM_DATE = jalaliToIso(EXAM_DATE_JALALI); // 2027-05-06
export const PROJECT_START = "2026-11-20"; // 1405-08-29 — Day 1: the day the user actually starts (production launch)
export const CAMPAIGN_DAYS = diffDaysIso(EXAM_DATE, PROJECT_START); // 167

export function campaignDay(today: string): number {
  return Math.min(CAMPAIGN_DAYS, Math.max(1, diffDaysIso(today, PROJECT_START) + 1));
}

export function daysToExam(today: string): number {
  return Math.max(0, diffDaysIso(EXAM_DATE, today));
}

export function campaignWeek(today: string): number {
  return Math.max(1, Math.ceil(campaignDay(today) / 7));
}

/** Week 1 = Saturday 23 Aban 1405 (doc 03 §1); weeks are Saturday-based and numbered 1..25. */
export const WEEK1_START = "2026-11-14";
export const TOTAL_WEEKS = 25;

export function weekNoOf(day: string): number {
  return Math.max(1, Math.min(TOTAL_WEEKS, Math.floor(diffDaysIso(day, WEEK1_START) / 7) + 1));
}

export function weekStartOf(no: number): string {
  return addDaysIso(WEEK1_START, (no - 1) * 7);
}
