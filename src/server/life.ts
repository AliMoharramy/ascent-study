import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, queryOne, queryRows, type Db } from "@/db/client";
import {
  bondContacts,
  bondInteractions,
  boardClaims,
  builderBank,
  builderSessions,
  dayCloses,
  explorationSessions,
  explorationTopics,
  identityVotes,
  lootRolls,
  monthlyBadges,
  quests,
  readingLogs,
  type ExplorationStatus,
} from "@/db/schema";
import { activeConfig } from "@/events/projections";
import { appendEvent } from "@/events/store";
import { boardMissions, boardProgress, builderBalance, builderEligibility, builderWeekCredit, explorationBudget, explorationSuspended, maxStandardRun, monthlyProgress, monthlyTheme, streakSociety, type BoardMetric } from "@/domain/pillars";
import { consistencyRate, tierRank } from "@/domain/quests";
import { addDaysIso, diffDaysIso, weekStartSaturday } from "@/i18n/jalali";
import { weekNoOf } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";

/**
 * Life pillars (issues #75–#79, #82, #84–#85): identity votes, exploration slot, bonds + bedtime reading,
 * Builder Hour, the Quest Board, the monthly challenge, the weekly escape series, streak medals and the
 * loot vault. Rules live in `domain/pillars.ts`; this file owns persistence, guards and read models.
 */

export class LifeDenied extends Error {}

const num = async (db: Db, q: ReturnType<typeof sql>) => Number((await queryOne<{ v: number | null }>(db, q))?.v ?? 0);

// ── identity votes (habit lifecycle) ────────────────────────

export const identityInput = z.object({
  habitId: z.string().max(40).nullish(),
  vote: z.enum(["for", "against"]),
  note: z.string().trim().max(200).default(""),
});

export async function voteIdentity(db: Db, userId: string, day: string, input: z.input<typeof identityInput>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = identityInput.parse(input);
  const habitId = d.habitId ?? "";
  const now = nowIso();
  (await tx.insert(identityVotes)
    .values({ id: newId(), userId, habitId, gameDay: day, vote: d.vote, note: d.note, createdAt: now })
    .onConflictDoUpdate({ target: [identityVotes.userId, identityVotes.habitId, identityVotes.gameDay], set: { vote: d.vote, note: d.note } }));
  (await appendEvent(tx, { userId, type: "identity.voted", payload: { habitId: habitId || null, vote: d.vote }, gameDay: day }));
  return { vote: d.vote };
});
}

export async function identityVotesAll(db: Db, userId: string, today: string) {
  const since = addDaysIso(today, -29);
  const rows = (await db.select().from(identityVotes).where(and(eq(identityVotes.userId, userId), gte(identityVotes.gameDay, since))).orderBy(desc(identityVotes.gameDay)));
  const byHabit = new Map<string, { for: number; against: number; today: "for" | "against" | null }>();
  for (const r of rows) {
    const key = r.habitId || "";
    const cur = byHabit.get(key) ?? { for: 0, against: 0, today: null };
    if (r.vote === "for") cur.for++;
    else cur.against++;
    if (r.gameDay === today) cur.today = r.vote;
    byHabit.set(key, cur);
  }
  return { rows, byHabit, self: byHabit.get("") ?? { for: 0, against: 0, today: null } };
}

export async function identityVoteView(db: Db, userId: string, today: string, habitId?: string | null) {
  const since = addDaysIso(today, -29);
  const rows = (await db
    .select()
    .from(identityVotes)
    .where(and(eq(identityVotes.userId, userId), gte(identityVotes.gameDay, since), eq(identityVotes.habitId, habitId ?? "")))
    .orderBy(desc(identityVotes.gameDay)));
  return { rows, for: rows.filter((r) => r.vote === "for").length, against: rows.filter((r) => r.vote === "against").length, today: rows.find((r) => r.gameDay === today)?.vote ?? null };
}

// ── exploration slot (≤ 10 % of study, active only outside Trials/Arena/Final) ──

