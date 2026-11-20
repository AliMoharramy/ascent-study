import { toEnDigits } from "@/i18n/jalali";

/**
 * Lesson-list parser for paste/CSV import (F-DATA-02/04). Accepts, one lesson per line:
 *   "12. Trees and heaps — 1:02:15"     "Trees and heaps\t45:10"     "12,Trees and heaps,45:10"
 *   "جلسه ۳ - درخت‌ها (۴۵:۱۰)"            "Trees 45 min"                 "no,title,duration" header (skipped)
 * Duration formats: h:mm:ss, mm:ss, "45 min"/"45m"/"45 دقیقه". Persian digits are accepted.
 */

export interface ParsedLesson {
  no: number;
  title: string;
  durationMin: number;
  line: number;
}

export interface ParseResult {
  lessons: ParsedLesson[];
  errors: { line: number; text: string; message: string }[];
  totalMin: number;
}

const CLOCK = /(\d{1,2}):(\d{2})(?::(\d{2}))?/;
const MINUTES = /(\d+(?:\.\d+)?)\s*(?:minutes|mins|min|m|دقیقه)(?![a-z])/i;

export function parseDuration(text: string): number | null {
  const t = toEnDigits(text);
  const c = t.match(CLOCK);
  if (c) {
    const a = Number(c[1]);
    const b = Number(c[2]);
    if (c[3] !== undefined) return round1(a * 60 + b + Number(c[3]) / 60); // h:mm:ss
    return round1(a + b / 60); // mm:ss
  }
  const m = t.match(MINUTES);
  return m ? Number(m[1]) : null;
}

const round1 = (n: number) => Math.round(n * 1000) / 1000; // keeps whole seconds exact

export function formatMinutes(min: number): string {
  const total = Math.round(min * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function parseLessonList(input: string): ParseResult {
  const lessons: ParsedLesson[] = [];
  const errors: ParseResult["errors"] = [];
  const lines = input.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const text = raw.trim();
    if (!text) return;
    if (/^(no|#|n)\s*[,\t;]\s*title/i.test(text)) return; // header
    let no: number | null = null;
    let title = "";
    let duration: number | null = null;

    const cells = text.includes("\t") ? text.split("\t") : text.split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/);
    if (cells.length >= 3 && /^\s*[\d۰-۹]+\s*$/.test(cells[0]!)) {
      no = Number(toEnDigits(cells[0]!.trim()));
      title = cells.slice(1, -1).join(", ").replace(/^"|"$/g, "").trim();
      duration = parseDuration(cells.at(-1)!);
    } else if (cells.length === 2 && parseDuration(cells[1]!) !== null) {
      title = cells[0]!.trim();
      duration = parseDuration(cells[1]!);
    } else {
      const en = toEnDigits(text);
      const clock = en.match(new RegExp(`${CLOCK.source}(?!.*${CLOCK.source})`));
      const mins = clock ? null : en.match(MINUTES);
      duration = clock ? parseDuration(clock[0]) : mins ? Number(mins[1]) : null;
      let rest = clock ? en.replace(clock[0], "") : mins ? en.replace(mins[0], "") : en;
      const lead = rest.match(/^\s*(?:جلسه|قسمت|lesson|session|part|ep\.?)?\s*(\d+)\s*[.):\-–—]?\s*/i);
      if (lead && lead[1]) {
        no = Number(lead[1]);
        rest = rest.slice(lead[0].length);
      }
      title = rest
        .replace(/\(\s*\)\s*$/g, "")
        .replace(/[\s\-–—|:,(]+$/g, "")
        .replace(/^[\s\-–—|:]+/, "")
        .trim();
    }

    if (!title) title = `Lesson ${no ?? lessons.length + 1}`;
    if (duration === null || Number.isNaN(duration)) {
      errors.push({ line: lineNo, text, message: "no duration found (use mm:ss, h:mm:ss or '45 min')" });
      return;
    }
    if (duration <= 0 || duration > 600) {
      errors.push({ line: lineNo, text, message: `duration ${duration} min looks wrong` });
      return;
    }
    lessons.push({ no: no ?? lessons.length + 1, title: title.slice(0, 200), durationMin: duration, line: lineNo });
  });

  // renumber if numbers are missing or duplicated
  const nos = lessons.map((l) => l.no);
  if (new Set(nos).size !== nos.length) lessons.forEach((l, i) => (l.no = i + 1));
  return { lessons, errors, totalMin: round1(lessons.reduce((s, l) => s + l.durationMin, 0)) };
}

/** Long totals: "56h 29m" (lesson lengths keep mm:ss via formatMinutes). */
export function formatHours(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}
