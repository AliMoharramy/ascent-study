import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { isLocalDatabase, parseDatabaseUrl, pgConnectionOptions, requireDirectConnection, safePgError } from "./pg-connection";
import { registerPgTypes } from "./pg-types";

// Session locks require a direct connection. Runtime imports never run migrations.
export const MIGRATION_LOCK_KEY = 721_001;

export interface PgMigration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
  transactional: boolean;
}

export class MigrationChecksumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationChecksumError";
  }
}

export function migrationsPgDir(): string {
  return process.env.MIGRATIONS_PG_DIR ?? path.join(process.cwd(), "src", "db", "migrations-pg");
}

/** Windows and Linux checkouts must agree. */
export function checksumOf(sql: string): string {
  return crypto.createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

export function loadPgMigrations(dir = migrationsPgDir()): PgMigration[] {
  if (!fs.existsSync(dir)) throw new Error("PostgreSQL migrations directory not found");
  return fs.readdirSync(dir).filter((file) => file.endsWith(".up.sql")).sort().map((file) => {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    return {
      version: file.replace(/\.up\.sql$/, ""), name: file, sql,
      checksum: checksumOf(sql), transactional: !/^\s*--\s*\+no-transaction/m.test(sql),
    };
  });
}

export function migrationUrl(): string {
  const direct = process.env.DIRECT_DATABASE_URL;
  if (direct) return requireDirectConnection(direct);
  const local = process.env.DATABASE_URL;
  if (local && isLocalDatabase(parseDatabaseUrl(local))) return requireDirectConnection(local);
  throw new Error("DIRECT_DATABASE_URL is required for PostgreSQL migrations (only local direct DATABASE_URL may be used as a fallback)");
}

const BOOTSTRAP = `CREATE TABLE IF NOT EXISTS _migrations (
  version text PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export interface MigrateOptions {
  migrations?: PgMigration[];
  lock?: boolean;
  lockTimeoutMs?: number;
}

/** Per-file atomic DDL/journal, checksum validation and a bounded session-lock wait. */
export async function migratePgUp(client: Client, opts: MigrateOptions = {}): Promise<MigrateResult> {
  if (/pooler|pgbouncer/i.test(client.host) || [6432, 6543].includes(client.port)) {
    throw new Error("PostgreSQL migrations require a direct connection, never a transaction pooler");
  }
  registerPgTypes();
  const migrations = opts.migrations ?? loadPgMigrations();
  for (const migration of migrations) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(migration.version)) throw new Error("Invalid PostgreSQL migration version");
    if (migration.checksum !== checksumOf(migration.sql)) throw new MigrationChecksumError(`Migration ${migration.version} checksum does not match its SQL`);
  }
  const lockTimeout = opts.lockTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(lockTimeout) || lockTimeout < 1) throw new Error("Migration lockTimeoutMs must be a positive integer");
  let previousTimeout: string | undefined;
  let locked = false;
  try {
    previousTimeout = (await client.query<{ lock_timeout: string }>("SHOW lock_timeout")).rows[0]!.lock_timeout;
    await client.query("SELECT set_config('lock_timeout', $1, false)", [`${lockTimeout}ms`]);
    if (opts.lock !== false) {
      await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      locked = true;
    }
    const exists = (await client.query<{ journal: string | null }>("SELECT to_regclass('_migrations') AS journal")).rows[0]!.journal;
    const rows = exists
      ? (await client.query<{ version: string; checksum: string }>("SELECT version, checksum FROM _migrations ORDER BY version")).rows
      : [];
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));
    for (const [version, checksum] of applied) {
      const file = migrations.find((migration) => migration.version === version);
      if (!file) throw new MigrationChecksumError("An applied migration file is missing; restore it before proceeding");
      if (file.checksum !== checksum) throw new MigrationChecksumError(`Migration ${file.version} changed after it was applied (checksum drift)`);
    }
    const appliedNow: string[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      if (migration.transactional) await client.query("BEGIN");
      try {
        // The first failed transactional migration must not leave even an empty journal behind.
        await client.query(BOOTSTRAP);
        await client.query(migration.sql);
        await client.query("INSERT INTO _migrations (version, name, checksum) VALUES ($1, $2, $3)",
          [migration.version, migration.name, migration.checksum]);
        if (migration.transactional) await client.query("COMMIT");
      } catch (error) {
        if (migration.transactional) await client.query("ROLLBACK").catch(() => undefined);
        const outcome = migration.transactional ? "failed and was rolled back" : "(non-transactional) failed; partial changes may remain";
        throw safePgError(error, `Migration ${migration.version} ${outcome}`);
      }
      appliedNow.push(migration.version);
    }
    return { applied: appliedNow, skipped: [...applied.keys()] };
  } catch (error) {
    if (error instanceof MigrationChecksumError) throw error;
    throw safePgError(error, "PostgreSQL migration failed");
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
    if (previousTimeout !== undefined) {
      await client.query("SELECT set_config('lock_timeout', $1, false)", [previousTimeout]).catch(() => undefined);
    }
  }
}

/** Opens and closes a dedicated direct connection, including on connection failure. */
export async function runPgMigrations(url = migrationUrl(), opts: Omit<MigrateOptions, "lock"> = {}): Promise<MigrateResult> {
  requireDirectConnection(url);
  const client = new Client(pgConnectionOptions(url));
  try {
    await client.connect();
    return await migratePgUp(client, opts);
  } catch (error) {
    if (error instanceof MigrationChecksumError) throw error;
    throw safePgError(error, "PostgreSQL migration connection failed");
  } finally {
    await client.end().catch(() => undefined);
  }
}