export const topicInput = z.object({
  title: z.string().trim().min(2).max(160),
  why: z.string().trim().max(300).default(""),
  value: z.coerce.number().int().min(1).max(5).default(3),
});

export async function saveTopic(db: Db, userId: string, today: string, input: z.input<typeof topicInput>, id?: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = topicInput.parse(input);
  const now = nowIso();
  if (id) {
    const t = (await tx.select().from(explorationTopics).where(and(eq(explorationTopics.id, id), eq(explorationTopics.userId, userId))).limit(1))[0];
    if (!t) throw new Error("Unknown exploration topic");
    (await tx.update(explorationTopics).set({ ...d, updatedAt: now }).where(eq(explorationTopics.id, id)));
    (await appendEvent(tx, { userId, type: "exploration.topic_updated", payload: { topicId: id, ...d } }));
    return id;
  }
  const nid = newId();
  (await tx.insert(explorationTopics).values({ id: nid, userId, ...d, status: "backlog", createdAt: now, updatedAt: now }));
  (await appendEvent(tx, { userId, type: "exploration.topic_updated", payload: { topicId: nid, created: true, ...d } }));
  return nid;
});
}

export const GATE_MIN_DAYS = 7;
export const GATE_RECHECK_DAYS = 28;

export async function advanceTopic(db: Db, userId: string, today: string, id: string, status: ExplorationStatus, note = "") {
  return await withUserTransaction(db, userId, async (tx) => {
  const t = (await tx.select().from(explorationTopics).where(and(eq(explorationTopics.id, id), eq(explorationTopics.userId, userId))).limit(1))[0];
  if (!t) throw new Error("Unknown exploration topic");
  if (status === "active" && t.status !== "trial") throw new LifeDenied("A topic must pass a Trial before it becomes Active");
  if (status === "active" && t.startedOn && diffDaysIso(today, t.startedOn) < GATE_MIN_DAYS) throw new LifeDenied(`Give the trial at least ${GATE_MIN_DAYS} days before the gate review`);
  if (status === "active" && note.trim().length < 3) throw new LifeDenied("Write the gate verdict: what earned it a permanent slot?");
  const now = nowIso();
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.update(explorationTopics)
      .set({ status, startedOn: status === "trial" && !t.startedOn ? today : t.startedOn, archivedOn: status === "archived" ? today : null, gateNote: status === "active" || status === "archived" ? note : t.gateNote, updatedAt: now })
      .where(eq(explorationTopics.id, id)));
    (await appendEvent(tx, { userId, type: "exploration.topic_updated", payload: { topicId: id, from: t.status, status, note }, gameDay: today }));
  }));
});
}

export const explorationInput = z.object({
  topicId: z.string().max(40),
  minutes: z.coerce.number().int().min(1).max(30),
  kind: z.enum(["trial", "review", "output"]).default("trial"),
  output: z.string().trim().max(400).default(""),
});

async function explorationUsage(db: Db, userId: string, since: string, until: string) {
  const study = (await num(db, sql`SELECT sum(minutes) AS v FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day BETWEEN ${since} AND ${until} AND coalesce(kind, '') <> 'forge'`));
  const forge = (await num(db, sql`SELECT sum(minutes) AS v FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day BETWEEN ${since} AND ${until} AND kind = 'forge'`));
  const explore = (await num(db, sql`SELECT sum(minutes) AS v FROM exploration_sessions WHERE user_id = ${userId} AND game_day BETWEEN ${since} AND ${until}`));
  return { study, forge, explore, budget: explorationBudget(study, explore, forge) };
}

