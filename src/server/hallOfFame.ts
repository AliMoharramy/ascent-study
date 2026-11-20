import { and, asc, desc, eq, sql } from "drizzle-orm";
import { queryOne, type Db } from "@/db/client";
import { dayCloses, testLogs } from "@/db/schema";
import { diffDaysIso } from "@/i18n/jalali";

/**
 * Hall of Fame (F-INS-02 / #74): personal records read from the ledgers and events — never a leaderboard.
 * Best XP day, best test net, and the longest run of standard days. A record can only be replaced by a
 * better one, so the card doubles as a compact history of the climb.
 */

export interface HallOfFame {
  bestDayXp: { day: string; xp: number } | null;
  bestNet: { pct: number; day: string; subjectId: string | null; correct: number; wrong: number } | null;
  longestStandard: { days: number; from: string; to: string } | null;
  standardDays: number;
}

export async function hallOfFame(db: Db, userId: string): Promise<HallOfFame> {
  const bestDayXp = (await queryOne<{ day: string; xp: number }>(db, sql`SELECT game_day AS day, sum(amount) AS xp FROM xp_ledger WHERE user_id = ${userId} GROUP BY game_day ORDER BY xp DESC, game_day ASC LIMIT 1`)) ?? null;
  const best = (await db
    .select({ pct: testLogs.netPct, day: testLogs.gameDay, subjectId: testLogs.subjectId, correct: testLogs.correct, wrong: testLogs.wrong })
    .from(testLogs)
    .where(and(eq(testLogs.userId, userId), sql`${testLogs.correct} + ${testLogs.wrong} > 0`))
    .orderBy(desc(testLogs.netPct), asc(testLogs.gameDay))
    .limit(1))[0];
  const closes = (await db.select({ date: dayCloses.date, standard: dayCloses.standardDay }).from(dayCloses).where(eq(dayCloses.userId, userId)).orderBy(asc(dayCloses.date)));
  let run = 0;
  let longest: HallOfFame["longestStandard"] = null;
  let start = "";
  let prev = "";
  for (const c of closes) {
    if (!c.standard) {
      run = 0;
      prev = "";
      continue;
    }
    run = prev && diffDaysIso(c.date, prev) === 1 ? run + 1 : 1;
    if (run === 1) start = c.date;
    if (!longest || run > longest.days) longest = { days: run, from: start, to: c.date };
    prev = c.date;
  }
  return {
    bestDayXp: bestDayXp && bestDayXp.xp > 0 ? { day: bestDayXp.day, xp: Math.round(bestDayXp.xp) } : null,
    bestNet: best ? { pct: Math.round(best.pct * 100) / 100, day: best.day, subjectId: best.subjectId, correct: best.correct, wrong: best.wrong } : null,
    longestStandard: longest,
    standardDays: closes.filter((c) => c.standard).length,
  };
}
