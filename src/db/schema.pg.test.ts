import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { checksumOf, loadPgMigrations, migratePgUp, MigrationChecksumError, type PgMigration } from "./migrate-pg";
import { connectToSchema, createTestDb, testDatabaseUrl, type TestDb } from "./testing";
import { pgTables } from "./schema";

/**
 * Stage 1 gate: the PostgreSQL baseline, its runner, and the Drizzle mirror.
 *
 * Runs only against a disposable database (`TEST_DATABASE_URL`); it fails loudly when that is missing
 * rather than silently passing, because a skipped gate is not a gate.
 */
describe("postgres baseline (Database V2, S1)", () => {
  const opened: TestDb[] = [];

  beforeAll(() => {
    if (!testDatabaseUrl()) {
      throw new Error("TEST_DATABASE_URL is required for `npm run test:pg` (disposable PostgreSQL only).");
    }
  });

  afterAll(async () => {
    for (const db of opened) await db.close();
  });

  async function fresh(opts: { migrations?: PgMigration[]; label?: string } = {}) {
    const db = await createTestDb(opts);
    opened.push(db);
    return db;
  }

  it("migrates an empty database and creates every table", async () => {
    const db = await fresh({ label: "empty" });
    const { rows } = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
      [db.schema],
    );
    const names = rows.map((r) => r.table_name);
    expect(names).toContain("_migrations");
    expect(names).toContain("study_logs");
    expect(names).toContain("study_log_reviews");
    for (const table of Object.keys(pgTables)) expect(names, table).toContain(table);
    // 72 application tables + the migration journal
    expect(names.length).toBe(Object.keys(pgTables).length + 1);
    expect(Object.keys(pgTables)).toHaveLength(72);
  });

  it("records the applied version with its checksum", async () => {
    const db = await fresh({ label: "journal" });
    const { rows } = await db.query<{ version: string; name: string; checksum: string }>(
      "SELECT version, name, checksum FROM _migrations ORDER BY version",
    );
    const migrations = loadPgMigrations();
    expect(rows).toEqual(migrations.map(({ version, name, checksum }) => ({ version, name, checksum })));
  });

  it("is idempotent", async () => {
    const db = await fresh({ label: "idem" });
    const client = await connectToSchema(db.schema);
    try {
      const result = await migratePgUp(client);
      expect(result.applied).toEqual([]);
      expect(result.skipped).toEqual(loadPgMigrations().map((migration) => migration.version));
    } finally {
      await client.end();
    }
  });

  it("applies each pending migration exactly once when two runners race", async () => {
    const db = await fresh({ label: "race" });
    const synthetic: PgMigration[] = [1, 2, 3].map((i) => {
      const sql = `SELECT pg_sleep(0.15);\nCREATE TABLE race_${i} (id integer PRIMARY KEY);`;
      return { version: `90${i}_race`, name: `90${i}_race.up.sql`, sql, checksum: checksumOf(sql), transactional: true };
    });
    const migrations = [...loadPgMigrations(), ...synthetic];

    const [a, b] = await Promise.all([connectToSchema(db.schema), connectToSchema(db.schema)]);
    try {
      const results = await Promise.all([migratePgUp(a, { migrations }), migratePgUp(b, { migrations })]);
      const applied = results.flatMap((r) => r.applied);
      expect(applied.sort()).toEqual(["901_race", "902_race", "903_race"]);
    } finally {
      await a.end();
      await b.end();
    }

    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM _migrations WHERE version LIKE '90%'");
    expect(rows[0]!.n).toBe(3);
  });

  it("refuses to run when an applied migration changed (checksum drift)", async () => {
    const db = await fresh({ label: "drift" });
    const client = await connectToSchema(db.schema);
    try {
      const tampered = loadPgMigrations().map((m) => {
        const sql = `${m.sql}\n-- edited after apply\n`;
        return { ...m, sql, checksum: checksumOf(sql) };
      });
      await expect(migratePgUp(client, { migrations: tampered })).rejects.toBeInstanceOf(MigrationChecksumError);
    } finally {
      await client.end();
    }
  });

  it("keeps the Drizzle schema in exact agreement with the database", async () => {
    const db = await fresh({ label: "parity" });
    const { rows: dbCols } = await db.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      "SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1",
      [db.schema],
    );
    const byTable = new Map<string, Map<string, { type: string; nullable: boolean }>>();
    for (const c of dbCols) {
      if (!byTable.has(c.table_name)) byTable.set(c.table_name, new Map());
      byTable.get(c.table_name)!.set(c.column_name, { type: c.data_type, nullable: c.is_nullable === "YES" });
    }

    type DrizzleCol = { name: string; notNull: boolean; getSQLType?: () => string; dataType: string };
    for (const [tableName, table] of Object.entries(pgTables)) {
      const expected = getTableConfig(table).columns as unknown as DrizzleCol[];
      const actual = byTable.get(tableName);
      expect(actual, `table ${tableName} exists`).toBeTruthy();
      expect([...actual!.keys()].sort(), `columns of ${tableName}`).toEqual(expected.map((c) => c.name).sort());
      for (const col of expected) {
        const found = actual!.get(col.name)!;
        const sqlType = typeof col.getSQLType === "function" ? col.getSQLType() : col.dataType;
        expect(found.type, `${tableName}.${col.name} type`).toBe(sqlType);
        expect(found.nullable, `${tableName}.${col.name} nullability`).toBe(!col.notNull);
      }
    }
  });

  it("matches primary keys declared in Drizzle", async () => {
    const db = await fresh({ label: "pk" });
    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        WHERE tc.table_schema = $1 AND tc.constraint_type = 'PRIMARY KEY'`,
      [db.schema],
    );
    const byTable = new Map<string, string[]>();
    for (const r of rows) byTable.set(r.table_name, [...(byTable.get(r.table_name) ?? []), r.column_name]);

    for (const [tableName, table] of Object.entries(pgTables)) {
      // Only tables that declare a PK inside Drizzle; single-column PKs are declared on the column.
      const cols = getTableConfig(table).columns as unknown as { name: string; primary?: boolean }[];
      const single = cols.filter((c) => c.primary).map((c) => c.name);
      const actual = byTable.get(tableName);
      if (!actual) continue;
      if (single.length === 1) expect(actual, `${tableName} primary key`).toEqual([single[0]]);
    }
  });

  it("round-trips the value contract the app relies on", async () => {
    const db = await fresh({ label: "values" });
    const now = new Date("2026-11-18T17:25:50.896Z").toISOString();
    await db.query("INSERT INTO users (id, username, name, password_hash, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)", [
      "u1",
      "test",
      "Test",
      "hash",
      now,
      now,
    ]);
    await db.query(
      `INSERT INTO events (id, user_id, type, payload_json, occurred_at, created_at, game_day, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      ["e1", "u1", "test.logged", '{"correct":3}', now, now, "2026-11-18", "app"],
    );
    const { rows } = await db.query<{
      created_at: string;
      game_day: string;
      payload_json: string;
      rollover_hour: number;
    }>(
      "SELECT events.created_at, events.game_day, events.payload_json, users.rollover_hour FROM events JOIN users ON events.user_id = users.id",
    );
    const row = rows[0]!;
    // timestamptz → ISO-8601 UTC string (lexicographic comparisons in auth/sync keep working)
    expect(row.created_at).toBe(now);
    // date → YYYY-MM-DD
    expect(row.game_day).toBe("2026-11-18");
    // JSON payloads stay byte-identical text in V2
    expect(row.payload_json).toBe('{"correct":3}');
    expect(row.rollover_hour).toBe(4);
  });

  it("round-trips canonical timestamps through real Drizzle select and returning", async () => {
    const testDb = await fresh({ label: "orm" });
    const db = drizzle(testDb.pool, { schema });
    const timestamp = "2026-11-18T20:55:50.896+03:30";
    const iso = "2026-11-18T17:25:50.896Z";
    const [user] = await db.insert(schema.users).values({
      id: "u1", username: "test", name: "Test", passwordHash: "hash",
      createdAt: timestamp, updatedAt: timestamp,
    }).returning();
    expect(user!.createdAt).toBe(iso);
    expect(user!.lockedUntil).toBeNull();
    const payload = '{ "correct": 3, "nested": [1,2] }';
    await db.insert(schema.events).values({
      id: "e1", userId: "u1", type: "test.logged", payloadJson: payload,
      occurredAt: timestamp, createdAt: timestamp, gameDay: "2026-11-18",
    });
    await db.insert(schema.xpLedger).values({
      id: "x1", userId: "u1", amount: 1.23456789012345, reason: "test", ruleKey: "test",
      weekId: "2026-11-14", gameDay: "2026-11-18", occurredAt: timestamp,
    });
    const [event] = await db.select().from(schema.events);
    const [xp] = await db.select().from(schema.xpLedger);
    expect(event!.createdAt).toBe(iso);
    expect(event!.occurredAt).toBe(iso);
    expect(event!.gameDay).toBe("2026-11-18");
    expect(event!.payloadJson).toBe(payload);
    expect(xp!.amount).toBe(1.23456789012345);
    expect(xp!.capApplied).toBe(false);
  });

  it("enforces the singleton, idempotency and check constraints", async () => {
    const db = await fresh({ label: "constraints" });
    const now = new Date().toISOString();
    const insertUser = (id: string, username: string) =>
      db.query("INSERT INTO users (id, username, name, password_hash, created_at, updated_at) VALUES ($1,$2,$3,'h',$4,$4)", [
        id,
        username,
        username,
        now,
      ]);

    await insertUser("u1", "test");
    await expect(insertUser("u2", "second")).rejects.toMatchObject({ code: "23505" });

    await db.query(
      `INSERT INTO events (id, user_id, type, payload_json, occurred_at, created_at, game_day, client_request_id, source)
       VALUES ('e1','u1','test.logged','{}',$1,$1,'2026-11-18','req-1','app')`,
      [now],
    );
    await expect(
      db.query(
        `INSERT INTO events (id, user_id, type, payload_json, occurred_at, created_at, game_day, client_request_id, source)
         VALUES ('e2','u1','test.logged','{}',$1,$1,'2026-11-18','req-1','app')`,
        [now],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await db.query(
      `INSERT INTO study_logs (id, user_id, client_request_id, topic, studied_on, source_text, created_at, updated_at)
       VALUES ('sl1', 'u1', 'study-request-1', 'BFS', '2026-11-18', 'BFS explores a graph by distance.', $1, $1)`,
      [now],
    );
    await expect(
      db.query(
        `INSERT INTO study_logs (id, user_id, client_request_id, topic, studied_on, source_text, created_at, updated_at)
         VALUES ('sl2', 'u1', 'study-request-1', 'DFS', '2026-11-18', 'DFS explores a graph by depth.', $1, $1)`,
        [now],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await db.query(
      `INSERT INTO study_log_reviews (id, user_id, study_log_id, checkpoint, offset_days, front, back, scheduled_on, due_on, created_at, updated_at)
       VALUES ('slr1', 'u1', 'sl1', 1, 3, 'Question', 'Answer', '2026-11-21', '2026-11-21', $1, $1)`,
      [now],
    );
    await expect(
      db.query(
        `INSERT INTO study_log_reviews (id, user_id, study_log_id, checkpoint, offset_days, front, back, scheduled_on, due_on, created_at, updated_at)
         VALUES ('slr2', 'u1', 'sl1', 1, 3, 'Question', 'Answer', '2026-11-21', '2026-11-21', $1, $1)`,
        [now],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.query(
        `INSERT INTO study_log_reviews (id, user_id, study_log_id, checkpoint, offset_days, front, back, scheduled_on, due_on, created_at, updated_at)
         VALUES ('slr3', 'u1', 'sl1', 1, 4, 'Question', 'Answer', '2026-11-21', '2026-11-21', $1, $1)`,
        [now],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      db.query("INSERT INTO xp_ledger (id,user_id,amount,reason,rule_key,week_id,game_day,occurred_at) VALUES ('x1','u1',-5,'r','k','2026-11-14','2026-11-18',$1)", [
        now,
      ]),
    ).rejects.toMatchObject({ code: "23514" });

    await db.query(
      "INSERT INTO focus_sessions (id,user_id,kind,status,started_at,game_day,created_at,updated_at) VALUES ('f1','u1','other','running',$1,'2026-11-18',$1,$1)",
      [now],
    );
    await expect(
      db.query(
        "INSERT INTO focus_sessions (id,user_id,kind,status,started_at,game_day,created_at,updated_at) VALUES ('f2','u1','other','paused',$1,'2026-11-18',$1,$1)",
        [now],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
