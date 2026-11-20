import { isDeepStrictEqual } from "node:util";
import { and, asc, eq } from "drizzle-orm";
import { withUserTransaction, type Db } from "@/db/client";
import { events, users } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";
import { gameDay as toGameDay } from "@/lib/time";
import { PROJECTED, type EventType } from "./types";
import { projectDay } from "./projections";

/** Append-only events and their projections commit together under the user's transaction lock. */
export interface AppendInput {
  userId: string;
  type: EventType;
  payload: Record<string, unknown>;
  occurredAt?: string;
  /** Game day the event belongs to (defaults to the occurredAt instant in the user's tz/rollover). */
  gameDay?: string;
  clientRequestId?: string | null;
  configVersion?: number | null;
  source?: "app" | "import" | "job" | "system";
}

export type StoredEvent = typeof events.$inferSelect & { payload: Record<string, unknown> };
export class EventRequestConflict extends Error {
  constructor() { super("Request key already used for different or unavailable input"); }
}

const jsonValue = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** Read only: domain callers must hold withUserTransaction while checking and writing the result. */
export async function findRequestEvent(db: Db, userId: string, clientRequestId?: string | null): Promise<StoredEvent | undefined> {
  if (clientRequestId == null) return undefined;
  const row = (await db.select().from(events).where(and(eq(events.userId, userId), eq(events.clientRequestId, clientRequestId))).limit(1))[0];
  return row ? { ...row, payload: JSON.parse(row.payloadJson) as Record<string, unknown> } : undefined;
}

/** Services record normalized input separately from generated IDs/times, so retries return the original result. */
export function assertSameRequest(event: StoredEvent, type: EventType, request: Record<string, unknown>): void {
  if (event.type !== type || !isDeepStrictEqual(event.payload.request, jsonValue(request))) throw new EventRequestConflict();
}

/**
 * Retry gate for idempotent writes. Call it INSIDE the user's transaction, before generating any id or writing:
 * it returns the original event of a retried request (so the caller can hand back the original result) and throws
 * EventRequestConflict when the same key is reused for a different request. `undefined` means a new request.
 */
export async function replayOf(db: Db, userId: string, type: EventType, clientRequestId: string | null | undefined, request: Record<string, unknown>): Promise<StoredEvent | undefined> {
  const prior = await findRequestEvent(db, userId, clientRequestId);
  if (prior) assertSameRequest(prior, type, request);
  return prior;
}

export async function dayFor(db: Db, userId: string, at: string): Promise<string> {
  const u = (await db.select({ tz: users.timezone, r: users.rolloverHour }).from(users).where(eq(users.id, userId)).limit(1))[0];
  return toGameDay(new Date(at), u?.tz, u?.r);
}

export async function appendEvent(db: Db, input: AppendInput): Promise<{ id: string; duplicate: boolean }> {
  return await withUserTransaction(db, input.userId, async (tx) => {
    const existing = await findRequestEvent(tx, input.userId, input.clientRequestId);
    if (existing) {
      if (existing.type !== input.type || !isDeepStrictEqual(existing.payload, jsonValue(input.payload)) ||
          (input.gameDay !== undefined && existing.gameDay !== input.gameDay) ||
          (input.source !== undefined && existing.source !== input.source) ||
          (input.configVersion !== undefined && existing.configVersion !== input.configVersion)) throw new EventRequestConflict();
      return { id: existing.id, duplicate: true };
    }
    const id = newId();
    const occurredAt = new Date(input.occurredAt ?? nowIso()).toISOString();
    const day = input.gameDay ?? (typeof input.payload.gameDay === "string" ? input.payload.gameDay : await dayFor(tx, input.userId, occurredAt));
    await tx.insert(events).values({
      id, userId: input.userId, type: input.type, payloadJson: JSON.stringify(input.payload), occurredAt,
      clientRequestId: input.clientRequestId ?? null, configVersion: input.configVersion ?? null,
      source: input.source ?? "app", createdAt: nowIso(), gameDay: day,
    });
    const days = new Set<string>();
    if (PROJECTED.has(input.type)) days.add(day);
    if ((input.type === "event.undone" || input.type === "test.deleted") && typeof input.payload.targetDay === "string") days.add(input.payload.targetDay);
    for (const targetDay of days) await projectDay(tx, input.userId, targetDay);
    return { id, duplicate: false };
  });
}

export async function listEvents(db: Db, userId: string, type?: EventType): Promise<StoredEvent[]> {
  const where = type ? and(eq(events.userId, userId), eq(events.type, type)) : eq(events.userId, userId);
  return (await db.select().from(events).where(where).orderBy(asc(events.occurredAt), asc(events.id)))
    .map((e) => ({ ...e, payload: JSON.parse(e.payloadJson) as Record<string, unknown> }));
}
