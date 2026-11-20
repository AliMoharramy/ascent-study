/**
 * Time helpers. Storage is UTC; display is Asia/Tehran; a "game day" starts at the rollover hour
 * (default 04:00 local) so that after-midnight activity belongs to the previous day (doc 07 §4.5).
 * Asia/Tehran has had no DST since 2022 (a fixed UTC+03:30) — but we still go through Intl
 * so a future change of rules only needs a tzdata update.
 */

export const DEFAULT_TZ = "Asia/Tehran";
export const DEFAULT_ROLLOVER_HOUR = 4;

/** Local wall-clock parts of an instant in a timezone. */
export function localParts(date: Date, timeZone = DEFAULT_TZ) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** The game day (ISO date, Gregorian) an instant belongs to. */
export function gameDay(date: Date, timeZone = DEFAULT_TZ, rolloverHour = DEFAULT_ROLLOVER_HOUR): string {
  const shifted = new Date(date.getTime() - rolloverHour * 3_600_000);
  return localParts(shifted, timeZone).date;
}

/** Offset in minutes of `timeZone` from UTC at a given instant. */
export function tzOffsetMinutes(date: Date, timeZone = DEFAULT_TZ): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(p.date.slice(0, 4)),
    Number(p.date.slice(5, 7)) - 1,
    Number(p.date.slice(8, 10)),
    p.hour,
    p.minute,
    p.second,
  );
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** Converts a local wall-clock (ISO date + "HH:MM") in a timezone into a UTC Date. */
export function localToUtc(isoDate: string, hhmm: string, timeZone = DEFAULT_TZ): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = new Date(`${isoDate}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const offset = tzOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60_000);
}

/** Bounds [start, end) in UTC of a game day. */
export function gameDayBounds(isoDate: string, timeZone = DEFAULT_TZ, rolloverHour = DEFAULT_ROLLOVER_HOUR) {
  const start = localToUtc(isoDate, `${String(rolloverHour).padStart(2, "0")}:00`, timeZone);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
