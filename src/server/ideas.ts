import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, queryOne, queryRows, type Db } from "@/db/client";
import { detours, ideas, quests } from "@/db/schema";
import { tierRank } from "@/domain/quests";
import { appendEvent, EventRequestConflict, replayOf } from "@/events/store";
import { addDaysIso } from "@/i18n/jalali";
import { newId, nowIso } from "@/lib/ids";

/** Idea Vault + Detour Detector (T-R1-13 / F-IDEA-01/03, doc 05 §9). Ideas are parked; no hard locks. */

export const ideaInput = z.object({
  text: z.string().trim().min(2).max(400),
  tags: z.string().trim().max(120).default(""),
  value: z.coerce.number().int().min(1).max(5).nullish(),
  effort: z.enum(["S", "M", "L"]).nullish(),
  whyNow: z.string().trim().max(200).nullish(),
  clientRequestId: z.string().max(80).nullish(),
});

export async function parkIdea(db: Db, userId: string, input: z.input<typeof ideaInput>) {
  const { clientRequestId, ...d } = ideaInput.parse(input);
  return await withUserTransaction(db, userId, async (tx) => {
    const prior = await replayOf(tx, userId, "idea.parked", clientRequestId, d);
    if (prior) {
      const original = prior.payload.ideaId;
      if (typeof original !== "string") throw new EventRequestConflict();
      return original;
    }
    const id = newId();
    const now = nowIso();
    await appendEvent(tx, { userId, type: "idea.parked", payload: { ideaId: id, tags: d.tags, request: d }, clientRequestId });
    await tx.insert(ideas).values({ id, userId, text: d.text, tags: d.tags, value: d.value ?? null, effort: d.effort ?? null, whyNow: d.whyNow ?? null, status: "parked", createdAt: now, updatedAt: now });
    return id;
  });
}

export async function updateIdea(db: Db, userId: string, id: string, patch: Partial<{ status: "parked" | "chosen" | "built" | "dropped"; value: number; effort: "S" | "M" | "L" }>) {
  return await withUserTransaction(db, userId, async (tx) => {
  const p = z.object({ status: z.enum(["parked", "chosen", "built", "dropped"]).optional(), value: z.number().int().min(1).max(5).optional(), effort: z.enum(["S", "M", "L"]).optional() }).parse(patch);
  (await tx.update(ideas).set({ ...p, updatedAt: nowIso() }).where(and(eq(ideas.id, id), eq(ideas.userId, userId))));
  (await appendEvent(tx, { userId, type: "idea.updated", payload: { ideaId: id, ...p } }));
});
}

const EFFORT_W = { S: 1, M: 2, L: 3 } as const;

/** Parked ideas ranked by value / effort (Builder Hour picks the top). */
export async function listIdeas(db: Db, userId: string) {
  return (await db
    .select()
    .from(ideas)
    .where(eq(ideas.userId, userId))
    .orderBy(desc(ideas.createdAt)))
    .map((i) => ({ ...i, score: i.value ? i.value / EFFORT_W[i.effort ?? "M"] : 0 }))
    .sort((a, b) => (a.status === "parked" ? 0 : 1) - (b.status === "parked" ? 0 : 1) || b.score - a.score);
}

/** Is today's Core done (≥ Standard)? Drives the friction modal. */
export async function coreDone(db: Db, userId: string, day: string): Promise<boolean> {
  const core = (await db.select({ t: quests.tierDone }).from(quests).where(and(eq(quests.userId, userId), eq(quests.date, day), eq(quests.kind, "core"))).limit(1))[0];
  return tierRank(core?.t ?? null) >= 2;
}

export const detourInput = z.object({
  kind: z.enum(["coding", "new_idea", "social", "video", "games", "news", "builder", "other"]),
  choice: z.enum(["study_first", "later", "continue"]),
  minutes: z.coerce.number().int().min(0).max(600).default(0),
  reason: z.string().trim().max(200).nullish(),
  wasPrompted: z.boolean().default(true),
});

export async function logDetour(db: Db, userId: string, input: z.input<typeof detourInput>, day: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const d = detourInput.parse(input);
  if (d.choice === "later" && !d.reason) throw new z.ZodError([{ code: "custom", path: ["reason"], message: "Write why (one line) — awareness is the point", input: d.reason }]);
  const id = newId();
  (await withUserTransaction(tx, userId, async (tx) => {
    (await tx.insert(detours).values({ id, userId, startedAt: nowIso(), gameDay: day, minutes: d.minutes, kind: d.kind, reason: d.reason ?? null, wasPrompted: d.wasPrompted, choice: d.choice, createdAt: nowIso() }));
    (await appendEvent(tx, { userId, type: "detour.logged", payload: { detourId: id, kind: d.kind, choice: d.choice, minutes: d.minutes }, gameDay: day }));
  }));
  return id;
});
}

/**
 * Detour Ledger (F-INS-04) + anti-goal report (F-INS-09): escape minutes and causes over N days, plus the
 * share of Builder/site time against real study minutes. The 10 % ceiling comes from doc 01 §9 — it is
 * awareness only, never a lock (A2).
 */
export async function detourLedger(db: Db, userId: string, today: string, days = 7) {
  const since = addDaysIso(today, -(days - 1));
  const rows = (await db.select().from(detours).where(and(eq(detours.userId, userId), gte(detours.gameDay, since), lte(detours.gameDay, today))));
  const esc = (await queryRows<{ kind: string | null; m: number | null }>(db, sql`SELECT escape_kind AS kind, sum(escape_minutes) AS m FROM daily_checkins WHERE user_id = ${userId} AND date >= ${since} AND date <= ${today} GROUP BY escape_kind`));
  const byKind = new Map<string, number>();
  for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + r.minutes);
  for (const e of esc) if (e.kind) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + (e.m ?? 0));
  const hours = new Map<number, number>();
  for (const r of rows) {
    const h = (new Date(r.startedAt).getUTCHours() + 3 + (new Date(r.startedAt).getUTCMinutes() + 30 >= 60 ? 1 : 0)) % 24;
    hours.set(h, (hours.get(h) ?? 0) + 1);
  }
  const totalMinutes = [...byKind.values()].reduce((a, b) => a + b, 0);
  const studyMinutes = (await queryOne<{ m: number | null }>(db, sql`SELECT sum(minutes) AS m FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day >= ${since} AND game_day <= ${today}`))?.m ?? 0;
  // Builder/site time is the part of the ledger that is not study and not a pure escape: the anti-goal in doc 01 §9.
  const builderMinutes = rows.filter((r) => r.kind === "builder").reduce((a, r) => a + r.minutes, 0);
  const sharePct = studyMinutes > 0 ? Math.round((builderMinutes / studyMinutes) * 1000) / 10 : 0;
  return {
    totalMinutes,
    topKinds: [...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([kind, minutes]) => ({ kind, minutes })),
    reasons: rows.filter((r) => r.reason).map((r) => r.reason!).slice(0, 10),
    riskyHours: [...hours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([hour, n]) => ({ hour, n })),
    prompted: rows.length,
    studyFirst: rows.filter((r) => r.choice === "study_first").length,
    studyMinutes,
    builderMinutes,
    sharePct,
    overLimit: studyMinutes > 0 && sharePct > 10,
  };
}
