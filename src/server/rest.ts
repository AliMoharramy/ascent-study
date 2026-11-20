import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { lifeEvents, sleepLogs } from "@/db/schema";
import { bedOnTime, bodyStep, holdCheck, programTargets, sleepConcern, sleepMinutes, wakeOnTime, type SleepNight } from "@/domain/sleep";
import { appendEvent } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { addDaysIso } from "@/i18n/jalali";
import { parseCsvObjects } from "@/lib/csv";
import { weekNoOf, weekStartOf, TOTAL_WEEKS } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";
import { getKv, setKv } from "./kv";
import { weekdaySat } from "./plan";

/** Rest & Body (T-R2-09 / F-SLP-01, F-BODY-01). Not medical advice. */

const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/).transform((s) => s.padStart(5, "0"));
export const sleepInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), bed: hhmm, wake: hhmm });

/** Baseline averages (doc 05 §5: Mi Band month avg 01:10 → 08:24) until the user's own week-1 data exists. */
export const programStart = async (db: Db, userId: string) => (await getKv<{ wake: string; bed: string }>(db, userId, "sleep.start", { wake: "08:24", bed: "01:10" }));

export async function setProgramStart(db: Db, userId: string, wake: string, bed: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  (await setKv(tx, userId, "sleep.start", { wake: hhmm.parse(wake), bed: hhmm.parse(bed) }));
});
}

async function nights(db: Db, userId: string, from: string, to: string): Promise<SleepNight[]> {
  return (await db.select().from(sleepLogs).where(and(eq(sleepLogs.userId, userId), gte(sleepLogs.date, from), lte(sleepLogs.date, to))).orderBy(asc(sleepLogs.date))).map((n) => ({ date: n.date, bed: n.bedAt, wake: n.wakeAt, weekday: weekdaySat(n.date) }));
}

/** Weekly targets with Holds evaluated from the previous week's nights (and Life Events). */
export async function programView(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const start = (await programStart(db, userId));
  const cur = weekNoOf(today);
  const holds: Record<number, string[]> = {};
  const raw = programTargets(start.wake, start.bed, TOTAL_WEEKS, {}, cfg);
  // evaluate holds week by week using the target of the week being judged
  let targets = raw;
  for (let w = cfg.sleep.startWeek; w <= cur; w++) {
    const ws = weekStartOf(w - 1);
    const n = (await nights(db, userId, ws, addDaysIso(ws, 6)));
    const life = (await db.select({ id: lifeEvents.id }).from(lifeEvents).where(and(eq(lifeEvents.userId, userId), gte(lifeEvents.date, ws), lte(lifeEvents.date, addDaysIso(ws, 6))))).length > 0;
    const h = n.length ? holdCheck(n, targets[w - 2]?.wakeTarget ?? start.wake, cfg, { lifeEvent: life }) : { hold: false, reasons: [] };
    if (h.hold) holds[w] = h.reasons;
    targets = programTargets(start.wake, start.bed, TOTAL_WEEKS, holds, cfg);
  }
  const week = targets[cur - 1]!;
  const recent = (await nights(db, userId, addDaysIso(today, -13), today));
  return { start, week, weeks: targets, recent: recent.map((n) => ({ ...n, minutes: sleepMinutes(n), wakeOk: wakeOnTime(n.wake, week.wakeTarget, cfg), bedOk: bedOnTime(n.bed, week.bedTarget, cfg) })), body: bodyStep(cur, week.hold), concern: sleepConcern(recent), enabled: cfg.flags.sleepProgram };
}

