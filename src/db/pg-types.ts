import pg from "pg";

/** Raw pg queries only: Drizzle bypasses these parsers and uses the schema's column mapper. */
let registered = false;

export function registerPgTypes(): void {
  if (registered) return;
  registered = true;
  pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (value: string) => new Date(value).toISOString());
  // `pg` turns `date` into a JS Date at *local* midnight, which shifts 2026-11-18 into 2026-11-17T20:30Z in
  // Tehran and corrupts every game-day comparison. Keep the calendar date as the plain string the app uses.
  pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
  // count(*), sum(int) and avg() come back as int8/numeric, which `pg` returns as strings. SQLite handed the app
  // plain numbers and raw SQL throughout the codebase relies on that. Every counter here is far below 2^53, so
  // parse them to numbers instead of risking `"3" + 1 === "31"`; values that could exceed it must be cast to text.
  pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => safeNumber(value));
  pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => safeNumber(value));
}

function safeNumber(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) && /^-?\d+$/.test(value)) throw new RangeError("Integer exceeds the safe JavaScript range; cast it to text in SQL");
  return n;
}

/** Test hook: whether the parser has been installed in this process. */
export function pgTypesRegistered(): boolean {
  return registered;
}
