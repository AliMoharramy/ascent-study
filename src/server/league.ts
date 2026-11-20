import { and, asc, eq, lt } from "drizzle-orm";
import { withUserTransaction, type Db } from "@/db/client";
import { leagueWeeks, xpLedger } from "@/db/schema";
import { activeConfig } from "@/events/projections";
import { appendEvent } from "@/events/store";
import { ghostField, LEAGUE_DEMOTE, LEAGUE_PROMOTE, LEAGUE_SIZE, LEAGUE_TIERS, leagueBaseline, leagueOutcome, type LeagueOutcome } from "@/domain/pillars";
import { addDaysIso } from "@/i18n/jalali";
import { weekNoOf, weekStartOf } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";

/**
 * Ghost League (issue #83, doc 11 §4.1): ten anonymous tiers, nine seeded ghosts whose median tracks the
 * user's recent study XP (σ = 0.25). Only study XP counts; ghosts are always labelled Ghost. Promotion for
 * the top 3, demotion for the bottom 2, and every finished week is persisted for an honest audit trail.
 */

const isStudy = (ruleKey: string) => !ruleKey.startsWith("xp.pillar") && !ruleKey.startsWith("xp.forge");

async function weeklyStudyXp(db: Db, userId: string): Promise<Map<number, number>> {
  const rows = (await db.select({ day: xpLedger.gameDay, rule: xpLedger.ruleKey, amount: xpLedger.amount }).from(xpLedger).where(eq(xpLedger.userId, userId)));
  const out = new Map<number, number>();
  for (const r of rows) {
    if (!isStudy(r.rule)) continue;
    const w = weekNoOf(r.day);
    out.set(w, (out.get(w) ?? 0) + r.amount);
  }
  return out;
}

const weekEnd = (no: number) => addDaysIso(weekStartOf(no), 6);

async function tierAt(db: Db, userId: string, weekNo: number): Promise<number> {
  const prev = (await db.select().from(leagueWeeks).where(and(eq(leagueWeeks.userId, userId), lt(leagueWeeks.weekNo, weekNo))).orderBy(asc(leagueWeeks.weekNo)));
  let tier = 1;
  for (const row of prev) {
    const result = JSON.parse(row.resultJson) as { outcome?: LeagueOutcome };
    if (result.outcome === "promoted") tier = Math.min(LEAGUE_TIERS.length, row.tier + 1);
    else if (result.outcome === "demoted") tier = Math.max(1, row.tier - 1);
    else tier = row.tier;
  }
  return tier;
}

/** Settles every finished, unsettled league week (idempotent). */
export async function settleLeague(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  if (!cfg.flags.ghostLeague) return [];
  const current = weekNoOf(today);
  const xp = (await weeklyStudyXp(tx, userId));
  const done = new Set((await tx.select({ w: leagueWeeks.weekNo }).from(leagueWeeks).where(eq(leagueWeeks.userId, userId))).map((r) => r.w));
  const out: { weekNo: number; tier: number; rank: number; outcome: LeagueOutcome }[] = [];
  // Week 1 is the observation week; the league opens with week 2.
  for (let w = 2; w < current; w++) {
    if (done.has(w) || weekEnd(w) >= today) continue;
    const tier = (await tierAt(tx, userId, w));
    const baseline = leagueBaseline([...xp.entries()].filter(([week]) => week < w).map(([, v]) => v));
    const seed = `${userId}:${w}:${tier}`;
    const ghosts = ghostField(baseline, seed);
    const myXp = Math.round(xp.get(w) ?? 0);
    const rank = 1 + ghosts.filter((g) => g.xp > myXp).length;
    const outcome = leagueOutcome(rank, tier);
    const result = { ghosts, rank, outcome, baseline, myXp };
    (await withUserTransaction(tx, userId, async (tx) => {
      (await tx.insert(leagueWeeks)
        .values({ id: newId(), userId, weekNo: w, tier, seed, myXp, resultJson: JSON.stringify(result), settledAt: nowIso(), createdAt: nowIso() })
        .onConflictDoNothing());
      (await appendEvent(tx, { userId, type: "league.settled", payload: { weekNo: w, tier, rank, outcome, myXp }, gameDay: weekEnd(w), source: "job" }));
    }));
    out.push({ weekNo: w, tier, rank, outcome });
  }
  return out;
});
}

export async function leagueView(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  if (!cfg.flags.ghostLeague) {
    return { enabled: false as const, reason: "The Ghost League is turned off (Settings → Feature flags). It is a ten-tier, all-ghost league — no real opponents, no chat." };
  }
  const weekNo = weekNoOf(today);
  if (weekNo < 2) {
    return { enabled: false as const, reason: "The league opens after the Baseline week. Week 1 is for observation only." };
  }
  (await settleLeague(tx, userId, today));
  const xp = (await weeklyStudyXp(tx, userId));
  const tier = (await tierAt(tx, userId, weekNo));
  const baseline = leagueBaseline([...xp.entries()].filter(([week]) => week < weekNo).map(([, v]) => v));
  const seed = `${userId}:${weekNo}:${tier}`;
  const ghosts = ghostField(baseline, seed);
  const myXp = Math.round(xp.get(weekNo) ?? 0);
  const board = [...ghosts.map((g) => ({ name: g.name, xp: g.xp, ghost: true as const })), { name: "You", xp: myXp, ghost: false as const }]
    .sort((a, b) => b.xp - a.xp)
    .map((row, i) => ({ ...row, rank: i + 1, zone: i + 1 <= LEAGUE_PROMOTE ? "promote" : i + 1 > LEAGUE_SIZE - LEAGUE_DEMOTE ? "demote" : "safe" }));
  const rank = board.find((r) => !r.ghost)!.rank;
  const history = (await tx.select().from(leagueWeeks).where(eq(leagueWeeks.userId, userId)).orderBy(asc(leagueWeeks.weekNo))).map((r) => ({ ...r, result: JSON.parse(r.resultJson) as { ghosts: { name: string; xp: number; ghost: true }[]; rank: number; outcome: LeagueOutcome; baseline: number; myXp: number } }));
  return {
    enabled: true as const,
    weekNo,
    tier,
    tierName: LEAGUE_TIERS[tier - 1]!,
    tierCount: LEAGUE_TIERS.length,
    baseline,
    seed,
    ghosts,
    board,
    myXp,
    rank,
    outcome: leagueOutcome(rank, tier),
    promote: LEAGUE_PROMOTE,
    demote: LEAGUE_DEMOTE,
    history,
    sigma: 0.25,
  };
});
}

export { GHOST_NAMES } from "@/domain/pillars";
