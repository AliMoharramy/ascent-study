/**
 * Jalali (Solar Hijri) ↔ Gregorian conversion — pure, dependency-free.
 * Algorithm: the "jalaali-js" arithmetic (Borkowski) based on the 2820-year breaks table,
 * correct for 1..3177 AP. Week starts on Saturday (شنبه).
 */

export interface JDate {
  jy: number;
  jm: number; // 1..12
  jd: number; // 1..31
}

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456,
  3178,
];

const div = (a: number, b: number) => Math.trunc(a / b);
const mod = (a: number, b: number) => a - Math.trunc(a / b) * b;

function jalCal(jy: number) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0]!;
  let jump = 0;
  if (jy < jp || jy >= BREAKS[bl - 1]!) throw new RangeError(`Invalid Jalali year ${jy}`);
  let i = 1;
  for (; i < bl; i += 1) {
    const jm = BREAKS[i]!;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number) {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number): JDate {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export function isLeapJalaliYear(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaliYear(jy) ? 30 : 29;
}

export function isValidJalali(jy: number, jm: number, jd: number): boolean {
  return jy >= -61 && jy <= 3177 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= jalaliMonthLength(jy, jm);
}

/** Gregorian Y-M-D → Jalali. */
export function toJalali(gy: number, gm: number, gd: number): JDate {
  return d2j(g2d(gy, gm, gd));
}

/** Jalali → Gregorian Y-M-D. */
export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  if (!isValidJalali(jy, jm, jd)) throw new RangeError(`Invalid Jalali date ${jy}-${jm}-${jd}`);
  return d2g(j2d(jy, jm, jd));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-13" → "1405-08-22" */
export function isoToJalali(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const j = toJalali(y!, m!, d!);
  return `${j.jy}-${pad(j.jm)}-${pad(j.jd)}`;
}

/** "1405-08-22" (also accepts "1405/08/22") → "2026-11-13" */
export function jalaliToIso(jalali: string): string {
  const [y, m, d] = jalali.split(/[-/]/).map(Number);
  const g = toGregorian(y!, m!, d!);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

export const JALALI_MONTHS_FA = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;

export const JALALI_MONTHS_EN = [
  "Farvardin",
  "Ordibehesht",
  "Khordad",
  "Tir",
  "Mordad",
  "Shahrivar",
  "Mehr",
  "Aban",
  "Azar",
  "Dey",
  "Bahman",
  "Esfand",
] as const;

/** Weekday names starting on Saturday (index 0 = Saturday). */
export const WEEKDAYS_FA = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"] as const;
export const WEEKDAYS_EN = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/** Saturday-based weekday index (0 = Sat … 6 = Fri) of a Gregorian ISO date. */
export function weekdayIndexSatFirst(iso: string): number {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return (dow + 1) % 7;
}

/** ISO date of the Saturday that starts the week containing `iso`. */
export function weekStartSaturday(iso: string): string {
  const idx = weekdayIndexSatFirst(iso);
  return addDaysIso(iso, -idx);
}

export function addDaysIso(iso: string, days: number): string {
  const t = new Date(`${iso}T12:00:00Z`).getTime() + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function diffDaysIso(a: string, b: string): number {
  return Math.round(
    (new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000,
  );
}

/** "1405-08-22" → "22 Aban 1405" / "۲۲ آبان ۱۴۰۵" */
export function formatJalali(iso: string, locale: "en" | "fa" = "en"): string {
  const [y, m, d] = iso.split("-").map(Number);
  const j = toJalali(y!, m!, d!);
  if (locale === "fa") return toFaDigits(`${j.jd} ${JALALI_MONTHS_FA[j.jm - 1]} ${j.jy}`);
  return `${j.jd} ${JALALI_MONTHS_EN[j.jm - 1]} ${j.jy}`;
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export function toFaDigits(s: string | number): string {
  return String(s).replace(/\d/g, (d) => FA_DIGITS[Number(d)]!);
}

/** Converts Persian/Arabic-Indic digits to ASCII (for parsing user input). */
export function toEnDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
