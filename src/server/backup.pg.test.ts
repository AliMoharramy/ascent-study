import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/testing";
import * as schema from "@/db/schema";
import * as backup from "./backup";
import * as offsite from "./offsite";

const now = "2026-11-18T10:00:00.000Z";
const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
// Deliberately recompute integrity hashes so structural/FK validation cannot hide behind a hash failure.
// Tampering helper: it deliberately edits an arbitrary archive shape.
/* eslint-disable @typescript-eslint/no-explicit-any */
function changed(bytes: Buffer, mutate: (a: any) => void): Buffer {
  const a = JSON.parse(gunzipSync(bytes).toString());
  mutate(a);
  for (const t of Object.values(a.tables) as any[]) {
    t.count = t.rows.length;
    t.sha256 = digest({ columns: t.columns, rows: t.rows });
  }
  const { sha256: _hash, ...body } = a;
  a.sha256 = digest(body);
  return gzipSync(JSON.stringify(a));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("portable PostgreSQL backups (disposable schemas only)", () => {
  let source: TestDb;
  let target: TestDb;
  let dir: string;
  const dbOf = (t: TestDb) => drizzle(t.pool, { schema });
  beforeEach(async () => {
    source = await createTestDb({ label: "archiveS" });
    target = await createTestDb({ label: "archiveT" });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ascent-pg-test-"));
    const db = dbOf(source);
    await db.insert(schema.users).values({ id: "u1", username: "owner", name: "Original", passwordHash: "hash", createdAt: now, updatedAt: now });
    await db.insert(schema.authSessions).values({ id: "session", userId: "u1", csrfToken: "secret", expiresAt: now, createdAt: now });
    await db.insert(schema.events).values({ id: "e1", userId: "u1", type: "focus.ended", payloadJson: '{"minutes":25}', occurredAt: now, createdAt: now });
    await db.insert(schema.focusSessions).values({ id: "f1", userId: "u1", kind: "tests", status: "ended", startedAt: now, gameDay: "2026-11-18", createdAt: now, updatedAt: now });
    await db.insert(schema.testLogs).values({ id: "t1", userId: "u1", sessionId: "f1", correct: 5, wrong: 1, blank: 0, netPct: 77.77777777777777, gameDay: "2026-11-18", loggedAt: now, createdAt: now, updatedAt: now });
    await db.insert(schema.configVersions).values({ id: "c1", userId: "u1", version: 1, json: '{"version":1}', reason: "fixture", createdAt: now });
    await db.insert(schema.xpLedger).values({ id: "x1", userId: "u1", eventId: "e1", amount: 2.75, reason: "focus", ruleKey: "focus", weekId: "2026-W47", gameDay: "2026-11-18", occurredAt: now });
    await db.insert(schema.kv).values({ userId: "u1", key: "capsule.key", json: '"sensitive"', updatedAt: now });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await Promise.all([source?.close(), target?.close()]);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("roundtrips every table, FK links, projections and sensitive keys; invalidates sessions", async () => {
    const bytes = await backup.createPortableArchive(dbOf(source));
    const a = backup.validateArchive(bytes);
    expect(Object.keys(a.tables).sort()).toEqual(Object.keys(schema.pgTables).sort());
    const report = await backup.verifyRestoreIntoEmptyDb(dbOf(target), bytes);
    expect(report).toMatchObject({ verified: true, reloginRequired: true });
    expect(report.counts.auth_sessions).toBe(0);
    expect(report.counts.test_logs).toBe(1);
    const db = dbOf(target);
    expect((await db.select().from(schema.testLogs))[0]).toMatchObject({ sessionId: "f1", correct: 5, netPct: 77.77777777777777 });
    expect((await db.select().from(schema.xpLedger))[0]).toMatchObject({ eventId: "e1", amount: 2.75 });
    expect((await db.select().from(schema.kv))[0]!.json).toBe('"sensitive"');
    expect(await db.select().from(schema.authSessions)).toEqual([]);
  });

  it.each(["corrupt", "unknown table", "unknown column", "foreign key", "type", "schema version", "checksum", "count"])("rejects %s without writes", async (kind) => {
    let bytes = await backup.createPortableArchive(dbOf(source));
    if (kind === "corrupt") bytes = Buffer.from("bad archive");
    else bytes = changed(bytes, (a) => {
      const t = a.tables.test_logs;
      if (kind === "unknown table") a.tables.evil = { columns: [], rows: [] };
      if (kind === "unknown column") t.columns[0] = "evil";
      if (kind === "foreign key") t.rows[0][t.columns.indexOf("session_id")] = "missing";
      if (kind === "type") t.rows[0][t.columns.indexOf("correct")] = "5";
      if (kind === "schema version") a.schema.version = "future";
      if (kind === "checksum") a.schema.migrations[0].checksum = "0".repeat(64);
    });
    if (kind === "count") {
      const a = JSON.parse(gunzipSync(bytes).toString()); a.tables.users.count = 100;
      bytes = gzipSync(JSON.stringify(a));
    }
    await expect(backup.importPortableArchive(dbOf(source), bytes, { replace: true })).rejects.toThrow();
    expect((await dbOf(source).select().from(schema.users))[0]!.name).toBe("Original");
    expect(await dbOf(source).select().from(schema.authSessions)).toHaveLength(1);
  });

  it("rolls back replacement if PostgreSQL rejects an insert after deletion", async () => {
    const bytes = await backup.createPortableArchive(dbOf(source));
    await target.query("CREATE FUNCTION fail_archive() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reject'; END $$");
    await target.query("CREATE TRIGGER fail_archive BEFORE INSERT ON config_versions FOR EACH ROW EXECUTE FUNCTION fail_archive()");
    await dbOf(target).insert(schema.users).values({ id: "old", username: "old", name: "Keep me", passwordHash: "old-hash", createdAt: now, updatedAt: now });
    await expect(backup.importPortableArchive(dbOf(target), bytes, { replace: true })).rejects.toThrow();
    expect((await dbOf(target).select().from(schema.users))[0]!.id).toBe("old");
    expect(await dbOf(target).select().from(schema.events)).toEqual([]);
  });

  it("refuses a nonempty target unless replacement is explicitly confirmed", async () => {
    const bytes = await backup.createPortableArchive(dbOf(source));
    await expect(backup.importPortableArchive(dbOf(source), bytes)).rejects.toThrow(/non.empty/i);
    await expect(backup.importPortableArchive(dbOf(source), bytes, { replace: true })).resolves.toMatchObject({ verified: true });
  });

  it("creates only verified local archives and refuses ephemeral stored backups", async () => {
    const info = await backup.createBackup(dbOf(source), dir);
    expect(await backup.verifyBackup(info.file)).toMatchObject({ tables: Object.keys(schema.pgTables).length });
    expect(await backup.listBackups(dir)).toHaveLength(1);
    expect(await backup.resolveBackup("../secret", dir)).toBeNull();
    vi.stubEnv("VERCEL", "1");
    await expect(backup.createBackup(dbOf(source), dir)).rejects.toThrow(/export/i);
    await expect(backup.nightlyBackup(dbOf(source), dir)).rejects.toThrow(/export/i);
    expect(await backup.listBackupsForApp()).toMatchObject({ supported: false, exportUrl: "/api/export/full" });
    await expect(backup.createPortableArchive(dbOf(source))).resolves.toBeInstanceOf(Buffer);
  });

  it("encrypts verified archives and rejects missing keys or tampering", async () => {
    vi.stubEnv("OFFSITE_KEY", "test-only-passphrase-not-a-real-secret");
    const info = await offsite.createOffsiteBackup(dbOf(source), { dir });
    const check = path.join(dir, "plain.json.gz");
    offsite.decryptFile(info.file, check);
    expect(await backup.verifyBackup(check)).toMatchObject({ tables: Object.keys(schema.pgTables).length });
    const damaged = fs.readFileSync(info.file); damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
    fs.writeFileSync(info.file, damaged);
    expect(() => offsite.decryptFile(info.file, path.join(dir, "bad"))).toThrow(/decrypt|damaged/i);
    expect(fs.existsSync(path.join(dir, "bad"))).toBe(false);
    vi.stubEnv("OFFSITE_KEY", "");
    await expect(offsite.createOffsiteBackup(dbOf(source), { dir })).rejects.toThrow(/OFFSITE_KEY/);
  });

  it("exports a read-only repeatable-read snapshot while another transaction commits", async () => {
    const real = dbOf(source);
    const original = real.transaction.bind(real);
    vi.spyOn(real, "transaction").mockImplementation((fn, options) => original(async (tx) => {
      const execute = tx.execute.bind(tx);
      let reads = 0;
      vi.spyOn(tx, "execute").mockImplementation((async (...args: Parameters<typeof tx.execute>) => {
        const result = await execute(...args);
        if (++reads === 5) {
          await source.query("BEGIN; UPDATE users SET name='New'; UPDATE config_versions SET reason='New'; COMMIT;");
        }
        return result;
      }) as never);
      expect((await execute(sql`SHOW transaction_isolation`)).rows[0]!.transaction_isolation).toBe("repeatable read");
      expect((await execute(sql`SHOW transaction_read_only`)).rows[0]!.transaction_read_only).toBe("on");
      return fn(tx);
    }, options));
    const a = backup.validateArchive(await backup.createPortableArchive(real));
    const u = a.tables.users!; const c = a.tables.config_versions!;
    expect(u.rows[0]![u.columns.indexOf("name")]).toBe("Original");
    expect(c.rows[0]![c.columns.indexOf("reason")]).toBe("fixture");
    expect((await source.query("SELECT name FROM users")).rows[0].name).toBe("New");
  });
});
