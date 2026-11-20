import { sql } from "drizzle-orm";
import { withUserTransaction, queryOne, type Db } from "@/db/client";
import { focusSessions, subjects } from "@/db/schema";
import { appendEvent } from "@/events/store";
import { isValidJalali, jalaliToIso, toEnDigits } from "@/i18n/jalali";
import { parseCsvObjects, toCsv } from "@/lib/csv";
import { newId, nowIso } from "@/lib/ids";
import { localToUtc } from "@/lib/time";
import { saveCheckin, ESCAPE_KINDS } from "./checkins";
import { logTest } from "./tests";

/**
 * Day-0 kit import (T-R0-11 / F-LOG-06): history from the paper/notes template (docs/day0-kit.md) for the
 * days before the site was live. Everything imported is flagged `manual` and earns no XP (doc 09 §3).
 *
 * Columns (header row required; order free; all but `date` optional):
 *   date, wake, bed, study_blocks, study_subject, correct, wrong, blank, test_subject,
 *   energy_morning, energy_noon, energy_night, blocker, escape_minutes, escape_kind, class_attended, note
 * `date` accepts Jalali (1405-08-23, 1405/08/23) or Gregorian (2026-11-14). Persian digits are fine.
 * `study_blocks`: "09:00-10:30; 14:00-15:10" (blocks past midnight like 23:30-00:40 are allowed).
 */

export const DAY0_COLUMNS = [
  "date",
  "wake",
  "bed",
  "study_blocks",
  "study_subject",
  "correct",
  "wrong",
  "blank",
  "test_subject",
  "energy_morning",
  "energy_noon",
  "energy_night",
  "blocker",
  "escape_minutes",
  "escape_kind",
  "class_attended",
  "note",
] as const;

export interface Day0Row {
  line: number;
  date: string; // ISO gregorian
  wake: string | null;
  bed: string | null;
  blocks: { start: string; end: string; minutes: number }[];
  studySubject: string | null;
  tests: { correct: number; wrong: number; blank: number } | null;
  testSubject: string | null;
  energy: [number | null, number | null, number | null];
  blocker: string | null;
  escapeMinutes: number | null;
  escapeKind: (typeof ESCAPE_KINDS)[number] | null;
  classAttended: boolean | null;
  note: string | null;
}

export interface Day0Preview {
  rows: Day0Row[];
  errors: { line: number; message: string }[];
  summary: { days: number; studyMinutes: number; tests: number; checkins: number };
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function normTime(v: string): string | null {
  const t = toEnDigits(v).trim().replace(/[.]/g, ":");
  if (!t) return null;
  const m = t.match(HHMM);
  if (!m) throw new Error(`bad time "${v}" (use HH:MM)`);
  return `${m[1]!.padStart(2, "0")}:${m[2]}`;
}

function normDate(v: string): string {
  const t = toEnDigits(v).trim().replace(/\//g, "-");
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) throw new Error(`bad date "${v}"`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1700) {
    if (!isValidJalali(y, mo, d)) throw new Error(`invalid Jalali date "${v}"`);
    return jalaliToIso(`${y}-${mo}-${d}`);
  }
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime())) throw new Error(`invalid date "${v}"`);
  return iso;
}

const minutesBetween = (a: string, b: string) => {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  let d = bh! * 60 + bm! - (ah! * 60 + am!);
  if (d <= 0) d += 24 * 60; // crosses midnight
  return d;
};

