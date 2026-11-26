import type { FocusKind } from "@/domain/focus";
import { addDaysIso, isoToJalali, jalaliToIso, weekStartSaturday } from "@/i18n/jalali";
import { DEFAULT_TZ } from "@/lib/time";

export type StudyPeriodKind =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "last_days"
  | "custom";

export interface StudyPeriod {
  kind: StudyPeriodKind;
  startDate: string;
  endDate: string;
  label: string;
  dayCount?: number;
}

export interface StudyReportSession {
  id: string;
  gameDay: string;
  startedAt: string;
  minutes: number | null;
  kind: FocusKind;
  subjectId: string | null;
  subjectName: string | null;
  chapterId: string | null;
  chapterTitle: string | null;
  taskTitle: string | null;
}

export interface StudyReportBreakdown {
  label: string;
  minutes: number;
  sessionCount: number;
}

export interface StudyReport {
  totalMinutes: number;
  sessionCount: number;
  activeDayCount: number;
  averageMinutesPerActiveDay: number;
  byDay: StudyReportBreakdown[];
  bySubject: StudyReportBreakdown[];
  byChapter: StudyReportBreakdown[];
  byKind: StudyReportBreakdown[];
  sessions: StudyReportSession[];
}

export type StudyPeriodResult = { status: "ok"; period: StudyPeriod } | { status: "invalid" };

const pad = (n: number) => String(n).padStart(2, "0");
const invalidPeriod: StudyPeriodResult = { status: "invalid" };

function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹٠-٩]/g, (digit) => {
      const code = digit.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
}

function isGregorianIso(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || month! < 1 || month! > 12 || day! < 1 || day! > 31) return false;
  return new Date(Date.UTC(year!, month! - 1, day!)).toISOString().slice(0, 10) === value;
}

function parseDateToken(value: string): string | null {
  const [year, month, day] = value.split(/[-/]/).map(Number);
  if (!year || !month || !day) return null;
  if (year >= 1300 && year <= 1599) {
    try {
      return jalaliToIso(`${year}-${pad(month)}-${pad(day)}`);
    } catch {
      return null;
    }
  }
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  return isGregorianIso(iso) ? iso : null;
}

function makePeriod(
  kind: StudyPeriodKind,
  startDate: string,
  endDate: string,
  label: string,
  dayCount?: number,
): StudyPeriodResult {
  if (!isGregorianIso(startDate) || !isGregorianIso(endDate) || startDate > endDate) return invalidPeriod;
  return { status: "ok", period: { kind, startDate, endDate, label, ...(dayCount ? { dayCount } : {}) } };
}

/** Resolves common English/Persian requests into inclusive account game-day dates. */
export function parseStudyPeriod(text: string, today: string): StudyPeriodResult {
  if (!isGregorianIso(today)) return invalidPeriod;
  const normalized = normalizeDigits(text).toLowerCase();
  const explicitDates = [...normalized.matchAll(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g)].map((m) =>
    parseDateToken(m[0]),
  );
  if (explicitDates.length > 2 || explicitDates.some((date) => date === null)) return invalidPeriod;
  if (explicitDates.length === 2)
    return makePeriod("custom", explicitDates[0]!, explicitDates[1]!, "custom period");
  if (explicitDates.length === 1)
    return makePeriod("custom", explicitDates[0]!, explicitDates[0]!, "custom date");

  const daysBack =
    normalized.match(/\b(?:last|past|previous)\s+(\d+)\s+days?\b/) ??
    normalized.match(/(\d+)\s*روز\s*(?:اخیر|گذشته|قبل|قبلی)/);
  if (daysBack) {
    const count = Number(daysBack[1]);
    if (!Number.isSafeInteger(count) || count < 1 || count > 3650) return invalidPeriod;
    return makePeriod(
      "last_days",
      addDaysIso(today, 1 - count),
      today,
      count === 1 ? "last day" : `last ${count} days`,
      count,
    );
  }

  if (/\btoday\b|امروز/.test(normalized)) return makePeriod("today", today, today, "today");
  if (/\byesterday\b|دیروز/.test(normalized)) {
    const date = addDaysIso(today, -1);
    return makePeriod("yesterday", date, date, "yesterday");
  }

  const weekStart = weekStartSaturday(today);
  if (/\bthis\s+week\b|این\s*هفته|هفته(?:‌|\s)*جاری/.test(normalized)) {
    return makePeriod("this_week", weekStart, today, "this week");
  }
  if (/\blast\s+week\b|\bprevious\s+week\b|هفته(?:‌|\s)*(?:قبل|پیش|گذشته)/.test(normalized)) {
    const start = addDaysIso(weekStart, -7);
    return makePeriod("last_week", start, addDaysIso(weekStart, -1), "last week");
  }

  const [year, month] = today.split("-").map(Number);
  const monthStart = `${year}-${pad(month!)}-01`;
  if (/\bthis\s+month\b|این\s*ماه|ماه(?:‌|\s)*جاری/.test(normalized)) {
    return makePeriod("this_month", monthStart, today, "this month");
  }
  if (/\blast\s+month\b|\bprevious\s+month\b|ماه(?:‌|\s)*(?:قبل|پیش|گذشته)/.test(normalized)) {
    const end = addDaysIso(monthStart, -1);
    const previousStart = `${end.slice(0, 7)}-01`;
    return makePeriod("last_month", previousStart, end, "last month");
  }

  // Do not silently reinterpret unsupported or malformed time filters as this week.
  if (
    /\b(?:next|previous|past|last|since|from|between|during|after|before|quarter|year|date|month|week|day|today|yesterday|ever|lifetime)\b|\ball[- ]time\b|\ball\s+(?:history|sessions?)\b|از\s+ابتدا|از\s+اول|تمام\s+دوران|کل\s+سابقه|از|تا|تاریخ|ماه|هفته|روز|سال/.test(
      normalized,
    )
  ) {
    return invalidPeriod;
  }
  return makePeriod("this_week", weekStart, today, "this week");
}