export async function explorationView(db: Db, userId: string, today: string) {
  const week = weekStartSaturday(today);
  const no = weekNoOf(today);
  const suspension = explorationSuspended(no);
  const topics = (await db.select().from(explorationTopics).where(eq(explorationTopics.userId, userId)).orderBy(desc(explorationTopics.value), asc(explorationTopics.createdAt)));
  const sessions = (await db.select().from(explorationSessions).where(and(eq(explorationSessions.userId, userId), gte(explorationSessions.gameDay, week), lte(explorationSessions.gameDay, today))));
  const usage = (await explorationUsage(db, userId, week, today));
  const lastSession = new Map((await queryRows<{ t: string; d: string }>(db, sql`SELECT topic_id AS t, max(game_day) AS d FROM exploration_sessions WHERE user_id = ${userId} GROUP BY topic_id`)).map((r) => [r.t, r.d]));
  const pick = topics.find((t) => t.status === "backlog") ?? null;
  return {
    week,
    weekNo: no,
    suspended: suspension.suspended,
    phase: suspension.phase,
    topics: topics.map((t) => {
      const last = lastSession.get(t.id) ?? null;
      return {
        ...t,
        sessionsThisWeek: sessions.filter((s) => s.topicId === t.id).length,
        lastSession: last,
        gateDue: t.status === "trial" && !!t.startedOn && diffDaysIso(today, t.startedOn) >= GATE_MIN_DAYS,
        archiveReview: t.status !== "archived" && !!last && diffDaysIso(today, last) >= GATE_RECHECK_DAYS,
      };
    }),
    pick,
    sessions,
    target: { sessions: sessions.length, goal: 3, minutes: usage.explore },
    budget: usage.budget,
    studyMinutes: usage.study,
  };
}

export async function logExploration(db: Db, userId: string, today: string, input: z.input<typeof explorationInput>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = explorationInput.parse(input);
  const view = (await explorationView(tx, userId, today));
  if (view.suspended) throw new LifeDenied(`The exploration slot is paused during ${view.phase}`);
  const topic = view.topics.find((t) => t.id === d.topicId);
  if (!topic) throw new Error("Unknown exploration topic");
  if (topic.status === "archived" || topic.status === "backlog") throw new LifeDenied("Move the topic to Trial before spending slot time on it");
  if (view.budget.over || view.budget.usedMinutes + d.minutes > view.budget.capMinutes) throw new LifeDenied(`The slot is capped at 10 % of study time (${view.budget.capMinutes} min this week)`);
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.insert(explorationSessions).values({ id: newId(), userId, topicId: d.topicId, gameDay: today, minutes: d.minutes, kind: d.kind, output: d.output, createdAt: nowIso() }));
    (await appendEvent(tx, { userId, type: "exploration.logged", payload: { topicId: d.topicId, minutes: d.minutes, kind: d.kind }, gameDay: today }));
  }));
  return { minutes: d.minutes, remaining: Math.max(0, view.budget.capMinutes - view.budget.usedMinutes - d.minutes) };
});
}

// ── bonds + bedtime reading ─────────────────────────────────

export const bondInput = z.object({
  name: z.string().trim().min(1).max(80),
  relation: z.string().trim().max(80).default(""),
  reminderDays: z.coerce.number().int().min(1).max(365).default(14),
});

export async function saveBond(db: Db, userId: string, input: z.input<typeof bondInput>, id?: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = bondInput.parse(input);
  const now = nowIso();
  if (id) {
    const c = (await tx.select().from(bondContacts).where(and(eq(bondContacts.id, id), eq(bondContacts.userId, userId))).limit(1))[0];
    if (!c) throw new Error("Unknown contact");
    (await tx.update(bondContacts).set({ ...d, updatedAt: now }).where(eq(bondContacts.id, id)));
    return id;
  }
  const nid = newId();
  (await tx.insert(bondContacts).values({ id: nid, userId, ...d, createdAt: now, updatedAt: now }));
  return nid;
});
}

export const bondLogInput = z.object({
  contactId: z.string().max(40),
  kind: z.enum(["message", "call", "meet", "collective"]),
  note: z.string().trim().max(300).default(""),
});

export async function logBond(db: Db, userId: string, today: string, input: z.input<typeof bondLogInput>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = bondLogInput.parse(input);
  const c = (await tx.select().from(bondContacts).where(and(eq(bondContacts.id, d.contactId), eq(bondContacts.userId, userId))).limit(1))[0];
  if (!c) throw new Error("Unknown contact");
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.insert(bondInteractions).values({ id: newId(), userId, contactId: d.contactId, gameDay: today, kind: d.kind, note: d.note, createdAt: nowIso() }));
    if (d.kind !== "collective") (await tx.update(bondContacts).set({ lastContactOn: today, updatedAt: nowIso() }).where(eq(bondContacts.id, d.contactId)));
    (await appendEvent(tx, { userId, type: "bond.logged", payload: { contactId: d.contactId, kind: d.kind }, gameDay: today }));
  }));
  return { contact: c.name };
});
}

