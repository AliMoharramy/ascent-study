import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import * as testing from "./testing";
import { checksumOf } from "./migrate-pg";

const localUrl = testing.requireTestDatabaseUrl();
afterEach(() => vi.unstubAllEnvs());

describe("isolated PostgreSQL test harness", () => {
  it("requires TEST_DATABASE_URL rather than falling back to production", () => {
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    vi.stubEnv("DATABASE_URL", localUrl);
    expect(() => testing.requireTestDatabaseUrl()).toThrow(/TEST_DATABASE_URL/);
  });

  it("rejects the production URL even with reordered query parameters", () => {
    vi.stubEnv("DATABASE_URL", `${localUrl}?application_name=test&sslmode=disable`);
    vi.stubEnv("TEST_DATABASE_URL", `${localUrl}?sslmode=disable&application_name=test`);
    expect(() => testing.requireTestDatabaseUrl()).toThrow(/DATABASE_URL/);
  });

  it("removes its isolated schema when a migration fails", async () => {
    const admin = new Client({ connectionString: localUrl });
    await admin.connect();
    const schemas = async () => (await admin.query<{ nspname: string }>(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 't_failtest_%'",
    )).rows.map((row) => row.nspname);
    const before = await schemas();
    try {
      const sql = "CREATE TABLE partial (id int); SELECT 1/0;";
      await expect(testing.createTestDb({ label: "failtest", migrations: [{
        version: "bad", name: "bad.up.sql", sql, checksum: checksumOf(sql), transactional: true,
      }] })).rejects.toThrow();
      expect(await schemas()).toEqual(before);
    } finally {
      // Clean up schemas created by this test even when the old helper leaks them.
      for (const name of await schemas()) {
        if (!before.includes(name)) await admin.query(`DROP SCHEMA "${name}" CASCADE`);
      }
      await admin.end();
    }
  });

  it("exposes a real Db backed by the isolated-schema pool", async () => {
    const a = await testing.createTestDb({ label: "isolated" });
    const b = await testing.createTestDb({ label: "isolated" });
    try {
      expect(a.db).toBeDefined();
      expect(b.schema).not.toBe(a.schema);
      expect((await a.db.execute(sql`SELECT current_schema() AS schema`)).rows).toEqual([{ schema: a.schema }]);
      expect((await b.db.execute(sql`SELECT current_schema() AS schema`)).rows).toEqual([{ schema: b.schema }]);
    } finally { await a.close(); await b.close(); }
  });

  it("closes registered memoryDb schemas after a runtime assertion failure", async () => {
    expect(typeof testing.memoryDb).toBe("function");
    expect(typeof testing.closeTestDb).toBe("function");
    const admin = new Client({ connectionString: localUrl });
    await admin.connect();
    let schema: unknown;
    const db = await testing.memoryDb();
    try {
      const failure = new Error("runtime assertion failed");
      await expect((async () => {
        try {
          schema = (await db.execute(sql`SELECT current_schema() AS schema`)).rows[0]!.schema;
          throw failure;
        } finally { await testing.closeTestDb(db); }
      })()).rejects.toBe(failure);
      expect((await admin.query("SELECT nspname FROM pg_namespace WHERE nspname = $1", [schema])).rows).toEqual([]);
      await expect(testing.closeTestDb(db)).resolves.toBeUndefined();
    } finally { await testing.closeTestDb(db); await admin.end(); }
  });
});
