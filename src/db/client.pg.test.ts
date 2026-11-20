import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as runtime from "./client";
import * as schema from "./schema";
import { connectToSchema, createTestDb, requireTestDatabaseUrl, type TestDb } from "./testing";

let testDb: TestDb;
beforeAll(async () => { testDb = await createTestDb({ label: "runtime" }); });
afterAll(async () => { await testDb?.close(); });
beforeEach(() => {
  // Prevent the old SQLite implementation from ever interpreting a PG URL as a file path.
  expect(typeof runtime.queryRows).toBe("function");
});
afterEach(async () => {
  runtime.setDbForTests(undefined);
  if (runtime.closeDb) await runtime.closeDb();
  vi.unstubAllEnvs();
});

describe("PostgreSQL runtime contract", () => {
  it("accepts both a root database and its transaction without a SQLite adapter", async () => {
    expectTypeOf<runtime.Tx>().toExtend<runtime.Db>();
    expectTypeOf(drizzle(testDb.pool, { schema })).toExtend<runtime.Db>();
    expect(testDb.db).toBeDefined();
    runtime.setDbForTests(testDb.db);
    expect(runtime.getDb()).toBe(testDb.db);
    expect(await runtime.queryRows(testDb.db, sql`SELECT ${7}::int AS n`)).toEqual([{ n: 7 }]);
    expect(await runtime.queryOne(testDb.db, sql`SELECT 1 WHERE false`)).toBeUndefined();
    await testDb.db.transaction(async (tx) => {
      const db: runtime.Db = tx;
      expect(await runtime.queryOne(db, sql`SELECT ${8}::int AS n`)).toEqual({ n: 8 });
    });
  });

  it("creates a lazy singleton with no connect, migration, schema query or seed", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@127.0.0.1:1/unused");
    const connect = vi.spyOn(Pool.prototype, "connect");
    const query = vi.spyOn(Pool.prototype, "query");
    try {
      const first = runtime.getDb();
      expect(runtime.getDb()).toBe(first);
      expect(connect).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
      const pool = (first as runtime.Db & { $client: Pool }).$client;
      expect(pool.options).toMatchObject({ max: 4, idleTimeoutMillis: 5000, connectionTimeoutMillis: 10000 });
      await runtime.closeDb();
      expect(pool.ended).toBe(true);
      expect(runtime.getDb()).not.toBe(first);
    } finally { connect.mockRestore(); query.mockRestore(); }
  });

  it("fails clearly without DATABASE_URL and does not echo malformed input", () => {
    vi.stubEnv("DATABASE_URL", undefined);
    expect(() => runtime.getDb()).toThrow(/DATABASE_URL.*required/);
    expect(() => runtime.createDb("secret-invalid-url")).toThrow(/PostgreSQL.*URL/);
    try { runtime.createDb("secret-invalid-url"); } catch (error) {
      expect(String(error)).not.toContain("secret-invalid-url");
    }
  });

  it("enforces remote TLS verification despite URL sslmode options", async () => {
    const db = runtime.createDb("postgresql://unused:unused@example.invalid/db?sslmode=require");
    const pool = (db as runtime.Db & { $client: Pool }).$client;
    expect(pool.options.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(new URL(pool.options.connectionString!).searchParams.has("sslmode")).toBe(false);
    await runtime.closeDb();
    expect(pool.ended).toBe(true);
    expect(() => runtime.createDb("postgresql://unused:unused@example.invalid/db?sslmode=no-verify"))
      .toThrow(/TLS/);
  });

  it("only skips TLS on private-network hosts (compose service names, RFC1918, loopback)", () => {
    const tls = (url: string) => (runtime.createDb(url) as runtime.Db & { $client: Pool }).$client.options.ssl;
    expect(tls("postgresql://u:p@postgres/db")).toBe(false);
    expect(tls("postgresql://u:p@ascent-pg:5432/db")).toBe(false);
    expect(tls("postgresql://u:p@10.1.2.3/db")).toBe(false);
    expect(tls("postgresql://u:p@172.20.0.5/db")).toBe(false);
    expect(tls("postgresql://u:p@192.168.1.9/db")).toBe(false);
    // public names always require verified TLS, even look-alikes
    expect(tls("postgresql://u:p@db.example.com/db")).toMatchObject({ rejectUnauthorized: true });
    expect(tls("postgresql://u:p@172.32.0.1/db")).toMatchObject({ rejectUnauthorized: true });
    expect(tls("postgresql://u:p@8.8.8.8/db")).toMatchObject({ rejectUnauthorized: true });
    expect(() => runtime.createDb("postgresql://u:p@db.example.com/db?sslmode=disable")).toThrow(/TLS/);
  });

  it("sanitizes idle pool error events without printing the URL", async () => {
    const url = "postgresql://unused:secret-password@127.0.0.1:1/unused";
    const db = runtime.createDb(url);
    const pool = (db as runtime.Db & { $client: Pool }).$client;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      pool.emit("error", new Error(`connection failed ${url}`));
      expect(log.mock.calls.flat().join(" ")).not.toContain("secret-password");
      expect(log.mock.calls.flat().join(" ")).toMatch(/PostgreSQL/);
    } finally { log.mockRestore(); }
  });

  it("commits on the same transaction and rolls all writes back on callback failure", async () => {
    await testDb.query("CREATE TABLE tx_probe (id text PRIMARY KEY)");
    const baseline = await runtime.queryOne(testDb.db, sql`SELECT current_setting('statement_timeout') AS s,
      current_setting('lock_timeout') AS l, current_setting('synchronous_commit') AS c`);
    const result = await runtime.withUserTransaction(testDb.db, "user-tx", async (tx) => {
      const pid = await runtime.queryOne(tx, sql`SELECT pg_backend_pid() AS pid`);
      await runtime.queryRows(tx, sql`INSERT INTO tx_probe VALUES ('committed')`);
      expect(await runtime.queryOne(tx, sql`SELECT pg_backend_pid() AS pid`)).toEqual(pid);
      expect(await runtime.queryOne(tx, sql`SELECT current_setting('statement_timeout') AS s,
        current_setting('lock_timeout') AS l, current_setting('synchronous_commit') AS c`))
        .toEqual({ s: "30s", l: "25s", c: "on" });
      return "value";
    });
    expect(result).toBe("value");
    const failure = new Error("callback failed");
    await expect(runtime.withUserTransaction(testDb.db, "user-tx", async (tx) => {
      await runtime.queryRows(tx, sql`INSERT INTO tx_probe VALUES ('rolled-back')`);
      await runtime.withUserTransaction(tx, "user-tx", async (nested) => {
        await runtime.queryRows(nested, sql`INSERT INTO tx_probe VALUES ('nested')`);
      });
      throw failure;
    })).rejects.toBe(failure);
    expect(await runtime.queryRows(testDb.db, sql`SELECT id FROM tx_probe`)).toEqual([{ id: "committed" }]);
    expect(await runtime.queryOne(testDb.db, sql`SELECT current_setting('statement_timeout') AS s,
      current_setting('lock_timeout') AS l, current_setting('synchronous_commit') AS c`)).toEqual(baseline);
  });

  it("serializes one user across independent clients but lets another user proceed", async () => {
    const [a, b] = await Promise.all([connectToSchema(testDb.schema), connectToSchema(testDb.schema)]);
    const firstDb: runtime.Db = drizzle(a, { schema });
    const secondDb: runtime.Db = drizzle(b, { schema });
    const pid = (await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let secondEntered = false;
    const first = runtime.withUserTransaction(firstDb, "shared-user", async () => {
      entered.resolve();
      await release.promise;
    });
    let second: Promise<void> | undefined;
    try {
      await entered.promise;
      second = runtime.withUserTransaction(secondDb, "shared-user", async () => { secondEntered = true; });
      // Observe the real lock wait, rather than assuming scheduling based on a sleep.
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const result = await testDb.query("SELECT wait_event FROM pg_stat_activity WHERE pid = $1", [pid]);
        if (result.rows[0]?.wait_event === "advisory") { waiting = true; break; }
      }
      expect(waiting).toBe(true);
      expect(secondEntered).toBe(false);
      await expect(runtime.withUserTransaction(testDb.db, "different-user", async () => "independent"))
        .resolves.toBe("independent");
    } finally {
      release.resolve();
      await first;
      await second;
      await a.end(); await b.end();
    }
    expect(secondEntered).toBe(true);
    expect(requireTestDatabaseUrl()).toBeTruthy();
  });
});
