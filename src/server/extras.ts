import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, queryOne, type Db } from "@/db/client";
import { bondInteractions, bossRushes, challengeCards, dayCloses, errorItems, gemsLedger, habitLogs, reviewRounds, seasonClaims, skillUnlocks, testLogs } from "@/db/schema";
import { AVATAR_COLORS, AVATAR_OUTFITS, AVATAR_TOOLS, CARD_POOL, DEFAULT_AVATAR, SEASON_TRACK, SKILLS, drawCard, rushAvailable, skillTier, type Avatar, type CardMetric } from "@/domain/extras";
import { appendEvent } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { addDaysIso, diffDaysIso } from "@/i18n/jalali";
import { EXAM_DATE, daysToExam, weekNoOf, weekStartOf } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";
import { getKv, setKv } from "./kv";

/**
 * R3 extras (issues #87, #90, #91): Gems economy, skill tree, avatar, free Season Pass,
 * weekly challenge card, Boss Rush and the encrypted time capsule.
 * Gems and reward gold are event-sourced (folded in projections.ts) so Replay rebuilds them.
 */

export class ExtrasDenied extends Error {}

export async function gemsBalance(db: Db, userId: string): Promise<number> {
  return Math.round(((await queryOne<{ v: number | null }>(db, sql`SELECT sum(amount) v FROM gems_ledger WHERE user_id = ${userId}`))?.v ?? 0) * 100) / 100;
}

export async function gemsView(db: Db, userId: string) {
  const recent = (await db.select().from(gemsLedger).where(eq(gemsLedger.userId, userId)).orderBy(desc(gemsLedger.createdAt), desc(gemsLedger.id)).limit(20));
  return { balance: (await gemsBalance(db, userId)), recent };
}

export async function awardGems(db: Db, userId: string, amount: number, ruleKey: string, note: string, day: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  if (amount <= 0) return;
  (await appendEvent(tx, { userId, type: "gems.awarded", payload: { amount, ruleKey, note }, gameDay: day }));
});
}

async function spendGems(db: Db, userId: string, amount: number, ruleKey: string, note: string, day: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  if ((await gemsBalance(tx, userId)) < amount) throw new ExtrasDenied(`Not enough Gems (need ${amount}, have ${(await gemsBalance(tx, userId))})`);
  (await appendEvent(tx, { userId, type: "gems.spent", payload: { amount, ruleKey, note }, gameDay: day }));
});
}

// ── Skill tree (#87) ─────────────────────────────────────────

export async function skillsView(db: Db, userId: string) {
  const cfg = (await activeConfig(db, userId));
  const unlocks = (await db.select().from(skillUnlocks).where(eq(skillUnlocks.userId, userId)));
  return {
    balance: (await gemsBalance(db, userId)),
    skills: SKILLS.map((s) => {
      const tier = skillTier(unlocks, s.id);
      return { ...s, tier, nextCost: tier < 3 ? cfg.skillTree.tierCosts[tier]! : null };
    }),
  };
}

export async function unlockSkill(db: Db, userId: string, skillId: string, day: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  const skill = SKILLS.find((s) => s.id === skillId);
  if (!skill) throw new ExtrasDenied(`Unknown skill ${skillId}`);
  const row = (await tx.select().from(skillUnlocks).where(and(eq(skillUnlocks.userId, userId), eq(skillUnlocks.skillId, skillId))).limit(1))[0];
  const tier = row?.tier ?? 0;
  if (tier >= 3) throw new ExtrasDenied(`${skill.name} is already maxed`);
  const cost = cfg.skillTree.tierCosts[tier]!;
  (await spendGems(tx, userId, cost, "gems.skill", `${skill.name} tier ${tier + 1}`, day));
  (await tx.insert(skillUnlocks)
    .values({ userId, skillId, tier: tier + 1, costGems: cost, unlockedAt: nowIso() })
    .onConflictDoUpdate({ target: [skillUnlocks.userId, skillUnlocks.skillId], set: { tier: tier + 1, costGems: cost, unlockedAt: nowIso() } }));
  (await appendEvent(tx, { userId, type: "skill.unlocked", payload: { skillId, tier: tier + 1, cost }, gameDay: day }));
  return (await skillsView(tx, userId));
});
}

// ── Avatar (#87) ─────────────────────────────────────────────

export async function avatarView(db: Db, userId: string) {
  return { avatar: (await getKv<Avatar>(db, userId, "avatar", DEFAULT_AVATAR)), colors: AVATAR_COLORS, outfits: AVATAR_OUTFITS, tools: AVATAR_TOOLS, balance: (await gemsBalance(db, userId)) };
}

export const avatarInput = z.object({ color: z.enum(AVATAR_COLORS), outfit: z.string().max(20).nullish(), tool: z.string().max(20).nullish() });