function addBreakdown(map: Map<string, StudyReportBreakdown>, key: string, label: string, minutes: number) {
  const current = map.get(key) ?? { label, minutes: 0, sessionCount: 0 };
  current.minutes += minutes;
  current.sessionCount += 1;
  map.set(key, current);
}

function sortedBreakdown(map: Map<string, StudyReportBreakdown>): StudyReportBreakdown[] {
  return [...map.values()].sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label));
}

function newestFirst(a: StudyReportSession, b: StudyReportSession): number {
  return b.gameDay.localeCompare(a.gameDay) || b.startedAt.localeCompare(a.startedAt);
}

/** Derives all displayed metrics from ended sessions already scoped to the requested period. */
export function summarizeStudySessions(sessions: readonly StudyReportSession[]): StudyReport {
  const completed = sessions
    .filter((session) => Number.isInteger(session.minutes) && session.minutes! > 0)
    .sort(newestFirst);
  const byDay = new Map<string, StudyReportBreakdown>();
  const bySubject = new Map<string, StudyReportBreakdown>();
  const byChapter = new Map<string, StudyReportBreakdown>();
  const byKind = new Map<string, StudyReportBreakdown>();
  let totalMinutes = 0;

  for (const session of completed) {
    const minutes = session.minutes!;
    const subject = session.subjectName?.trim() || "Unassigned subject";
    totalMinutes += minutes;
    addBreakdown(byDay, session.gameDay, session.gameDay, minutes);
    addBreakdown(bySubject, session.subjectId || subject, subject, minutes);
    if (session.chapterId || session.chapterTitle?.trim()) {
      const chapter = session.chapterTitle?.trim() || `Chapter ${session.chapterId}`;
      addBreakdown(
        byChapter,
        `${session.subjectId || subject}:${session.chapterId || chapter}`,
        `${subject} › ${chapter}`,
        minutes,
      );
    }
    addBreakdown(byKind, session.kind, session.kind, minutes);
  }

  const activeDayCount = byDay.size;
  return {
    totalMinutes,
    sessionCount: completed.length,
    activeDayCount,
    averageMinutesPerActiveDay: activeDayCount ? Math.round(totalMinutes / activeDayCount) : 0,
    byDay: sortedBreakdown(byDay),
    bySubject: sortedBreakdown(bySubject),
    byChapter: sortedBreakdown(byChapter),
    byKind: sortedBreakdown(byKind),
    sessions: completed,
  };
}

const FA_DIGITS = new Intl.NumberFormat("fa-IR");
const number = (value: number, persian: boolean) => (persian ? FA_DIGITS.format(value) : String(value));

function duration(minutes: number, persian: boolean): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const remaining = total % 60;
  if (persian) {
    if (hours && remaining) return `${number(hours, true)} ساعت و ${number(remaining, true)} دقیقه`;
    if (hours) return `${number(hours, true)} ساعت`;
    return `${number(remaining, true)} دقیقه`;
  }
  if (hours && remaining) return `${hours} h ${remaining} min`;
  if (hours) return `${hours} h`;
  return `${remaining} min`;
}

function displayDate(date: string, persian: boolean): string {
  return persian ? isoToJalali(date) : date;
}

function dateRange(period: StudyPeriod, persian: boolean): string {
  const start = displayDate(period.startDate, persian);
  const end = displayDate(period.endDate, persian);
  return start === end ? start : `${start} – ${end}`;
}

function periodLabel(period: StudyPeriod, persian: boolean): string {
  if (!persian) return period.label;
  switch (period.kind) {
    case "today":
      return "امروز";
    case "yesterday":
      return "دیروز";
    case "this_week":
      return "این هفته";
    case "last_week":
      return "هفته گذشته";
    case "this_month":
      return "این ماه";
    case "last_month":
      return "ماه گذشته";
    case "last_days":
      return `${number(period.dayCount ?? 1, true)} روز اخیر`;
    case "custom":
      return "بازه انتخاب‌شده";
  }
}