export async function logSleep(db: Db, userId: string, input: z.input<typeof sleepInput>, source: "manual" | "csv" = "manual") {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = sleepInput.parse(input);
  const cfg = (await activeConfig(tx, userId));
  const view = (await programView(tx, userId, d.date));
  const minutes = sleepMinutes(d);
  const wakeOk = cfg.flags.sleepProgram && wakeOnTime(d.wake, view.week.wakeTarget, cfg);
  const bedOk = cfg.flags.sleepProgram && bedOnTime(d.bed, view.week.bedTarget, cfg);
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.insert(sleepLogs).values({ id: newId(), userId, date: d.date, bedAt: d.bed, wakeAt: d.wake, minutes, source, createdAt: nowIso() }).onConflictDoUpdate({ target: [sleepLogs.userId, sleepLogs.date], set: { bedAt: d.bed, wakeAt: d.wake, minutes, source } }));
    (await appendEvent(tx, { userId, type: "sleep.logged", payload: { date: d.date, minutes, wakeOnTime: wakeOk, bedOnTime: bedOk, hold: view.week.hold, gameDay: d.date }, gameDay: d.date }));
  }));
  return { minutes, wakeOk, bedOk };
});
}

/** Mi Band / Zepp CSV: columns date,bed,wake (also accepts start/end or sleep/wakeup headers). */

export const csvMappingSchema = z.object({ date: z.string().min(1), bed: z.string().min(1), wake: z.string().min(1) });
export type CsvMapping = z.infer<typeof csvMappingSchema>;

const DATE_KEYS = ["date", "day", "sleep_date", "date_sleep"];
const BED_KEYS = ["bed", "start", "sleep", "bedtime", "sleep_start", "fell_asleep"];
const WAKE_KEYS = ["wake", "end", "wakeup", "wake_time", "wake_up", "sleep_end"];

export function suggestSleepMapping(header: string[]): CsvMapping {
  const pick = (keys: string[], fallback: string) => keys.find((k) => header.includes(k)) ?? header.find((h) => keys.some((k) => h.includes(k))) ?? fallback;
  return { date: pick(DATE_KEYS, "date"), bed: pick(BED_KEYS, "bed"), wake: pick(WAKE_KEYS, "wake") };
}

export interface SleepPreviewRow {
  line: number;
  date: string | null;
  bed: string | null;
  wake: string | null;
  minutes: number | null;
  error: string | null;
  replaces: boolean;
}

/** Column mapping + dry-run preview (#96): nothing is written until the user confirms the import. */
export async function importSleepCsvPreview(db: Db, userId: string, csv: string, mapping?: Partial<CsvMapping>) {
  const { header, rows } = parseCsvObjects(csv);
  const m = { ...suggestSleepMapping(header), ...mapping };
  const existing = new Set((await db.select({ d: sleepLogs.date }).from(sleepLogs).where(eq(sleepLogs.userId, userId))).map((r) => r.d));
  const preview: SleepPreviewRow[] = rows.map((r, i) => {
    const date = r[m.date] ?? null;
    const bedRaw = r[m.bed] ?? null;
    const wakeRaw = r[m.wake] ?? null;
    const p = sleepInput.safeParse({ date, bed: bedRaw?.slice(-5), wake: wakeRaw?.slice(-5) });
    if (!p.success) return { line: i + 2, date, bed: bedRaw, wake: wakeRaw, minutes: null, error: p.error.issues[0]?.message ?? "invalid", replaces: false };
    return { line: i + 2, date: p.data.date, bed: p.data.bed, wake: p.data.wake, minutes: sleepMinutes(p.data), error: null, replaces: existing.has(p.data.date) };
  });
  return { header, mapping: m, preview, ok: preview.filter((p) => !p.error).length, errors: preview.filter((p) => p.error).length, replaces: preview.filter((p) => p.replaces && !p.error).length };
}

export async function importSleepCsv(db: Db, userId: string, csv: string, mapping?: Partial<CsvMapping>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const { preview } = (await importSleepCsvPreview(tx, userId, csv, mapping));
  const errors: string[] = [];
  let ok = 0;
  for (const p of preview) {
    if (p.error || !p.date || !p.bed || !p.wake) {
      errors.push(`row ${p.line}: ${p.error ?? "invalid"}`);
      continue;
    }
    (await logSleep(tx, userId, { date: p.date, bed: p.bed, wake: p.wake }, "csv"));
    ok++;
  }
  if (ok > 0) (await appendEvent(tx, { userId, type: "sleep.imported", payload: { rows: ok, errors: errors.length } }));
  return { ok, errors };
});
}