export const readingInput = z.object({
  book: z.string().trim().min(1).max(120),
  pages: z.coerce.number().int().min(0).max(500).default(0),
  minutes: z.coerce.number().int().min(0).max(240).default(0),
  note: z.string().trim().max(300).default(""),
});

export async function logReading(db: Db, userId: string, today: string, input: z.input<typeof readingInput>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = readingInput.parse(input);
  if (d.pages === 0 && d.minutes === 0) throw new LifeDenied("Log pages or minutes — the point is the book, not the checkbox");
  const now = nowIso();
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.insert(readingLogs)
      .values({ id: newId(), userId, gameDay: today, ...d, createdAt: now })
      .onConflictDoUpdate({ target: [readingLogs.userId, readingLogs.gameDay, readingLogs.book], set: { pages: d.pages, minutes: d.minutes, note: d.note } }));
    (await appendEvent(tx, { userId, type: "reading.logged", payload: { book: d.book, pages: d.pages, minutes: d.minutes }, gameDay: today }));
  }));
  return d;
});
}

export async function bondsView(db: Db, userId: string, today: string) {
  const week = weekStartSaturday(today);
  const contacts = (await db.select().from(bondContacts).where(eq(bondContacts.userId, userId)).orderBy(asc(bondContacts.name)));
  const since = addDaysIso(today, -6);
  const interactions = (await db.select().from(bondInteractions).where(and(eq(bondInteractions.userId, userId), gte(bondInteractions.gameDay, since))));
  const reading = (await db.select().from(readingLogs).where(and(eq(readingLogs.userId, userId), gte(readingLogs.gameDay, since))));
  const due = contacts
    .map((c) => {
      const sinceDays = c.lastContactOn ? diffDaysIso(today, c.lastContactOn) : null;
      return { ...c, sinceDays, due: sinceDays === null || sinceDays >= c.reminderDays, overdue: sinceDays === null ? 0 : Math.max(0, sinceDays - c.reminderDays) };
    })
    .sort((a, b) => b.overdue - a.overdue);
  const mission = due.find((c) => c.due) ?? null;
  const lastBook = reading.sort((a, b) => (a.gameDay < b.gameDay ? 1 : -1))[0] ?? null;
  return {
    contacts: due,
    interactions,
    thisWeek: interactions.length,
    peopleThisWeek: new Set(interactions.filter((i) => i.kind !== "collective").map((i) => i.contactId)).size,
    mission: mission ? { contact: mission, text: `Send one real message to ${mission.name}${mission.overdue ? ` (${mission.overdue} days past the gentle reminder)` : ""}. No streak, no penalty — just presence.` } : null,
    reading,
    pagesThisWeek: reading.reduce((s, r) => s + r.pages, 0),
    bedtime: lastBook ? { book: lastBook.book, text: `Tonight: 10 pages of “${lastBook.book}” before bed.` } : { book: null, text: "Pick a book for bedtime reading — ten pages, phone outside the room." },
    week,
  };
}

// ── Builder Hour (base + boss/duel bonus, ≤ 6 h bank, never bought with Gold) ──