export async function saveAvatar(db: Db, userId: string, input: z.input<typeof avatarInput>, day: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const p = avatarInput.parse(input);
  const cur = (await getKv<Avatar>(tx, userId, "avatar", DEFAULT_AVATAR));
  const owned = [...cur.owned];
  const buy = async (id: string | null | undefined, catalog: readonly { id: string; cost: number }[], kind: string) => {
    if (!id) return null;
    const item = catalog.find((c) => c.id === id);
    if (!item) throw new ExtrasDenied(`Unknown ${kind} ${id}`);
    if (!owned.includes(id)) {
      (await spendGems(tx, userId, item.cost, "gems.avatar", `${kind}: ${item.id}`, day));
      owned.push(id);
    }
    return id;
  };
  const next: Avatar = { color: p.color, outfit: (await buy(p.outfit, AVATAR_OUTFITS, "outfit")), tool: (await buy(p.tool, AVATAR_TOOLS, "tool")), owned };
  (await setKv(tx, userId, "avatar", next));
  (await appendEvent(tx, { userId, type: "avatar.saved", payload: { color: next.color, outfit: next.outfit, tool: next.tool }, gameDay: day }));
  return (await avatarView(tx, userId));
});
}

// ── Season Pass (#91, F-GM-03) — free forever, claim after the week ends ──

async function standardDaysInWeek(db: Db, userId: string, weekNo: number): Promise<number> {
  const start = weekStartOf(weekNo);
  return (await db.select({ d: dayCloses.date }).from(dayCloses).where(and(eq(dayCloses.userId, userId), eq(dayCloses.standardDay, true), gte(dayCloses.date, start), lte(dayCloses.date, addDaysIso(start, 6))))).length;
}

export async function seasonView(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const week = weekNoOf(today);
  const claims = new Map((await db.select().from(seasonClaims).where(eq(seasonClaims.userId, userId))).map((c) => [c.weekNo, c]));
  return {
    enabled: cfg.flags.seasonPass,
    week,
    stops: (await Promise.all(SEASON_TRACK.map(async (s) => {
      const standardDays = (await standardDaysInWeek(db, userId, s.week));
      const claimed = claims.has(s.week);
      const ended = s.week < week;
      return { ...s, standardDays, claimed, claimable: cfg.flags.seasonPass && ended && !claimed && standardDays >= s.needStandardDays, locked: !ended };
    }))),
  };
}

export async function claimSeason(db: Db, userId: string, weekNo: number, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  if (!cfg.flags.seasonPass) throw new ExtrasDenied("Season Pass is off in Settings");
  const stop = SEASON_TRACK.find((s) => s.week === weekNo);
  if (!stop) throw new ExtrasDenied(`Unknown season week ${weekNo}`);
  if (weekNo >= weekNoOf(today)) throw new ExtrasDenied("This week is still running — claim it after it ends");
  if ((await tx.select().from(seasonClaims).where(and(eq(seasonClaims.userId, userId), eq(seasonClaims.weekNo, weekNo))).limit(1))[0]) throw new ExtrasDenied("Already claimed");
  const days = (await standardDaysInWeek(tx, userId, weekNo));
  if (days < stop.needStandardDays) throw new ExtrasDenied(`Needs ${stop.needStandardDays} Standard days that week (had ${days})`);
  (await appendEvent(tx, { userId, type: "season.claimed", payload: { week: weekNo, gold: stop.gold, gems: stop.gems, title: stop.title }, gameDay: today }));
  (await tx.insert(seasonClaims).values({ userId, weekNo, rewardJson: JSON.stringify({ gold: stop.gold, gems: stop.gems }), claimedAt: nowIso() }));
  return (await seasonView(tx, userId, today));
});
}

// ── Weekly challenge card (#91, F-GM-14) ─────────────────────

