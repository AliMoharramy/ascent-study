import { Client, Pool } from "pg";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Db } from "./client";
import * as schema from "./schema";
import { migratePgUp, type PgMigration } from "./migrate-pg";
import { isLocalDatabase, parseDatabaseUrl, pgConnectionOptions, requireDirectConnection, safePgError } from "./pg-connection";
import { registerPgTypes } from "./pg-types";

function databaseIdentity(value: string): string {
  const url = parseDatabaseUrl(value);
  const host = isLocalDatabase(url) ? "localhost" : url.hostname.toLowerCase().replace(/-pooler\./, ".");
  return `${host}:${url.port || "5432"}/${decodeURIComponent(url.pathname.slice(1))}`;
}

export function testDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  if (process.env.DATABASE_URL && databaseIdentity(url) === databaseIdentity(process.env.DATABASE_URL)) {
    throw new Error("TEST_DATABASE_URL must not target the same database as DATABASE_URL");
  }
  return requireDirectConnection(url);
}

export function requireTestDatabaseUrl(): string {
  const url = testDatabaseUrl();
  if (!url) throw new Error("TEST_DATABASE_URL is required; use disposable PostgreSQL, never production");
  return url;
}

export interface TestDb {
  schema: string;
  db: Db;
  pool: Pool;
  query: Pool["query"];
  close: () => Promise<void>;
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const registered = new WeakMap<Db, () => Promise<void>>();

async function dropSchema(url: string, name: string): Promise<void> {
  const client = new Client(pgConnectionOptions(url));
  try {
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdent(name)} CASCADE`);
  } catch (error) {
    throw safePgError(error, "PostgreSQL test schema cleanup failed");
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Each handle owns a random schema, its migration connection and its isolated pool. */
export async function createTestDb(opts: { migrations?: PgMigration[]; label?: string } = {}): Promise<TestDb> {
  const url = requireTestDatabaseUrl();
  registerPgTypes();
  const name = `t_${(opts.label ?? "pg").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}_${randomBytes(8).toString("hex")}`;
  const setup = new Client(pgConnectionOptions(url));
  let created = false;
  let pool: Pool | undefined;
  try {
    await setup.connect();
    await setup.query(`CREATE SCHEMA ${quoteIdent(name)}`);
    created = true;
    await setup.query(`SET search_path TO ${quoteIdent(name)}`);
    await migratePgUp(setup, { migrations: opts.migrations });
    pool = new Pool({ ...pgConnectionOptions(url), max: 4, idleTimeoutMillis: 5_000, options: `-c search_path=${name}` });
    pool.on("error", (error) => console.error(safePgError(error, "PostgreSQL test pool error").message));
    const probe = await pool.connect();
    probe.release();
    const ownedPool = pool;
    const db: Db = drizzle(ownedPool, { schema });
    let closing: Promise<void> | undefined;
    const close = () => (closing ??= (async () => {
      try {
        if (!ownedPool.ended) await ownedPool.end();
      } finally {
        await dropSchema(url, name);
      }
      registered.delete(db);
    })());
    registered.set(db, close);
    return { schema: name, db, pool: ownedPool, query: ownedPool.query.bind(ownedPool), close };
  } catch (error) {
    try {
      if (pool) await pool.end();
    } finally {
      if (created) await dropSchema(url, name);
    }
    throw safePgError(error, "PostgreSQL test database setup failed");
  } finally {
    await setup.end().catch(() => undefined);
  }
}

/** Compatibility name only: this is real isolated PostgreSQL, never an in-memory substitute. */
export async function memoryDb(): Promise<Db> {
  return (await createTestDb()).db;
}

/** Call from afterEach/afterAll or finally so failed assertions also clean up. */
export async function closeTestDb(db: Db): Promise<void> {
  await registered.get(db)?.();
}

export async function connectToSchema(name: string): Promise<Client> {
  if (!/^t_[a-z0-9_]+$/.test(name)) throw new Error("Invalid PostgreSQL test schema name");
  const client = new Client({ ...pgConnectionOptions(requireTestDatabaseUrl()), options: `-c search_path=${name}` });
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.end().catch(() => undefined);
    throw safePgError(error, "PostgreSQL test connection failed");
  }
}
