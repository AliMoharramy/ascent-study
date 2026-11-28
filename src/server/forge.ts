import { and, asc, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, queryOne, type Db } from "@/db/client";
import { chapters, chapterState, errorItems, forgeArtifacts, reviewCards, testLogs } from "@/db/schema";
import { answerCard, newCard, type ReviewAnswer } from "@/domain/review";
import { clearStatus } from "@/domain/mastery";
import { appendEvent, EventRequestConflict, replayOf } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { addDaysIso } from "@/i18n/jalali";
import { newId, nowIso } from "@/lib/ids";

/**
 * Forge (T-R1-12, T-R2-02, T-R2-06 / F-ERR-01..04, F-MAP-02): error analysis log (cause + takeaway), spaced
 * review cards (every error makes a card), learning artifacts (Markdown), chapter state + Clear rule.
 */

export const CAUSES = ["concept", "calc", "time", "unread", "forgot", "careless"] as const;

export const errorInput = z.object({
  subjectId: z.string().max(40).nullish(),
  chapterId: z.string().max(60).nullish(),
  testLogId: z.string().max(40).nullish(),
  cause: z.enum(CAUSES),
  takeaway: z.string().trim().min(3, "Write the lesson learned (≥ 3 chars)").max(500),
  sourceRef: z.string().trim().max(120).nullish(),
  clientRequestId: z.string().max(80).nullish(),
});