async function cardProgress(db: Db, userId: string, metric: CardMetric, start: string, end: string): Promise<number> {
  const between = <T extends { gameDay: string }>(rows: T[]) => rows.filter((r) => r.gameDay >= start && r.gameDay <= end);
  switch (metric) {
    case "rounds":
      return (await db.select().from(reviewRounds).where(and(eq(reviewRounds.userId, userId), eq(reviewRounds.status, "done")))).filter((r) => r.doneOn && r.doneOn >= start && r.doneOn <= end).length;
    case "interleaved":
      return between((await db.select({ gameDay: testLogs.gameDay }).from(testLogs).where(and(eq(testLogs.userId, userId), eq(testLogs.interleaved, true))))).length;
    case "focus":
      return (await queryOne<{ v: number | null }>(db, sql`SELECT coalesce(sum(minutes),0) v FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day BETWEEN ${start} AND ${end}`))?.v ?? 0;
    case "bonds":
      return between((await db.select({ gameDay: bondInteractions.gameDay }).from(bondInteractions).where(eq(bondInteractions.userId, userId)))).length;
    case "pages":
      return (await queryOne<{ v: number | null }>(db, sql`SELECT coalesce(sum(pages),0) v FROM reading_logs WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))?.v ?? 0;
    case "errors":
      return between((await db.select({ gameDay: errorItems.gameDay }).from(errorItems).where(eq(errorItems.userId, userId)))).length;
    case "habit": {
      const counts = new Map<string, number>();
      for (const l of between((await db.select({ gameDay: habitLogs.date, habitId: habitLogs.habitId }).from(habitLogs).where(eq(habitLogs.userId, userId))))) counts.set(l.habitId, (counts.get(l.habitId) ?? 0) + 1);
      return Math.max(0, ...counts.values());
    }
    case "tests":
      return (await queryOne<{ v: number | null }>(db, sql`SELECT coalesce(sum(correct + wrong + blank),0) v FROM test_logs WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))?.v ?? 0;
  }
}