async function builderState(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const week = weekStartSaturday(today);
  const no = weekNoOf(today);
  const closes = (await db.select().from(dayCloses).where(and(eq(dayCloses.userId, userId), gte(dayCloses.date, week), lte(dayCloses.date, today))));
  const consistency = consistencyRate(closes.map((c) => c.coreTier));
  const coreDays = closes.filter((c) => c.standardDay).length;
  const eligible = builderEligibility(consistency, coreDays, cfg.builder.minConsistency, cfg.builder.minCoreDays);
  const bossesDefeated = (await num(db, sql`SELECT count(*)::int AS v FROM bosses WHERE user_id = ${userId} AND week_no = ${no} AND defeated = true`));
  const duelsWon = (await num(db, sql`SELECT count(*)::int AS v FROM duels WHERE user_id = ${userId} AND week_no = ${no} AND winner = 'user'`));
  const credit = builderWeekCredit(eligible.eligible, bossesDefeated, duelsWon, cfg.builder.weeklyCapMinutes);
  const sessions = (await db.select().from(builderSessions).where(and(eq(builderSessions.userId, userId), gte(builderSessions.gameDay, week), lte(builderSessions.gameDay, today))));
  const bank = (await db.select().from(builderBank).where(eq(builderBank.userId, userId)));
  const sessionsUsed = sessions.reduce((s, x) => s + x.minutes, 0);
  const bankSum = bank.reduce((s, x) => s + x.minutes, 0);
  const available = Math.max(0, credit + bankSum - sessionsUsed);
  return { cfg, week, no, consistency, coreDays, eligible, bossesDefeated, duelsWon, credit, sessions, bank, sessionsUsed, bankSum, available };
}

export async function builderView(db: Db, userId: string, today: string) {
  const s = (await builderState(db, userId, today));
  const sessions = s.sessions.sort((a, b) => (a.gameDay < b.gameDay ? 1 : -1));
  const bank = [...s.bank].sort((a, b) => (a.gameDay < b.gameDay ? 1 : -1));
  const clamped = builderBalance([{ minutes: s.bankSum }], s.cfg.builder.bankCapMinutes);
  return {
    week: s.week,
    weekNo: s.no,
    eligible: s.eligible.eligible,
    consistency: s.consistency,
    coreDays: s.coreDays,
    minConsistency: s.cfg.builder.minConsistency,
    minCoreDays: s.cfg.builder.minCoreDays,
    credit: s.credit,
    available: s.available,
    used: s.sessionsUsed,
    bank: clamped.balance,
    bankCap: s.cfg.builder.bankCapMinutes,
    bossesDefeated: s.bossesDefeated,
    duelsWon: s.duelsWon,
    sessions,
    bankEntries: bank,
  };
}

export const builderInput = z.object({
  minutes: z.coerce.number().int().min(1).max(180),
  built: z.string().trim().min(3, "Write what you built in one line").max(300),
  ideaId: z.string().max(40).nullish(),
});

export async function logBuilder(db: Db, userId: string, today: string, input: z.input<typeof builderInput>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = builderInput.parse(input);
  const v = (await builderView(tx, userId, today));
  if (!v.eligible) throw new LifeDenied(`Builder Hour needs ≥ ${Math.round(v.minConsistency * 100)} % consistency and ${v.minCoreDays} Standard Core days this week`);
  if (v.available < d.minutes) throw new LifeDenied(`Only ${v.available} Builder minutes are available. Gold never buys Builder time.`);
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.insert(builderSessions).values({ id: newId(), userId, gameDay: today, minutes: d.minutes, built: d.built, ideaId: d.ideaId ?? null, createdAt: nowIso() }));
    (await appendEvent(tx, { userId, type: "builder.logged", payload: { minutes: d.minutes, built: d.built, ideaId: d.ideaId ?? null }, gameDay: today }));
  }));
  return { minutes: d.minutes, report: d.built };
});
}

export async function bankBuilder(db: Db, userId: string, today: string, minutes: number, reason: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const v = (await builderView(tx, userId, today));
  if (minutes <= 0) throw new LifeDenied("Bank minutes must be positive");
  if (v.available < minutes) throw new LifeDenied(`Only ${v.available} minutes are unused this week`);
  if (v.bank + minutes > v.bankCap) throw new LifeDenied(`The Builder bank is capped at ${v.bankCap} minutes`);
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.insert(builderBank).values({ id: newId(), userId, gameDay: today, minutes, reason: reason.trim() || "Unused Builder hour", createdAt: nowIso() }));
    (await appendEvent(tx, { userId, type: "builder.banked", payload: { minutes }, gameDay: today }));
  }));
  return { bank: v.bank + minutes };
});
}

