import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { withUserTransaction, type Db } from "@/db/client";
import { errorItems, events, focusSessions, ideas, reviewCards, testLogs } from "@/db/schema";
import { appendEvent } from "@/events/store";
import { activeConfig } from "@/events/projections";

/**
 * Undo (F-LOG-08): within `undo.windowMinutes` (10) the last logging actions can be reversed. Undo never
 * deletes history: it appends `event.undone` (the projection skips the target) and removes the derived row.
 */

const UNDOABLE = ["focus.stopped", "focus.manual", "test.logged", "error.logged", "idea.parked"] as const;

export async function undoable(db: Db, userId: string, now = new Date()) {
  const cfg = await activeConfig(db, userId);
  const since = new Date(now.getTime() - cfg.undo.windowMinutes * 60_000).toISOString();
  const undone = await db
    .select({ p: events.payloadJson })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.type, "event.undone"), gte(events.createdAt, since)));
  const done = new Set(undone.map((r) => (JSON.parse(r.p) as { targetId: string }).targetId));
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), inArray(events.type, [...UNDOABLE]), gte(events.createdAt, since)))
    .orderBy(desc(events.createdAt));
  return rows
    .filter((e) => !done.has(e.id))
    .map((e) => ({ id: e.id, type: e.type, at: e.createdAt, gameDay: e.gameDay, payload: JSON.parse(e.payloadJson) as Record<string, unknown> }));
}

export class UndoDenied extends Error {}

/** The eligibility check and the reversal share one user-locked transaction, so a double undo cannot apply twice. */
export async function undoEvent(db: Db, userId: string, eventId: string, now = new Date()) {
  return await withUserTransaction(db, userId, async (tx) => {
    const e = (await undoable(tx, userId, now)).find((x) => x.id === eventId);
    if (!e) throw new UndoDenied("Nothing to undo (only the last 10 minutes can be undone)");
    const p = e.payload;
    if ((e.type === "focus.stopped" || e.type === "focus.manual") && typeof p.sessionId === "string") {
      await tx.delete(focusSessions).where(and(eq(focusSessions.id, p.sessionId), eq(focusSessions.userId, userId)));
    }
    if (e.type === "test.logged" && typeof p.testLogId === "string") {
      await tx.delete(testLogs).where(and(eq(testLogs.id, p.testLogId), eq(testLogs.userId, userId)));
    }
    if (e.type === "error.logged" && typeof p.errorId === "string") {
      await tx.delete(errorItems).where(and(eq(errorItems.id, p.errorId), eq(errorItems.userId, userId)));
      await tx.delete(reviewCards).where(and(eq(reviewCards.refId, p.errorId), eq(reviewCards.userId, userId)));
    }
    if (e.type === "idea.parked" && typeof p.ideaId === "string") {
      await tx.delete(ideas).where(and(eq(ideas.id, p.ideaId), eq(ideas.userId, userId)));
    }
    await appendEvent(tx, { userId, type: "event.undone", payload: { targetId: e.id, targetType: e.type, targetDay: e.gameDay }, gameDay: e.gameDay ?? undefined });
    return e;
  });
}