export async function logError(db: Db, userId: string, input: z.input<typeof errorInput>, day: string): Promise<string> {
  const { clientRequestId, ...d } = errorInput.parse(input);
  return await withUserTransaction(db, userId, async (tx) => {
    const prior = await replayOf(tx, userId, "error.logged", clientRequestId, { ...d, day });
    if (prior) {
      const original = prior.payload.errorId;
      if (typeof original !== "string") throw new EventRequestConflict();
      return original;
    }
    const cfg = await activeConfig(tx, userId);
    const id = newId();
    await appendEvent(tx, { userId, type: "error.logged", payload: { errorId: id, cause: d.cause, chapterId: d.chapterId ?? null, analyzed: true, request: { ...d, day } }, gameDay: day, clientRequestId });
    const subjectId = d.subjectId ?? (d.chapterId ? (await tx.select({ s: chapters.subjectId }).from(chapters).where(eq(chapters.id, d.chapterId)).limit(1))[0]?.s ?? null : null);
    // same takeaway on the same chapter again → repeated mistake counter
    const repeated = d.chapterId ? (await queryOne<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM error_items WHERE user_id = ${userId} AND chapter_id = ${d.chapterId} AND cause = ${d.cause}`))?.n ?? 0 : 0;
    const now = nowIso();
    await tx.insert(errorItems).values({ id, userId, subjectId, chapterId: d.chapterId ?? null, testLogId: d.testLogId ?? null, cause: d.cause, takeaway: d.takeaway, sourceRef: d.sourceRef ?? null, repeatedCount: repeated, gameDay: day, createdAt: now, updatedAt: now });
    const c = newCard(day, cfg);
    await tx.insert(reviewCards).values({ id: newId(), userId, refType: "error", refId: id, chapterId: d.chapterId ?? null, front: `${d.sourceRef ? `${d.sourceRef} — ` : ""}Why did I get this wrong? (${d.cause})`, back: d.takeaway, step: c.step, reps: 0, dueOn: c.dueOn, createdAt: now, updatedAt: now });
    return id;
  });
}

export async function listErrors(db: Db, userId: string, f: { q?: string; cause?: string; subjectId?: string } = {}) {
  const conds = [eq(errorItems.userId, userId)];
  if (f.cause) conds.push(eq(errorItems.cause, f.cause as (typeof CAUSES)[number]));
  if (f.subjectId) conds.push(eq(errorItems.subjectId, f.subjectId));
  if (f.q) conds.push(or(like(errorItems.takeaway, `%${f.q}%`), like(errorItems.sourceRef, `%${f.q}%`))!);
  return (await db.select().from(errorItems).where(and(...conds)).orderBy(desc(errorItems.createdAt)).limit(300));
}

export async function causeBreakdown(db: Db, userId: string) {
  return (await db.select({ cause: errorItems.cause, n: sql<number>`count(*)::int` }).from(errorItems).where(eq(errorItems.userId, userId)).groupBy(errorItems.cause));
}

// ── review cards ─────────────────────────────────────────────

export async function dueCards(db: Db, userId: string, today: string) {
  return (await db.select().from(reviewCards).where(and(eq(reviewCards.userId, userId), lte(reviewCards.dueOn, today))).orderBy(asc(reviewCards.dueOn)).limit(200));
}

/** Exact owner-scoped due count plus a small preview for Today; answers stay in the review flow. */
export async function dueCardSummary(db: Db, userId: string, today: string, previewLimit = 4) {
  const condition = and(eq(reviewCards.userId, userId), lte(reviewCards.dueOn, today));
  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(reviewCards).where(condition);
  const limit = Math.max(1, Math.min(10, Math.floor(previewLimit) || 1));
  const cards = await db.select({ id: reviewCards.id, front: reviewCards.front, dueOn: reviewCards.dueOn, refType: reviewCards.refType })
    .from(reviewCards)
    .where(condition)
    .orderBy(asc(reviewCards.dueOn), asc(reviewCards.id))
    .limit(limit);
  return { count: total?.count ?? 0, cards };
}

export async function allCards(db: Db, userId: string) {
  return (await db.select().from(reviewCards).where(eq(reviewCards.userId, userId)).orderBy(asc(reviewCards.dueOn)).limit(500));
}

/**
 * Daily deck (F-LRN-16): due cards first, then cards born from the last 7 days of analysed errors — even when
 * their next interval is still in the future. Ten cards at ~30 s each fits the promised five minutes.
 */
export async function dailyDeck(db: Db, userId: string, today: string, limit = 10) {
  const due = (await dueCards(db, userId, today));
  const dueIds = new Set(due.map((c) => c.id));
  const since = addDaysIso(today, -7);
  const recent = (await db
    .select()
    .from(reviewCards)
    .where(and(eq(reviewCards.userId, userId), eq(reviewCards.refType, "error"), gte(reviewCards.createdAt, since)))
    .orderBy(desc(reviewCards.createdAt)))
    .filter((c) => !dueIds.has(c.id));
  return [...due, ...recent].slice(0, Math.max(1, limit)).map((c) => ({ ...c, why: dueIds.has(c.id) ? ("due" as const) : ("recent_error" as const) }));
}

export async function answerReview(db: Db, userId: string, cardId: string, answer: ReviewAnswer, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  const c = (await tx.select().from(reviewCards).where(and(eq(reviewCards.id, cardId), eq(reviewCards.userId, userId))).limit(1))[0];
  if (!c) throw new Error("Unknown card");
  const next = answerCard({ step: c.step, reps: c.reps, dueOn: c.dueOn }, answer, today, cfg);
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.update(reviewCards).set({ step: next.step, reps: next.reps, dueOn: next.dueOn, lastResult: answer, updatedAt: nowIso() }).where(eq(reviewCards.id, cardId)));
    (await appendEvent(tx, { userId, type: "review.answered", payload: { cardId, answer, nextDue: next.dueOn }, gameDay: today }));
  }));
  return next;
});
}

export const cardInput = z.object({ front: z.string().trim().min(1).max(500), back: z.string().trim().min(1).max(2000), chapterId: z.string().max(60).nullish() });

export async function createCard(db: Db, userId: string, input: z.input<typeof cardInput>, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = cardInput.parse(input);
  const c = newCard(today, (await activeConfig(tx, userId)));
  const now = nowIso();
  const id = newId();
  (await tx.insert(reviewCards).values({ id, userId, refType: "manual", refId: null, chapterId: d.chapterId ?? null, front: d.front, back: d.back, step: c.step, reps: 0, dueOn: c.dueOn, createdAt: now, updatedAt: now }));
  return id;
});
}

// ── artifacts ────────────────────────────────────────────────

export const artifactInput = z.object({ title: z.string().trim().min(2).max(160), bodyMd: z.string().max(20000), chapterId: z.string().max(60).nullish(), kind: z.enum(["sheet", "lesson", "summary", "formula"]).default("sheet") });

export async function saveArtifact(db: Db, userId: string, input: z.input<typeof artifactInput>, today: string, id?: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = artifactInput.parse(input);
  const now = nowIso();
  return (await withUserTransaction(tx, userId, async (tx) => {
    if (id) {
      (await tx.update(forgeArtifacts).set({ ...d, chapterId: d.chapterId ?? null, updatedAt: now }).where(and(eq(forgeArtifacts.id, id), eq(forgeArtifacts.userId, userId))));
      return id;
    }
    const nid = newId();
    (await tx.insert(forgeArtifacts).values({ id: nid, userId, ...d, chapterId: d.chapterId ?? null, createdAt: now, updatedAt: now }));
    (await appendEvent(tx, { userId, type: "forge.created", payload: { artifactId: nid, title: d.title, chapterId: d.chapterId ?? null }, gameDay: today }));
    // the first line becomes a review card (doc 07 §6.7: "lessons learned" of chapters)
    const firstLine = d.bodyMd.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean);
    if (firstLine) {
      const c = newCard(today, (await activeConfig(tx, userId)));
      (await tx.insert(reviewCards).values({ id: newId(), userId, refType: "artifact", refId: nid, chapterId: d.chapterId ?? null, front: d.title, back: firstLine.slice(0, 500), step: c.step, reps: 0, dueOn: c.dueOn, createdAt: now, updatedAt: now }));
    }
    return nid;
  }));
});
}

export async function listArtifacts(db: Db, userId: string, q?: string) {
  const conds = [eq(forgeArtifacts.userId, userId)];
  if (q) conds.push(or(like(forgeArtifacts.title, `%${q}%`), like(forgeArtifacts.bodyMd, `%${q}%`))!);
  return (await db.select().from(forgeArtifacts).where(and(...conds)).orderBy(desc(forgeArtifacts.updatedAt)));
}

// ── chapter state + Clear rule ───────────────────────────────

/** Recomputes chapter_state from its test logs; emits `chapter.cleared` once when the rule is met. */
export async function updateChapterState(db: Db, userId: string, chapterId: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const cfg = (await activeConfig(tx, userId));
  const logs = (await tx.select().from(testLogs).where(and(eq(testLogs.userId, userId), eq(testLogs.chapterId, chapterId))).orderBy(asc(testLogs.gameDay)));
  const st = clearStatus(logs, cfg);
  const tot = logs.reduce((s, l) => ({ c: s.c + l.correct, w: s.w + l.wrong, b: s.b + l.blank }), { c: 0, w: 0, b: 0 });
  const q = tot.c + tot.w + tot.b;
  const net = q ? ((tot.c - tot.w / 3) / q) * 100 : null;
  const prev = (await tx.select().from(chapterState).where(and(eq(chapterState.userId, userId), eq(chapterState.chapterId, chapterId))).limit(1))[0];
  const vals = { a: net !== null ? Math.max(0, net) / 100 : null, netPct: net, sessionsCleared: st.passing.length, lastTestAt: logs.at(-1)?.loggedAt ?? null, clearedAt: prev?.clearedAt ?? (st.cleared ? st.clearedOn : null) };
  if (prev) (await tx.update(chapterState).set(vals).where(and(eq(chapterState.userId, userId), eq(chapterState.chapterId, chapterId))));
  else (await tx.insert(chapterState).values({ chapterId, userId, ...vals }));
  if (st.cleared && !prev?.clearedAt) {
    const tier = (await tx.select({ t: chapters.tier }).from(chapters).where(eq(chapters.id, chapterId)).limit(1))[0]?.t ?? "S";
    (await appendEvent(tx, { userId, type: "chapter.cleared", payload: { chapterId, tier, on: st.clearedOn, why: st.why }, gameDay: st.clearedOn ?? undefined }));
    return { cleared: true, status: st };
  }
  return { cleared: false, status: st };
});
}

export async function setA0(db: Db, userId: string, chapterId: string, a0: number) {
  return await withUserTransaction(db, userId, async (tx) => {
  const prev = (await tx.select().from(chapterState).where(and(eq(chapterState.userId, userId), eq(chapterState.chapterId, chapterId))).limit(1))[0];
  if (prev) (await tx.update(chapterState).set({ a0 }).where(and(eq(chapterState.userId, userId), eq(chapterState.chapterId, chapterId))));
  else (await tx.insert(chapterState).values({ chapterId, userId, a0 }));
});
}
