import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { events, reviews, wellnessLogs } from "@/db/schema";
import { appendEvent } from "@/events/store";
import { logError } from "./forge";
import { manualFocus } from "./focus";
import { parkIdea } from "./ideas";
import { saveNightly } from "./reviews";
import { logTest } from "./tests";
import { logWellness } from "./wellness";
import { gameDay } from "@/lib/time";

/**
 * Offline sync queue (#107, F-CORE-06). The browser keeps an IndexedDB outbox of quick-log mutations;
 * this endpoint replays them in order. Idempotency rides on `client_request_id` (event store), and the
 * two upsert surfaces (wellness, nightly review) resolve by last-write-wins on timestamps — every
 * conflict is recorded in the `sync.replay` event, so nothing is ever silently dropped.
 */

export const SYNC_KINDS = ["test", "idea", "error", "wellness", "nightly", "focus"] as const;

export const syncItem = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(SYNC_KINDS),
  body: z.record(z.string(), z.unknown()),
  createdAt: z.string().min(10).max(40),
});

export const syncInput = z.object({ items: z.array(syncItem).min(1).max(100) });

export type SyncStatus = "applied" | "duplicate" | "conflict" | "invalid";
export interface SyncResult {
  id: string;
  kind: (typeof SYNC_KINDS)[number];
  status: SyncStatus;
  message?: string;
}

async function alreadySeen(db: Db, userId: string, requestId: string): Promise<boolean> {
  return !!(await db.select({ id: events.id }).from(events).where(and(eq(events.userId, userId), eq(events.clientRequestId, requestId))).limit(1))[0];
}

/** LWW for upsert surfaces: the newer timestamp wins; a server-newer row blocks the stale replay. */
function serverNewer(updatedAt: string | undefined, createdAt: string): boolean {
  return !!updatedAt && updatedAt > createdAt;
}

async function applyItem(tx: Db, userId: string, item: z.output<typeof syncItem>, at: Date, opts: { tz?: string; rolloverHour?: number }): Promise<SyncResult> {
  if (await alreadySeen(tx, userId, item.id)) return { id: item.id, kind: item.kind, status: "duplicate" };
  const day = gameDay(at, opts.tz, opts.rolloverHour);
  const body = { ...item.body, clientRequestId: item.id };
  const done = (status: SyncStatus, message?: string): SyncResult => ({ id: item.id, kind: item.kind, status, ...(message ? { message } : {}) });
  try {
    switch (item.kind) {
      case "test":
        await logTest(tx, userId, body as never, { now: at, tz: opts.tz, rolloverHour: opts.rolloverHour });
        return done("applied");
      case "idea":
        await parkIdea(tx, userId, body as never);
        return done("applied");
      case "error":
        await logError(tx, userId, body as never, day);
        return done("applied");
      case "focus": {
        const r = await manualFocus(tx, userId, body as never, { now: at, tz: opts.tz, rolloverHour: opts.rolloverHour });
        return done(r ? "applied" : "duplicate");
      }
      case "wellness": {
        const row = (await tx.select({ updatedAt: wellnessLogs.updatedAt }).from(wellnessLogs).where(and(eq(wellnessLogs.userId, userId), eq(wellnessLogs.date, day))).limit(1))[0];
        if (serverNewer(row?.updatedAt, item.createdAt)) return done("conflict", `Server check-in for ${day} is newer — kept`);
        await logWellness(tx, userId, day, body as never);
        return done("applied");
      }
      case "nightly": {
        const row = (await tx.select({ updatedAt: reviews.updatedAt }).from(reviews).where(and(eq(reviews.userId, userId), eq(reviews.kind, "nightly"), eq(reviews.date, day))).limit(1))[0];
        if (serverNewer(row?.updatedAt, item.createdAt)) return done("conflict", `Server nightly review for ${day} is newer — kept`);
        const { action: _action, ...rest } = body as { action?: string } & Record<string, unknown>;
        await saveNightly(tx, userId, day, rest as never);
        return done("applied");
      }
    }
  } catch (e) {
    // The failed service ran in its own savepoint, so the surrounding transaction is still usable.
    return done("invalid", e instanceof Error ? e.message : "Rejected");
  }
}

export async function replaySync(db: Db, userId: string, input: z.input<typeof syncInput>, opts: { tz?: string; rolloverHour?: number; today: string }) {
  const { items } = syncInput.parse(input);
  const results: SyncResult[] = [];
  for (const item of items) {
    const at = new Date(item.createdAt);
    if (Number.isNaN(at.getTime())) {
      results.push({ id: item.id, kind: item.kind, status: "invalid", message: "Bad createdAt timestamp" });
      continue;
    }
    // The duplicate check and the write share one user-locked transaction, so two replays of the same item
    // (a double-tap, two tabs, a retried request) can never both apply it.
    results.push(await withUserTransaction(db, userId, (tx) => applyItem(tx, userId, item, at, opts)));
  }
  const count = (s: SyncStatus) => results.filter((r) => r.status === s).length;
  await appendEvent(db, {
    userId,
    type: "sync.replay",
    payload: { received: items.length, applied: count("applied"), duplicates: count("duplicate"), conflicts: count("conflict"), invalid: count("invalid"), items: results },
    gameDay: opts.today,
  });
  return { results, applied: count("applied"), duplicates: count("duplicate"), conflicts: count("conflict"), invalid: count("invalid") };
}