export async function cardView(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const week = weekNoOf(today);
  const start = weekStartOf(week);
  const end = addDaysIso(start, 6);
  const row = (await db.select().from(challengeCards).where(and(eq(challengeCards.userId, userId), eq(challengeCards.weekNo, week))).limit(1))[0];
  const card = row ? CARD_POOL.find((c) => c.id === row.cardId)! : drawCard(userId, week);
  const progress = row ? (await cardProgress(db, userId, card.metric, start, end)) : 0;
  const net = (await queryOne<{ c: number; w: number; b: number }>(db, sql`SELECT coalesce(sum(correct),0) c, coalesce(sum(wrong),0) w, coalesce(sum(blank),0) b FROM test_logs WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))!;
  const q = net.c + net.w + net.b;
  const weekNet = q ? Math.round(((net.c - net.w / 3) / q) * 1000) / 10 : 0;
  return {
    enabled: cfg.flags.challengeCards,
    week,
    drawn: !!row,
    card,
    progress,
    weekNet,
    status: row?.status ?? "undrawn",
    done: !!row && progress >= card.target && (card.metric !== "tests" || weekNet >= 50),
  };
}

export async function drawWeeklyCard(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  if (!cfg.flags.challengeCards) throw new ExtrasDenied("Challenge cards are off in Settings");
  const week = weekNoOf(today);
  if ((await tx.select().from(challengeCards).where(and(eq(challengeCards.userId, userId), eq(challengeCards.weekNo, week))).limit(1))[0]) throw new ExtrasDenied("This week's card is already drawn");
  const card = drawCard(userId, week);
  (await tx.insert(challengeCards).values({ userId, weekNo: week, cardId: card.id, status: "pending", drawnAt: nowIso() }));
  (await appendEvent(tx, { userId, type: "card.drawn", payload: { week, cardId: card.id }, gameDay: today }));
  return (await cardView(tx, userId, today));
});
}

export async function claimCard(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const view = (await cardView(tx, userId, today));
  if (!view.drawn) throw new ExtrasDenied("Draw this week's card first");
  if (view.status === "claimed") throw new ExtrasDenied("Already claimed");
  if (!view.done) throw new ExtrasDenied(`Card not finished yet (${view.progress}/${view.card.target})`);
  (await tx.update(challengeCards).set({ status: "claimed", doneAt: nowIso() }).where(and(eq(challengeCards.userId, userId), eq(challengeCards.weekNo, view.week))));
  (await appendEvent(tx, { userId, type: "card.done", payload: { week: view.week, cardId: view.card.id }, gameDay: today }));
  (await appendEvent(tx, { userId, type: "card.claimed", payload: { week: view.week, cardId: view.card.id, gold: view.card.gold, gems: view.card.gems }, gameDay: today }));
  return (await cardView(tx, userId, today));
});
}

// ── Boss Rush (#91, F-GM-01) — final week only ───────────────

export const RUSH_STAGES = [
  { realm: 1, name: "Foundations gate" },
  { realm: 2, name: "Core sciences gate" },
  { realm: 3, name: "Systems gate" },
  { realm: 4, name: "Mixed mock gate" },
  { realm: 5, name: "Summit gate" },
] as const;

export async function rushView(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const week = weekNoOf(today);
  const finished = (await db.select().from(bossRushes).where(and(eq(bossRushes.userId, userId), eq(bossRushes.weekNo, week))).limit(1))[0];
  return {
    available: rushAvailable(week, daysToExam(today), cfg.flags.bossRush),
    week,
    threshold: cfg.boss.regionThreshold,
    stages: RUSH_STAGES,
    finished: finished ? { results: JSON.parse(finished.resultsJson) as { realm: number; netPct: number; defeated: boolean }[], finishedAt: finished.finishedAt } : null,
  };
}

export const rushInput = z.object({ results: z.array(z.object({ realm: z.number().int().min(1).max(5), netPct: z.number().min(-100).max(100) })).length(5) });

export async function finishRush(db: Db, userId: string, input: z.input<typeof rushInput>, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const view = (await rushView(tx, userId, today));
  if (!view.available) throw new ExtrasDenied("Boss Rush opens in the final week (or the last 7 days before the exam)");
  if (view.finished) throw new ExtrasDenied("This week's Rush is already finished");
  const p = rushInput.parse(input);
  const cfg = (await activeConfig(tx, userId));
  const results = p.results.map((r) => ({ ...r, defeated: r.netPct >= cfg.boss.regionThreshold }));
  const defeated = results.filter((r) => r.defeated).length;
  const gold = defeated * 10;
  const gems = defeated === 5 ? cfg.gems.bossWin : 0;
  (await tx.insert(bossRushes).values({ id: newId(), userId, weekNo: view.week, resultsJson: JSON.stringify(results), finishedAt: nowIso(), createdAt: nowIso() }));
  (await appendEvent(tx, { userId, type: "rush.finished", payload: { week: view.week, defeated, gold, gems }, gameDay: today }));
  return (await rushView(tx, userId, today));
});
}

// ── Time capsule (#90) — AES-256-GCM, opens on exam day ──────

interface CapsuleBlob {
  sealedAt: string;
  opensOn: string;
  iv: string;
  tag: string;
  data: string;
  keySource: "env" | "local";
}

async function capsuleKey(db: Db, userId: string): Promise<{ key: Buffer; source: "env" | "local" }> {
  return await withUserTransaction(db, userId, async (tx) => {
  const env = process.env.CAPSULE_KEY?.trim();
  if (env) return { key: scryptSync(env, `ascent-capsule:${userId}`, 32), source: "env" };
  // No env key: a per-user random key lives in kv. Encryption still protects exports/backups
  // that omit kv; set CAPSULE_KEY for full separation of key and data.
  let secret = (await getKv<string | null>(tx, userId, "capsule.key", null));
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    (await setKv(tx, userId, "capsule.key", secret));
  }
  return { key: scryptSync(secret, `ascent-capsule:${userId}`, 32), source: "local" };
});
}

export async function sealCapsule(db: Db, userId: string, text: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const trimmed = text.trim();
  if (trimmed.length < 10 || trimmed.length > 4000) throw new ExtrasDenied("Capsule letter must be 10–4000 characters");
  if ((await getKv<CapsuleBlob | null>(tx, userId, "capsule", null))) throw new ExtrasDenied("A capsule is already sealed — it opens on exam day");
  const { key, source } = (await capsuleKey(tx, userId));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(trimmed, "utf8"), c.final()]).toString("base64");
  const blob: CapsuleBlob = { sealedAt: nowIso(), opensOn: EXAM_DATE, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data, keySource: source };
  (await setKv(tx, userId, "capsule", blob));
  (await appendEvent(tx, { userId, type: "capsule.sealed", payload: { opensOn: EXAM_DATE, chars: trimmed.length }, gameDay: today }));
  return (await capsuleView(tx, userId, today));
});
}

export async function capsuleView(db: Db, userId: string, today: string): Promise<{ sealed: boolean; opensOn: string; daysLeft: number; open: boolean; text?: string; keySource?: "env" | "local"; error?: string }> {
  return await withUserTransaction(db, userId, async (tx) => {
  const blob = (await getKv<CapsuleBlob | null>(tx, userId, "capsule", null));
  if (!blob) return { sealed: false, opensOn: EXAM_DATE, daysLeft: Math.max(0, diffDaysIso(EXAM_DATE, today)), open: false };
  const daysLeft = Math.max(0, diffDaysIso(blob.opensOn, today));
  if (daysLeft > 0) return { sealed: true, opensOn: blob.opensOn, daysLeft, open: false, keySource: blob.keySource };
  try {
    const { key } = (await capsuleKey(tx, userId));
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "base64"));
    d.setAuthTag(Buffer.from(blob.tag, "base64"));
    const text = Buffer.concat([d.update(Buffer.from(blob.data, "base64")), d.final()]).toString("utf8");
    return { sealed: true, opensOn: blob.opensOn, daysLeft: 0, open: true, text, keySource: blob.keySource };
  } catch {
    return { sealed: true, opensOn: blob.opensOn, daysLeft: 0, open: false, error: "Capsule key mismatch — set the CAPSULE_KEY that was used when sealing." };
  }
});
}