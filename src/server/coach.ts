import { and, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, queryOne, type Db } from "@/db/client";
import { dayCloses, errorItems, sleepLogs } from "@/db/schema";
import { localCoachReply, routeIntent, type CoachContext, type CoachIntent } from "@/domain/coach";
import { lightenWeek, type LightenProposal } from "@/domain/negotiate";
import { sleepDebt } from "@/domain/wellness";
import { appendEvent } from "@/events/store";
import { activeConfig } from "@/events/projections";
import { addDaysIso } from "@/i18n/jalali";
import { daysToExam, TOTAL_WEEKS, weekNoOf, weekStartOf } from "@/lib/campaign";
import { newId, nowIso } from "@/lib/ids";
import { remoteCall } from "./ai";
import { burnoutView } from "./burnout";
import { dueCards } from "./forge";
import { getKv, setKv } from "./kv";
import { ensurePlan, moveItem, weekItemsFor } from "./plan";

/**
 * Archie coach chat + plan negotiator (#102, F-AIX-01/02). Deterministic local coach always works; remote AI
 * (when enabled) receives ONLY the numeric context + routed intent — never the raw chat text (F-AI-06).
 * Plan changes are drafted as proposals and applied ONLY on explicit approval.
 */

export class ProposalDenied extends Error {}

export interface CoachMsg {
  id: string;
  role: "user" | "coach";
  text: string;
  intent: CoachIntent | null;
  at: string;
}

