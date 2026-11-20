import { attachDatabasePool } from "@vercel/functions";
import { sql, type SQL } from "drizzle-orm";
import { drizzle, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";
import { pgConnectionOptions, safePgError } from "./pg-connection";
import { registerPgTypes } from "./pg-types";

export type Db = PgDatabase<NodePgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as typeof globalThis & {
  __ascentPg?: { db?: Db; injected?: Db; pools: Set<Pool> };
};
const state = (globalForDb.__ascentPg ??= { pools: new Set<Pool>() });

/** Per-instance connection cap: many Function instances share one provider limit, so keep it small. */
function poolMax(): number {
  const n = Number(process.env.DB_POOL_MAX);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 4;
}

/** Creates a lazy pool; schema changes and seeding are explicit, separate operations. */
export function createDb(connectionString: string): Db {
  registerPgTypes();
  const pool = new Pool({
    ...pgConnectionOptions(connectionString),
    max: poolMax(),
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (error) => console.error(safePgError(error, "PostgreSQL pool error").message));
  if (process.env.VERCEL === "1") attachDatabasePool(pool);
  state.pools.add(pool);
  return drizzle(pool, { schema });
}

export function getDb(): Db {
  if (state.injected) return state.injected;
  if (!state.db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required for PostgreSQL");
    state.db = createDb(url);
  }
  return state.db;
}

/** Ends runtime-owned pools only; injected test databases retain their own lifecycle. */
export async function closeDb(): Promise<void> {
  state.db = undefined;
  const pools = [...state.pools];
  state.pools.clear();
  await Promise.all(pools.map((pool) => pool.end().catch((error: unknown) => { throw safePgError(error, "PostgreSQL shutdown failed"); })));
}

export function setDbForTests(db: Db | undefined): void {
  state.injected = db;
}

export async function queryRows<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  try {
    return (await db.execute<T>(query)).rows as T[];
  } catch (error) {
    throw safePgError(error);
  }
}

export async function queryOne<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T | undefined> {
  return (await queryRows<T>(db, query))[0];
}

/** Users whose advisory lock the surrounding transaction (or savepoint chain) already holds. */
const heldLocks = new WeakMap<object, ReadonlySet<string>>();

/**
 * Runs `fn` in a transaction that holds the user's advisory lock, so two requests for the same user can never
 * interleave a read-modify-write. Transaction-scoped locks work with transaction poolers; no ambient session state.
 *
 * Domain operations call each other, so this is re-entrant: inside a transaction that already holds the lock it only
 * opens a savepoint (keeping partial rollback) and skips the four lock/timeout statements.
 */
export async function withUserTransaction<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const inherited = heldLocks.get(db);
  return db.transaction(async (tx) => {
    if (inherited?.has(userId)) {
      heldLocks.set(tx, inherited);
      return fn(tx);
    }
    // One round trip instead of three (set_config(..., true) is SET LOCAL). A request that has to wait for the user's
    // lock should wait (a page render can legitimately hold it for a few seconds), not fail: lock_timeout < statement_timeout.
    await tx.execute(sql`SELECT set_config('statement_timeout', '30s', true), set_config('lock_timeout', '25s', true), set_config('synchronous_commit', 'on', true)`);
    // Stable namespace separates application user locks from other advisory-lock users.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 721002))`);
    heldLocks.set(tx, new Set([...(inherited ?? []), userId]));
    return fn(tx);
  });
}
