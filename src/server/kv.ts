import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { kv } from "@/db/schema";
import { nowIso } from "@/lib/ids";

/** Small per-user JSON settings store (daily goal, time windows, onboarding, env checklist, scorecard…). */
export async function getKv<T>(db: Db, userId: string, key: string, fallback: T): Promise<T> {
  const r = (await db.select({ json: kv.json }).from(kv).where(and(eq(kv.userId, userId), eq(kv.key, key))).limit(1))[0];
  if (!r) return fallback;
  try {
    return JSON.parse(r.json) as T;
  } catch {
    return fallback;
  }
}

export async function setKv(db: Db, userId: string, key: string, value: unknown): Promise<void> {
  await db.insert(kv)
    .values({ userId, key, json: JSON.stringify(value), updatedAt: nowIso() })
    .onConflictDoUpdate({ target: [kv.userId, kv.key], set: { json: JSON.stringify(value), updatedAt: nowIso() } });
}
