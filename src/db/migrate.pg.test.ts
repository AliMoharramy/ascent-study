import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  checksumOf, loadPgMigrations, migratePgUp, migrationUrl, MIGRATION_LOCK_KEY,
  MigrationChecksumError, runPgMigrations, type PgMigration,
} from "./migrate-pg";
import { connectToSchema, createTestDb, requireTestDatabaseUrl, type TestDb } from "./testing";

const migration = (sql: string): PgMigration => ({
  version: "9999_test", name: "9999_test.up.sql", sql, checksum: checksumOf(sql), transactional: true,
});
const opened: TestDb[] = [];
afterAll(async () => { for (const db of opened) await db.close(); });
afterEach(() => vi.unstubAllEnvs());
async function fresh(migrations?: PgMigration[]) {
  const db = await createTestDb({ migrations, label: "migrate" });
  opened.push(db);
  return db;
}

describe("migration safety", () => {
  it("rolls back failed DDL and the initial journal together", async () => {
    const db = await fresh([]);
    const client = await connectToSchema(db.schema);
    try {
      await expect(migratePgUp(client, { migrations: [migration("CREATE TABLE partial (id int); SELECT 1/0;")] }))
        .rejects.toThrow(/rolled back/);
      const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = $1", [db.schema]);
      expect(rows).toEqual([]);
    } finally { await client.end(); }
  });

  it("preserves previous migrations but rolls back a failed pending file", async () => {
    const db = await fresh();
    const client = await connectToSchema(db.schema);
    try {
      await expect(migratePgUp(client, { migrations: [...loadPgMigrations(), migration("CREATE TABLE partial (id int); SELECT 1/0;")] }))
        .rejects.toThrow(/rolled back/);
      expect((await client.query("SELECT to_regclass('partial') AS table")).rows[0].table).toBeNull();
      expect((await client.query("SELECT version FROM _migrations")).rows).toEqual([{ version: "0001_baseline" }]);
    } finally { await client.end(); }
  });

  it("rejects missing applied files", async () => {
    const db = await fresh();
    const client = await connectToSchema(db.schema);
    try {
      await expect(migratePgUp(client, { migrations: [] })).rejects.toBeInstanceOf(MigrationChecksumError);
    } finally { await client.end(); }
  });

  it("does not expose server exception text, SQL or connection secrets", async () => {
    const db = await fresh([]);
    const client = await connectToSchema(db.schema);
    try {
      const secret = "postgresql://private:secret-password@secret-host/private";
      const error = await migratePgUp(client, { migrations: [migration(`DO $$ BEGIN RAISE EXCEPTION '${secret}'; END $$;`)] })
        .catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toMatch(/9999_test.*rolled back/);
      expect(String(error)).not.toContain("secret");
      expect((error as Error).cause).toBeUndefined();
    } finally { await client.end(); }
  });

  it("bounds session-lock waits on a direct connection and restores its timeout", async () => {
    const db = await fresh();
    const [holder, waiter] = await Promise.all([connectToSchema(db.schema), connectToSchema(db.schema)]);
    try {
      await holder.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      await waiter.query("SET lock_timeout = '750ms'");
      const start = Date.now();
      await expect(migratePgUp(waiter, { lockTimeoutMs: 100 })).rejects.toThrow(/55P03/);
      expect(Date.now() - start).toBeLessThan(2000);
      expect((await waiter.query("SHOW lock_timeout")).rows[0].lock_timeout).toBe("750ms");
      await holder.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      await expect(migratePgUp(waiter)).resolves.toMatchObject({ applied: [] });
    } finally { await holder.end(); await waiter.end(); }
  });

  it("requires an explicit direct URL for remote migrations", () => {
    vi.stubEnv("DIRECT_DATABASE_URL", undefined);
    vi.stubEnv("DATABASE_URL", "postgresql://private:secret@ep-demo-pooler.neon.tech/db");
    expect(() => migrationUrl()).toThrow(/DIRECT_DATABASE_URL/);
    const localUrl = requireTestDatabaseUrl();
    vi.stubEnv("DATABASE_URL", localUrl);
    expect(migrationUrl()).toBe(localUrl);
  });

  it("rejects known transaction-pooler URLs even when explicitly marked direct", async () => {
    vi.stubEnv("DIRECT_DATABASE_URL", "postgresql://private:secret@ep-demo-pooler.neon.tech/db");
    expect(() => migrationUrl()).toThrow(/direct|pooler/i);
    await expect(runPgMigrations("postgresql://private:secret@localhost:6432/db")).rejects.toThrow(/direct|pooler/i);
  });

  it("sanitizes connection validation failures", async () => {
    const error = await runPgMigrations("not-a-url-secret-password").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("secret-password");
    expect((error as Error).cause).toBeUndefined();
  });
});