function focusKindLabel(kind: string, persian: boolean): string {
  if (!persian) {
    const labels: Record<string, string> = {
      video: "Video",
      tests: "Tests",
      review: "Review",
      analysis: "Analysis",
      forge: "Forge",
      other: "Other",
    };
    return labels[kind] ?? "Other";
  }
  const labels: Record<string, string> = {
    video: "ویدئو",
    tests: "آزمون",
    review: "مرور",
    analysis: "تحلیل",
    forge: "فلش‌کارت",
    other: "سایر",
  };
  return labels[kind] ?? "سایر";
}

function formatTime(value: string, timeZone: string): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "--:--";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: DEFAULT_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant);
  }
}

function plural(count: number, singular: string, pluralWord: string, persian: boolean): string {
  return `${number(count, persian)} ${persian ? pluralWord : count === 1 ? singular : pluralWord}`;
}

function breakdownLines(
  items: StudyReportBreakdown[],
  persian: boolean,
  dates = false,
  limit = 12,
): string[] {
  const shown = items.slice(0, limit).map((item) => {
    const label = dates ? displayDate(item.label, persian) : item.label;
    const sessions = persian
      ? `${number(item.sessionCount, true)} جلسه`
      : plural(item.sessionCount, "session", "sessions", false);
    return `- ${label}: ${duration(item.minutes, persian)} (${sessions})`;
  });
  if (items.length > limit) {
    const omitted = items.length - limit;
    shown.push(persian ? `- ${number(omitted, true)} مورد دیگر` : `- ${omitted} more`);
  }
  return shown;
}

/** Formats a local-only, deterministic report. Session titles/details are never part of remote AI input. */
export function formatStudyReport(
  report: StudyReport,
  period: StudyPeriod,
  opts: { timeZone?: string; persian?: boolean } = {},
): string {
  const persian = opts.persian ?? false;
  const dateText = dateRange(period, persian);
  const label = periodLabel(period, persian);
  if (!report.sessionCount) {
    return persian
      ? `برای ${label} (${dateText}) جلسه تمرکزِ کامل‌شده‌ای ثبت نشده است.`
      : `No completed focus sessions were recorded for ${label} (${dateText}).`;
  }

  const lines = persian
    ? [
        `گزارش مطالعه برای ${label} (${dateText}):`,
        `مجموع: ${duration(report.totalMinutes, true)} در ${plural(report.sessionCount, "session", "جلسه", true)}.`,
        `میانگین: ${number(report.averageMinutesPerActiveDay, true)} دقیقه در هر روز مطالعه (${number(report.activeDayCount, true)} روز).`,
      ]
    : [
        `Study report for ${label} (${dateText}):`,
        `Total: ${duration(report.totalMinutes, false)} across ${plural(report.sessionCount, "completed session", "completed sessions", false)}.`,
        `Average: ${report.averageMinutesPerActiveDay} min per active day (${plural(report.activeDayCount, "study day", "study days", false)}).`,
      ];

  const appendSection = (heading: string, items: StudyReportBreakdown[], dates = false, limit = 12) => {
    if (!items.length) return;
    lines.push(`${heading}:`, ...breakdownLines(items, persian, dates, limit));
  };
  appendSection(persian ? "جمع روزانه" : "Daily totals", report.byDay, true, 31);
  appendSection(persian ? "بر اساس درس" : "By subject", report.bySubject);
  appendSection(persian ? "بر اساس فصل" : "By chapter", report.byChapter);
  appendSection(
    persian ? "بر اساس نوع مطالعه" : "By focus type",
    report.byKind.map((item) => ({ ...item, label: focusKindLabel(item.label, persian) })),
  );

  const timezone = opts.timeZone ?? DEFAULT_TZ;
  const shownSessions = report.sessions.slice(0, 12);
  lines.push(persian ? "جزئیات جلسه‌ها (جدیدترین):" : "Sessions (most recent first):");
  for (const session of shownSessions) {
    const title = session.taskTitle?.trim() || (persian ? "جلسه مطالعه" : "Study session");
    const subject = session.subjectName?.trim();
    const chapter = session.chapterTitle?.trim();
    const detail = [subject, chapter].filter(Boolean).join(" › ");
    const at = `${displayDate(session.gameDay, persian)} ${persian ? "ساعت" : "at"} ${formatTime(session.startedAt, timezone)}`;
    const kind = focusKindLabel(session.kind, persian);
    lines.push(
      `- ${at} — ${title} · ${kind} · ${duration(session.minutes ?? 0, persian)}${detail ? ` · ${detail}` : ""}`,
    );
  }
  if (report.sessions.length > shownSessions.length) {
    const omitted = report.sessions.length - shownSessions.length;
    lines.push(
      persian
        ? `${number(omitted, true)} جلسه قدیمی‌تر در این بازه وجود دارد؛ بازه را محدود کنید تا جزئیات بیشتری ببینید.`
        : `${omitted} older sessions are in this period; narrow the range to see more details.`,
    );
  }
  return lines.join("\n");
}