// ── Quest Board + monthly challenge ─────────────────────────

async function boardMetrics(db: Db, userId: string, day: string): Promise<Record<BoardMetric, number>> {
  const tests = (await num(db, sql`SELECT sum(correct + wrong + blank) AS v FROM test_logs WHERE user_id = ${userId} AND game_day = ${day}`));
  const errors = (await num(db, sql`SELECT count(*)::int AS v FROM error_items WHERE user_id = ${userId} AND game_day = ${day}`));
  const cards = (await num(db, sql`SELECT count(*)::int AS v FROM events WHERE user_id = ${userId} AND type = 'review.answered' AND game_day = ${day}`));
  const core = (await db.select({ t: quests.tierDone }).from(quests).where(and(eq(quests.userId, userId), eq(quests.date, day), eq(quests.kind, "core"))).limit(1))[0];
  const pages = (await num(db, sql`SELECT sum(pages) AS v FROM reading_logs WHERE user_id = ${userId} AND game_day = ${day}`));
  const bonds = (await num(db, sql`SELECT count(*)::int AS v FROM bond_interactions WHERE user_id = ${userId} AND game_day = ${day}`));
  const body = (await num(db, sql`SELECT count(*)::int AS v FROM habit_logs l JOIN habits h ON h.id = l.habit_id WHERE l.user_id = ${userId} AND l.date = ${day} AND h.pillar = 'body' AND l.tier_done IS NOT NULL`));
  return { tests, errors, cards, core: tierRank(core?.t ?? null) >= 2 ? 1 : 0, pages, bonds, body };
}

export async function boardView(db: Db, userId: string, today: string) {
  const missions = boardMissions(today);
  const progress = boardProgress(missions, (await boardMetrics(db, userId, today)));
  const claim = (await db.select().from(boardClaims).where(and(eq(boardClaims.userId, userId), eq(boardClaims.gameDay, today))).limit(1))[0];
  return { day: today, ...progress, claimed: claim ?? null };
}

export async function claimBoard(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const v = (await boardView(tx, userId, today));
  if (v.claimed) throw new LifeDenied("Today's board is already claimed");
  if (!v.allDone) throw new LifeDenied("Finish all three board missions first — the board never pays halfway");
  const loot = "codex";
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.insert(boardClaims).values({ id: newId(), userId, gameDay: today, gold: v.gold, loot, createdAt: nowIso() }));
    (await appendEvent(tx, { userId, type: "board.claimed", payload: { gold: v.gold, loot }, gameDay: today }));
  }));
  return { gold: v.gold, loot };
});
}

export async function monthlyView(db: Db, userId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const month = today.slice(0, 7);
  const theme = monthlyTheme(month);
  const metrics = {
    standardDays: (await num(tx, sql`SELECT count(*)::int AS v FROM day_closes WHERE user_id = ${userId} AND to_char(date, 'YYYY-MM') = ${month} AND standard_day = true`)),
    errorAnalyses: (await num(tx, sql`SELECT count(*)::int AS v FROM error_items WHERE user_id = ${userId} AND to_char(game_day, 'YYYY-MM') = ${month}`)),
    duelsWon: (await num(tx, sql`SELECT count(*)::int AS v FROM duels WHERE user_id = ${userId} AND winner = 'user' AND to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = ${month}`)),
    builderMinutes: (await num(tx, sql`SELECT sum(minutes) AS v FROM builder_sessions WHERE user_id = ${userId} AND to_char(game_day, 'YYYY-MM') = ${month}`)),
  };
  const progress = monthlyProgress(theme, metrics);
  let badge = (await tx.select().from(monthlyBadges).where(and(eq(monthlyBadges.userId, userId), eq(monthlyBadges.monthKey, month))).limit(1))[0] ?? null;
  if (progress.done && !badge) {
    (await tx.insert(monthlyBadges).values({ userId, monthKey: month, badge: theme.name, awardedAt: nowIso() }).onConflictDoNothing());
    badge = (await tx.select().from(monthlyBadges).where(and(eq(monthlyBadges.userId, userId), eq(monthlyBadges.monthKey, month))).limit(1))[0] ?? null;
    (await appendEvent(tx, { userId, type: "badge.awarded", payload: { month, badge: theme.name }, gameDay: today }));
  }
  return { month, theme, metrics, progress, badge, badges: (await tx.select().from(monthlyBadges).where(eq(monthlyBadges.userId, userId)).orderBy(desc(monthlyBadges.monthKey))) };
});
}