function int(v: string, name: string, min = 0, max = 100_000): number | null {
  const t = toEnDigits(v).trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer ${min}–${max}`);
  return n;
}

function bool(v: string): boolean | null {
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (["1", "y", "yes", "true", "بله", "آره"].includes(t)) return true;
  if (["0", "n", "no", "false", "خیر", "نه"].includes(t)) return false;
  throw new Error(`class_attended must be yes/no`);
}

export async function previewDay0(db: Db, csv: string): Promise<Day0Preview> {
  const { header, rows } = parseCsvObjects(csv);
  const errors: Day0Preview["errors"] = [];
  if (!header.includes("date")) return { rows: [], errors: [{ line: 1, message: "header must contain a 'date' column" }], summary: { days: 0, studyMinutes: 0, tests: 0, checkins: 0 } };
  const unknown = header.filter((h) => !(DAY0_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) errors.push({ line: 1, message: `unknown columns ignored: ${unknown.join(", ")}` });
  const subjectIds = new Set((await db.select({ id: subjects.id }).from(subjects)).map((s) => s.id));
  const subj = (v: string, name: string) => {
    const t = v.trim().toLowerCase();
    if (!t) return null;
    if (subjectIds.size && !subjectIds.has(t)) throw new Error(`${name} "${v}" is not a subject id (${[...subjectIds].join(", ")})`);
    return t;
  };

  const out: Day0Row[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const line = i + 2;
    try {
      const date = normDate(r.date ?? "");
      if (seen.has(date)) throw new Error(`duplicate date ${date}`);
      seen.add(date);
      const blocks = (r.study_blocks ?? "")
        .split(/[;|]/)
        .map((b) => b.trim())
        .filter(Boolean)
        .map((b) => {
          const [s, e] = toEnDigits(b).split(/\s*[-–—]\s*/);
          const start = normTime(s ?? "");
          const end = normTime(e ?? "");
          if (!start || !end) throw new Error(`bad study block "${b}" (use 09:00-10:30)`);
          return { start, end, minutes: minutesBetween(start, end) };
        });
      const correct = int(r.correct ?? "", "correct");
      const wrong = int(r.wrong ?? "", "wrong");
      const blank = int(r.blank ?? "", "blank");
      const tests = correct !== null || wrong !== null || blank !== null ? { correct: correct ?? 0, wrong: wrong ?? 0, blank: blank ?? 0 } : null;
      if (tests && tests.correct + tests.wrong + tests.blank === 0) throw new Error("tests are all zero");
      const ek = (r.escape_kind ?? "").trim().toLowerCase();
      if (ek && !(ESCAPE_KINDS as readonly string[]).includes(ek)) throw new Error(`escape_kind must be one of ${ESCAPE_KINDS.join("/")}`);
      out.push({
        line,
        date,
        wake: normTime(r.wake ?? ""),
        bed: normTime(r.bed ?? ""),
        blocks,
        studySubject: subj(r.study_subject ?? "", "study_subject"),
        tests,
        testSubject: subj(r.test_subject ?? "", "test_subject"),
        energy: [int(r.energy_morning ?? "", "energy_morning", 1, 5), int(r.energy_noon ?? "", "energy_noon", 1, 5), int(r.energy_night ?? "", "energy_night", 1, 5)],
        blocker: r.blocker?.trim() || null,
        escapeMinutes: int(r.escape_minutes ?? "", "escape_minutes", 0, 1440),
        escapeKind: (ek || null) as Day0Row["escapeKind"],
        classAttended: bool(r.class_attended ?? ""),
        note: r.note?.trim() || null,
      });
    } catch (e) {
      errors.push({ line, message: (e as Error).message });
    }
  });
  out.sort((a, b) => a.date.localeCompare(b.date));
  return {
    rows: out,
    errors,
    summary: {
      days: out.length,
      studyMinutes: out.reduce((s, r) => s + r.blocks.reduce((t, b) => t + b.minutes, 0), 0),
      tests: out.reduce((s, r) => s + (r.tests ? r.tests.correct + r.tests.wrong + r.tests.blank : 0), 0),
      checkins: out.filter((r) => r.energy.some((e) => e !== null) || r.blocker || r.escapeMinutes !== null || r.wake || r.bed || r.classAttended !== null || r.note).length,
    },
  };
}

/** Commits a preview (only valid rows). Days that already have manual data are skipped to stay idempotent. */
export async function commitDay0(db: Db, userId: string, preview: Day0Preview, opts: { tz?: string } = {}) {
  return await withUserTransaction(db, userId, async (tx) => {
  const imported: string[] = [];
  const skipped: string[] = [];
  (await withUserTransaction(tx, userId, async (tx) => {
    for (const r of preview.rows) {
      const already = (await queryOne<{ n: number }>(tx, sql`
        SELECT (SELECT count(*)::int FROM focus_sessions WHERE user_id = ${userId} AND game_day = ${r.date} AND manual = true)
             + (SELECT count(*)::int FROM test_logs WHERE user_id = ${userId} AND game_day = ${r.date} AND manual = true)
             + (SELECT count(*)::int FROM daily_checkins WHERE user_id = ${userId} AND date = ${r.date} AND manual = true) AS n`));
      if (already && already.n > 0) {
        skipped.push(r.date);
        continue;
      }
      for (const b of r.blocks) {
        const start = localToUtc(r.date, b.start, opts.tz);
        const end = new Date(start.getTime() + b.minutes * 60_000);
        const id = newId();
        (await tx.insert(focusSessions)
          .values({ id, userId, subjectId: r.studySubject, kind: "other", status: "ended", startedAt: start.toISOString(), endedAt: end.toISOString(), minutes: b.minutes, gameDay: r.date, manual: true, createdAt: nowIso(), updatedAt: nowIso() }));
        (await appendEvent(tx, { userId, type: "focus.stopped", payload: { sessionId: id, minutes: b.minutes, kind: "other", subjectId: r.studySubject, gameDay: r.date, manual: true }, occurredAt: end.toISOString(), source: "import" }));
      }
      if (r.tests) (await logTest(tx, userId, { ...r.tests, subjectId: r.testSubject }, { manual: true, day: r.date, now: localToUtc(r.date, "22:00", opts.tz) }));
      const hasCheckin = r.energy.some((e) => e !== null) || r.blocker || r.escapeMinutes !== null || r.wake || r.bed || r.classAttended !== null || r.note;
      if (hasCheckin)
        (await saveCheckin(
          tx,
          userId,
          { date: r.date, energyMorning: r.energy[0], energyNoon: r.energy[1], energyNight: r.energy[2], blocker: r.blocker, escapeMinutes: r.escapeMinutes, escapeKind: r.escapeKind, classAttended: r.classAttended, wakeAt: r.wake, bedAt: r.bed, note: r.note },
          { manual: true },
        ));
      imported.push(r.date);
    }
    (await appendEvent(tx, { userId, type: "import.day0", payload: { imported, skipped, summary: preview.summary }, source: "import" }));
  }));
  return { imported, skipped };
});
}

export function day0Template(): string {
  return toCsv([
    [...DAY0_COLUMNS],
    ["1405-08-23", "08:20", "01:10", "10:00-11:30; 16:00-17:15", "ai", "12", "4", "2", "foundations", "3", "4", "2", "خستگی بعد از کلاس", "45", "coding", "yes", ""],
  ]);
}
