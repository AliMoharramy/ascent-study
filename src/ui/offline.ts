"use client";

/**
 * Offline outbox (#107, F-CORE-06). Quick-log mutations that can't reach the server are parked in
 * IndexedDB with a stable clientRequestId + createdAt, then replayed through /api/sync when the
 * connection returns. The server resolves duplicates idempotently and upserts by last-write-wins.
 */

import { apiFetch, requestId } from "./client";

export interface OutboxItem {
  id: string;
  kind: "test" | "idea" | "error" | "wellness" | "nightly" | "focus";
  body: Record<string, unknown>;
  createdAt: string;
  error?: string;
}

/** URL → outbox kind. Only quick-log surfaces queue; everything else fails loudly as before. */
const QUEUEABLE: Record<string, OutboxItem["kind"]> = {
  "/api/tests": "test",
  "/api/ideas": "idea",
  "/api/errors": "error",
  "/api/wellness": "wellness",
  "/api/reviews": "nightly",
  "/api/focus/manual": "focus",
};

export function queueableKind(url: string, body: unknown): OutboxItem["kind"] | null {
  const kind = QUEUEABLE[url.split("?")[0]!] ?? null;
  if (!kind) return null;
  const action = body && typeof body === "object" ? (body as { action?: string }).action : undefined;
  if (kind === "idea" && action !== "park") return null;
  if (kind === "nightly" && action !== "nightly") return null;
  return kind;
}

const DB_NAME = "ascent-offline";
const STORE = "outbox";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export async function enqueue(item: OutboxItem): Promise<void> {
  await tx("readwrite", (s) => s.put(item));
  notify();
}

export async function outboxItems(): Promise<OutboxItem[]> {
  const items = await tx<OutboxItem[]>("readonly", (s) => s.getAll());
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function outboxCount(): Promise<number> {
  return tx<number>("readonly", (s) => s.count());
}

export async function removeItems(ids: string[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    for (const id of ids) t.objectStore(STORE).delete(id);
    t.oncomplete = () => {
      db.close();
      resolve();
    };
    t.onerror = () => reject(t.error);
  });
  notify();
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ascent:offline"));
}

export interface FlushSummary {
  applied: number;
  duplicates: number;
  conflicts: number;
  invalid: number;
}

let flushing = false;

/** Replays the outbox. Applied/duplicate/conflict items leave the queue; invalid ones stay flagged. */
export async function flushOutbox(): Promise<FlushSummary | null> {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) return null;
  const items = await outboxItems();
  const pending = items.filter((i) => !i.error);
  if (pending.length === 0) return null;
  flushing = true;
  try {
    const res = await apiFetch<{ results: { id: string; status: string; message?: string }[] } & FlushSummary>("/api/sync", { body: { items: pending.map(({ id, kind, body, createdAt }) => ({ id, kind, body, createdAt })) } });
    const done = res.results.filter((r) => r.status !== "invalid").map((r) => r.id);
    await removeItems(done);
    for (const r of res.results.filter((x) => x.status === "invalid")) {
      const item = pending.find((p) => p.id === r.id);
      if (item) await enqueue({ ...item, error: r.message ?? "Rejected by server" });
    }
    notify();
    if (res.applied > 0 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ascent:mutated", { detail: {} }));
    return { applied: res.applied, duplicates: res.duplicates, conflicts: res.conflicts, invalid: res.invalid };
  } catch {
    return null;
  } finally {
    flushing = false;
  }
}

/** Builds the outbox entry for a failed mutation (stable requestId so replays are idempotent). */
export function outboxEntry(kind: OutboxItem["kind"], body: unknown): OutboxItem {
  const b = { ...(body as Record<string, unknown>) };
  const id = typeof b.clientRequestId === "string" && b.clientRequestId ? b.clientRequestId : requestId();
  b.clientRequestId = id;
  return { id, kind, body: b, createdAt: new Date().toISOString() };
}