// ── weekly escape dashboard (gentle) ────────────────────────

export async function escapeSeries(db: Db, userId: string, today: string, days = 7) {
  const since = addDaysIso(today, -(days - 1));
  const byDay = new Map<string, number>();
  for (const r of (await queryRows<{ d: string; m: number | null }>(db, sql`SELECT game_day AS d, sum(minutes) AS m FROM detours WHERE user_id = ${userId} AND game_day BETWEEN ${since} AND ${today} GROUP BY game_day`))) byDay.set(r.d, byDay.get(r.d) ?? 0);
  for (const r of (await queryRows<{ d: string; m: number | null }>(db, sql`SELECT date AS d, sum(escape_minutes) AS m FROM daily_checkins WHERE user_id = ${userId} AND date BETWEEN ${since} AND ${today} GROUP BY date`))) byDay.set(r.d, (byDay.get(r.d) ?? 0) + (r.m ?? 0));
  const series = Array.from({ length: days }, (_, i) => {
    const d = addDaysIso(since, i);
    return { day: d, minutes: byDay.get(d) ?? 0 };
  });
  const total = series.reduce((s, x) => s + x.minutes, 0);
  const study = (await num(db, sql`SELECT sum(minutes) AS v FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day BETWEEN ${since} AND ${today}`));
  const sharePct = study > 0 ? Math.round((total / study) * 1000) / 10 : 0;
  const peak = series.reduce((a, b) => (b.minutes > a.minutes ? b : a), series[0]!);
  const warning =
    total === 0
      ? "No escapes logged this week. That can be honest — or it can be a blind spot. Keep the ledger open."
      : sharePct > 10
        ? `${sharePct}% of your study time went to escapes. This is a gentle nudge, not a punishment: choose one hour tonight for the chapter, and park the rest in the Idea Vault.`
        : total > 180
          ? `${Math.round(total / 6) / 10} h of escapes this week, mostly around ${peak.day}. One planned break beats five unplanned ones.`
          : "Escapes are within a healthy range. Awareness is the win; no streak is at stake.";
  return { series, total, study, sharePct, peakDay: peak.day, warning };
}

// ── streak society, loot vault ──────────────────────────────

export async function streakView(db: Db, userId: string, today: string) {
  const closes = (await db.select().from(dayCloses).where(eq(dayCloses.userId, userId)).orderBy(asc(dayCloses.date)));
  const maxStreak = maxStandardRun(closes.map((c) => c.standardDay));
  const last30 = closes.filter((c) => c.date >= addDaysIso(today, -29));
  const consistency30 = consistencyRate(last30.map((c) => c.coreTier));
  return { maxStreak, consistency30, medals: streakSociety(maxStreak, consistency30) };
}

export async function lootView(db: Db, userId: string, today: string) {
  const rolls = (await db.select().from(lootRolls).where(eq(lootRolls.userId, userId)).orderBy(desc(lootRolls.date)).limit(30));
  const claims = (await db.select().from(boardClaims).where(eq(boardClaims.userId, userId)).orderBy(desc(boardClaims.gameDay)).limit(14));
  const todayRoll = rolls.find((r) => r.date === today) ?? null;
  const counts = { none: 0, codex: 0, cosmetic: 0, shield: 0 } as Record<string, number>;
  for (const r of rolls) counts[r.result] = (counts[r.result] ?? 0) + 1;
  return { today: todayRoll, rolls, claims, counts, pity: rolls[0]?.pityCounter ?? 0, chestOpen: !!todayRoll };
}