interface StoredProposal {
  id: string;
  proposal: LightenProposal;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

const CHAT_KEY = "coach.chat";
const PROPOSAL_KEY = "coach.proposal";
const CHAT_CAP = 60;

const chatOf = async (db: Db, userId: string) => (await getKv<CoachMsg[]>(db, userId, CHAT_KEY, []));
const proposalOf = async (db: Db, userId: string) => (await getKv<StoredProposal | null>(db, userId, PROPOSAL_KEY, null));

export const coachMessageInput = z.object({ text: z.string().trim().min(1).max(500) });

async function coachContext(db: Db, userId: string, today: string): Promise<CoachContext> {
  const week = weekNoOf(today);
  const start = weekStartOf(week);
  const end = addDaysIso(start, 6);
  const todayXp = (await queryOne<{ v: number | null }>(db, sql`SELECT coalesce(sum(amount),0) v FROM xp_ledger WHERE user_id = ${userId} AND game_day = ${today}`))?.v ?? 0;
  const focusMin = (await queryOne<{ v: number | null }>(db, sql`SELECT coalesce(sum(minutes),0) v FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND game_day BETWEEN ${start} AND ${end}`))?.v ?? 0;
  const planMin = (await weekItemsFor(db, userId, week)).reduce((s, i) => s + i.plannedMin, 0);
  const closes = (await db.select({ std: dayCloses.standardDay }).from(dayCloses).where(and(eq(dayCloses.userId, userId), gte(dayCloses.date, start), lte(dayCloses.date, end))));
  const t = (await queryOne<{ c: number; w: number; b: number }>(db, sql`SELECT coalesce(sum(correct),0) c, coalesce(sum(wrong),0) w, coalesce(sum(blank),0) b FROM test_logs WHERE user_id = ${userId} AND game_day BETWEEN ${start} AND ${end}`))!;
  const q = t.c + t.w + t.b;
  const sleeps = (await db.select({ date: sleepLogs.date, minutes: sleepLogs.minutes }).from(sleepLogs).where(eq(sleepLogs.userId, userId)));
  const lastWeek = sleeps.filter((n) => n.date >= addDaysIso(today, -6) && n.date <= today);
  const errors = (await db.select({ cause: errorItems.cause }).from(errorItems).where(eq(errorItems.userId, userId)));
  const byCause = new Map<string, number>();
  for (const e of errors) byCause.set(e.cause, (byCause.get(e.cause) ?? 0) + 1);
  const topCause = [...byCause.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    weekNo: week,
    daysToExam: daysToExam(today),
    todayXp: Math.round(todayXp),
    weekHours: Math.round((focusMin / 60) * 10) / 10,
    planWeekHours: Math.round((planMin / 60) * 10) / 10,
    consistencyPct: closes.length ? Math.round((closes.filter((c) => c.std).length / closes.length) * 100) : 0,
    netPct: q ? Math.round(((t.c - t.w / 3) / q) * 1000) / 10 : null,
    sleepAvgHours: lastWeek.length ? Math.round((lastWeek.reduce((s, n) => s + n.minutes, 0) / lastWeek.length / 60) * 10) / 10 : null,
    sleepDebtHours: sleepDebt(sleeps, (await activeConfig(db, userId)).sleep.minSleepHours, today).debtHours,
    burnoutLevel: (await burnoutView(db, userId, today)).level,
    dueCards: (await dueCards(db, userId, today)).length,
    openErrors: errors.length,
    topCause,
  };
}

export async function coachView(db: Db, userId: string, today: string) {
  const cfg = (await activeConfig(db, userId));
  const baseUrl = cfg.ai.baseUrl.trim() || process.env.AI_BASE_URL?.trim() || "";
  return { messages: (await chatOf(db, userId)), proposal: (await proposalOf(db, userId)), context: (await coachContext(db, userId, today)), remoteReady: cfg.flags.ai && !!process.env.AI_KEY?.trim() && baseUrl.length > 0 };
}

const replySchema = z.object({ reply: z.string().min(1).max(900) });

async function pushMsg(db: Db, userId: string, msg: Omit<CoachMsg, "id" | "at">) {
  return await withUserTransaction(db, userId, async (tx) => {
  const all = [...(await chatOf(tx, userId)), { ...msg, id: newId(), at: nowIso() }].slice(-CHAT_CAP);
  (await setKv(tx, userId, CHAT_KEY, all));
  return all;
});
}

export async function sendCoachMessage(db: Db, userId: string, text: string, today: string) {
  const p = coachMessageInput.parse({ text });
  const cfg = (await activeConfig(db, userId));
  const intent = routeIntent(p.text);
  const ctx = (await coachContext(db, userId, today));
  (await pushMsg(db, userId, { role: "user", text: p.text, intent }));

  let proposal = (await proposalOf(db, userId));
  if (intent === "lighten") {
    (await ensurePlan(db, userId, today, cfg));
    const items = (await weekItemsFor(db, userId, ctx.weekNo)).map((i) => ({ id: i.id, chapterId: i.chapterId, tier: i.tier, plannedMin: i.plannedMin, weekNo: i.weekNo }));
    const drafted = lightenWeek(items, ctx.weekNo, TOTAL_WEEKS);
    proposal = drafted ? { id: newId(), proposal: drafted, status: "pending", createdAt: nowIso() } : null;
    (await setKv(db, userId, PROPOSAL_KEY, proposal));
  }

  let reply = localCoachReply(intent, ctx);
  if (intent === "lighten") {
    reply = proposal
      ? `${reply}\n\nDraft ready: move ${proposal.proposal.changes.length} item(s) (${Math.round(proposal.proposal.movedMin / 60 * 10) / 10} h) from week ${proposal.proposal.weekNo} to week ${proposal.proposal.weekNo + 1}. Week load ${Math.round(proposal.proposal.beforeMin / 60 * 10) / 10} h → ${Math.round(proposal.proposal.afterMin / 60 * 10) / 10} h. Approve or reject below — nothing moves until you approve.`
      : "I could not draft a lighter week: either this is the final week, or every remaining item is core (M) and core never moves. Consider a Rest Day Pass instead.";
  }
  // Remote gets numeric aggregates + intent only; the raw user text never leaves the device.
  const remote = await remoteCall(db, userId, "coach_chat", "You are Archie, a calm study coach. Reply ONLY JSON {reply}, ≤ 900 chars, second person, no blame. Base every claim on the numeric context. Never claim a plan change happened — proposals require explicit approval.", JSON.stringify({ intent, context: ctx }), replySchema, today);
  if (remote) reply = intent === "lighten" ? `${remote.value.reply}\n\n${reply.split("\n\n").slice(1).join("\n\n")}` : remote.value.reply;
  (await appendEvent(db, { userId, type: "coach.message", payload: { intent, provider: remote ? "remote" : "local" }, gameDay: today }));
  const messages = (await pushMsg(db, userId, { role: "coach", text: reply, intent }));
  return { messages, proposal: (await proposalOf(db, userId)), provider: remote ? ("remote" as const) : ("local" as const) };
}

async function requirePending(db: Db, userId: string, proposalId: string): Promise<StoredProposal> {
  const stored = (await proposalOf(db, userId));
  if (!stored || stored.id !== proposalId || stored.status !== "pending") throw new ProposalDenied("No pending proposal with that id — ask Archie for a fresh draft.");
  return stored;
}

/** The ONLY path that changes the plan from chat: explicit approval of a specific proposal. */
export async function approveProposal(db: Db, userId: string, proposalId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const stored = (await requirePending(tx, userId, proposalId));
  (await withUserTransaction(tx, userId, async (tx) => {
    for (const c of stored.proposal.changes) (await moveItem(tx, userId, c.itemId, c.toWeek));
    (await appendEvent(tx, { userId, type: "plan.negotiated", payload: { proposalId, decision: "approved", weekNo: stored.proposal.weekNo, movedMin: stored.proposal.movedMin, items: stored.proposal.changes.length }, gameDay: today }));
  }));
  (await setKv(tx, userId, PROPOSAL_KEY, { ...stored, status: "approved" }));
  const messages = (await pushMsg(tx, userId, { role: "coach", text: `Done — ${stored.proposal.changes.length} item(s) moved to week ${stored.proposal.weekNo + 1}. This week is now ${Math.round(stored.proposal.afterMin / 60 * 10) / 10} h. The plan page reflects it.`, intent: "lighten" }));
  return { messages, proposal: (await proposalOf(tx, userId)) };
});
}

export async function rejectProposal(db: Db, userId: string, proposalId: string, today: string) {
  return await withUserTransaction(db, userId, async (tx) => {
  const stored = (await requirePending(tx, userId, proposalId));
  (await setKv(tx, userId, PROPOSAL_KEY, { ...stored, status: "rejected" }));
  (await appendEvent(tx, { userId, type: "plan.negotiated", payload: { proposalId, decision: "rejected", weekNo: stored.proposal.weekNo }, gameDay: today }));
  const messages = (await pushMsg(tx, userId, { role: "coach", text: "Rejected — the plan stays exactly as it was. If the load still feels wrong, tell me and we can try a different angle.", intent: "lighten" }));
  return { messages, proposal: (await proposalOf(tx, userId)) };
});
}
