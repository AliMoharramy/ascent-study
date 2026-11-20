import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { sql, type SQL } from "drizzle-orm";
import { getTableConfig, type AnyPgColumn, type PgTable } from "drizzle-orm/pg-core";
import { queryRows, type Db, type Tx } from "@/db/client";
import { authSessions, pgTables } from "@/db/schema";
import { decryptBuffer, encryptBuffer, isEncrypted, offsiteKey, requireOffsiteKey } from "./backupCrypto";
import { REMOTE_BACKUP_NAME, listRemoteBackups, readRemoteBackup, remoteBackupsConfigured, storeRemoteBackup } from "./remoteBackups";

/**
 * Portable PostgreSQL backups.
 *
 * An archive is one gzip-compressed JSON document produced inside a single REPEATABLE READ / READ ONLY
 * transaction, so it is a consistent snapshot even while the app keeps writing. Every table carries its own
 * row count and SHA-256, the whole archive carries a SHA-256, and the migration journal (version + checksum) is
 * recorded so an archive can never be restored into a schema that cannot hold it.
 *
 * Restores run in ONE transaction: truncate → insert in foreign-key order → re-dump every table and compare its
 * digest with the archive. Any mismatch (or any database error) rolls the whole replacement back, so a failed
 * restore leaves the previous data untouched.
 *
 * Live login sessions are never exported: a restored database requires everyone to sign in again.
 */

export const ARCHIVE_FORMAT = "ascent-archive";
export const ARCHIVE_VERSION = 1;
/** Rows of these tables are intentionally excluded (credentials of live sessions must not sit in backups). */
const EXCLUDED_ROWS = new Set(["auth_sessions"]);
const CHUNK = 500;
const SEED_SHARED_LOCK = 721_003;
const SEED_EXCLUSIVE_LOCK = 721_004;
const RESTORE_LOCK = 721_005;

export interface ArchiveTable {
  columns: string[];
  rows: unknown[][];
  count: number;
  sha256: string;
}

export interface ArchiveMigration {
  version: string;
  checksum: string;
}

export interface Archive {
  format: string;
  formatVersion: number;
  createdAt: string;
  schema: { version: string; migrations: ArchiveMigration[] };
  tables: Record<string, ArchiveTable>;
  sha256: string;
}

export interface RestoreReport {
  verified: true;
  reloginRequired: boolean;
  schemaVersion: string;
  createdAt: string;
  counts: Record<string, number>;
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// ── schema metadata ──────────────────────────────────────────

type Kind = "integer" | "number" | "boolean" | "string";

interface TableMeta {
  name: string;
  table: PgTable;
  columns: string[];
  kinds: Map<string, Kind>;
  order: SQL;
}

function kindOf(column: AnyPgColumn): Kind {
  const type = column.getSQLType().toLowerCase();
  if (type === "boolean") return "boolean";
  if (type.includes("double") || type.includes("real") || type.includes("numeric")) return "number";
  if (type.includes("int") && !type.includes("interval")) return "integer";
  return "string";
}

function orderFor(name: string, columns: AnyPgColumn[]): SQL {
  const config = getTableConfig(pgTables[name as keyof typeof pgTables] as PgTable);
  // Composite-key columns are `ExtraConfigColumn` stand-ins whose getSQLType() recurses forever: map them back to
  // the table's real columns by name.
  const byName = new Map(columns.map((c) => [c.name, c]));
  const composite = config.primaryKeys[0]?.columns.map((c) => byName.get(c.name)!);
  const single = columns.filter((c) => c.primary);
  const keys = composite ?? (single.length ? single : columns);
  // COLLATE "C" keeps row order identical across databases with different default collations.
  return sql.join(keys.map((c) => (c.getSQLType().toLowerCase() === "text" ? sql`${sql.identifier(c.name)} COLLATE "C"` : sql.identifier(c.name))), sql`, `);
}

const META: TableMeta[] = Object.entries(pgTables).map(([name, table]) => {
  const columns = getTableConfig(table as PgTable).columns as AnyPgColumn[];
  return { name, table: table as PgTable, columns: columns.map((c) => c.name), kinds: new Map(columns.map((c) => [c.name, kindOf(c)])), order: orderFor(name, columns) };
});
const META_BY_NAME = new Map(META.map((m) => [m.name, m]));

const ident = (name: string) => sql.identifier(name);
const identList = (names: string[]) => sql.join(names.map(ident), sql`, `);

// ── creating an archive ──────────────────────────────────────

async function journalOf(db: Db | Tx): Promise<ArchiveMigration[]> {
  const exists = (await queryRows<{ journal: string | null }>(db, sql`SELECT to_regclass('_migrations')::text AS journal`))[0]?.journal;
  if (!exists) throw new Error("Database has no migration journal; run the PostgreSQL migrations first");
  return await queryRows<{ version: string; checksum: string }>(db, sql`SELECT version, checksum FROM _migrations ORDER BY version`);
}

async function dumpTable(db: Db | Tx, meta: TableMeta): Promise<ArchiveTable> {
  const rows = EXCLUDED_ROWS.has(meta.name)
    ? []
    : (await queryRows<Record<string, unknown>>(db, sql`SELECT ${identList(meta.columns)} FROM ${ident(meta.name)} ORDER BY ${meta.order}`))
        .map((row) => meta.columns.map((column) => row[column] ?? null));
  return { columns: meta.columns, rows, count: rows.length, sha256: digest({ columns: meta.columns, rows }) };
}

/** A consistent snapshot of every application table, gzip-compressed. */
export async function createPortableArchive(db: Db, now = new Date()): Promise<Buffer> {
  const body = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
    const migrations = await journalOf(tx);
    const tables: Record<string, ArchiveTable> = {};
    for (const meta of META) tables[meta.name] = await dumpTable(tx, meta);
    return {
      format: ARCHIVE_FORMAT,
      formatVersion: ARCHIVE_VERSION,
      createdAt: now.toISOString(),
      schema: { version: migrations[migrations.length - 1]?.version ?? "none", migrations },
      tables,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  return gzipSync(JSON.stringify({ ...body, sha256: digest(body) }));
}

// ── validating an archive (no database needed) ───────────────

function cellOk(value: unknown, kind: Kind): boolean {
  if (value === null) return true;
  if (kind === "integer") return typeof value === "number" && Number.isSafeInteger(value);
  if (kind === "number") return typeof value === "number" && Number.isFinite(value);
  if (kind === "boolean") return typeof value === "boolean";
  return typeof value === "string";
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Decompress and check structure, types, row counts and every checksum. Throws on the first problem. */
export function validateArchive(bytes: Buffer): Archive {
  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(bytes).toString("utf8"));
  } catch {
    throw new Error("Not a valid backup archive (cannot decompress or parse it)");
  }
  if (!isRecord(parsed) || parsed.format !== ARCHIVE_FORMAT || parsed.formatVersion !== ARCHIVE_VERSION) throw new Error("Unsupported backup archive format");
  const { sha256, ...body } = parsed;
  if (typeof sha256 !== "string" || sha256 !== digest(body)) throw new Error("Backup archive checksum mismatch — the file is damaged or was modified");
  const archive = parsed as unknown as Archive;
  const schema = archive.schema;
  if (!schema || typeof schema.version !== "string" || !Array.isArray(schema.migrations) || !isRecord(archive.tables)) throw new Error("Backup archive is missing its schema description");
  const last = schema.migrations[schema.migrations.length - 1]?.version ?? "none";
  if (schema.version !== last) throw new Error("Backup archive schema version does not match its migration journal");
  for (const m of schema.migrations) if (typeof m?.version !== "string" || !/^[0-9a-f]{64}$/.test(String(m.checksum))) throw new Error("Backup archive migration journal is malformed");

  for (const [name, table] of Object.entries(archive.tables)) {
    const meta = META_BY_NAME.get(name);
    if (!meta) throw new Error(`Backup archive contains an unknown table: ${name}`);
    if (!isRecord(table) || !Array.isArray(table.columns) || !Array.isArray(table.rows)) throw new Error(`Backup archive table ${name} is malformed`);
    if (table.sha256 !== digest({ columns: table.columns, rows: table.rows })) throw new Error(`Backup archive table ${name} checksum mismatch`);
    if (table.count !== table.rows.length) throw new Error(`Backup archive table ${name} row count does not match its rows`);
    for (const column of table.columns) if (!meta.kinds.has(column)) throw new Error(`Backup archive table ${name} has an unknown column`);
    if (new Set(table.columns).size !== table.columns.length) throw new Error(`Backup archive table ${name} has duplicate columns`);
    const kinds = table.columns.map((column) => meta.kinds.get(column)!);
    for (const row of table.rows) {
      if (!Array.isArray(row) || row.length !== kinds.length || row.some((cell, i) => !cellOk(cell, kinds[i]!))) {
        throw new Error(`Backup archive table ${name} contains a value of the wrong type`);
      }
    }
  }
  return archive;
}

// ── restoring an archive ─────────────────────────────────────

/** Parent-before-child order from the live foreign keys; self references are ignored. */
async function insertOrder(tx: Tx, names: string[]): Promise<string[]> {
  const edges = await queryRows<{ child: string; parent: string }>(tx, sql`
    SELECT c.relname AS child, p.relname AS parent
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_class p ON p.oid = k.confrelid
    WHERE k.contype = 'f' AND c.relnamespace = current_schema()::regnamespace`);
  const wanted = new Set(names);
  const parents = new Map(names.map((n) => [n, new Set<string>()]));
  for (const { child, parent } of edges) if (child !== parent && wanted.has(child) && wanted.has(parent)) parents.get(child)!.add(parent);
  const ordered: string[] = [];
  const done = new Set<string>();
  while (ordered.length < names.length) {
    const ready = names.filter((n) => !done.has(n) && [...parents.get(n)!].every((p) => done.has(p)));
    if (ready.length === 0) throw new Error("Foreign keys form a cycle; the archive cannot be restored in order");
    for (const n of ready) { done.add(n); ordered.push(n); }
  }
  return ordered;
}

async function assertCompatibleSchema(tx: Tx, archive: Archive): Promise<void> {
  const live = new Map((await journalOf(tx)).map((m) => [m.version, m.checksum]));
  if (!live.has(archive.schema.version)) throw new Error("Backup was made by a newer schema than this database; deploy and migrate first");
  for (const m of archive.schema.migrations) {
    if (live.get(m.version) !== m.checksum) throw new Error(`Backup migration ${m.version} does not match this database's migration history`);
  }
}

export interface ImportOptions {
  /** Required to overwrite a database that already contains a user. */
  replace?: boolean;
  /** Keeps the caller signed in after the swap, when the same user exists in the archive. */
  keepSession?: typeof authSessions.$inferSelect;
}

/** Validate, then replace the whole database content with the archive — atomically and verified. */
export async function importPortableArchive(db: Db, bytes: Buffer, opts: ImportOptions = {}): Promise<RestoreReport> {
  const archive = validateArchive(bytes);
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '30s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${SEED_SHARED_LOCK})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SEED_EXCLUSIVE_LOCK})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${RESTORE_LOCK})`);
    await assertCompatibleSchema(tx, archive);

    const hasUser = (await queryRows<{ present: boolean }>(tx, sql`SELECT EXISTS (SELECT 1 FROM users) AS present`))[0]?.present;
    if (hasUser && !opts.replace) throw new Error("Target database is non-empty; restoring requires an explicit replace confirmation");

    // Everything below is rolled back as a unit if any step fails.
    await tx.execute(sql`TRUNCATE TABLE ${identList(META.map((m) => m.name))}`);
    for (const name of await insertOrder(tx, Object.keys(archive.tables))) {
      const table = archive.tables[name]!;
      for (let i = 0; i < table.rows.length; i += CHUNK) {
        const objects = table.rows.slice(i, i + CHUNK).map((row) => Object.fromEntries(table.columns.map((column, c) => [column, row[c]])));
        await tx.execute(sql`INSERT INTO ${ident(name)} (${identList(table.columns)})
          SELECT ${identList(table.columns)} FROM jsonb_populate_recordset(NULL::${ident(name)}, ${JSON.stringify(objects)}::jsonb)`);
      }
    }

    // Prove the data the database now holds is exactly the data the archive described.
    const counts: Record<string, number> = {};
    for (const meta of META) {
      const expected = archive.tables[meta.name];
      const actual = await dumpTable(tx, meta);
      counts[meta.name] = actual.count;
      if (!expected) {
        if (actual.count !== 0) throw new Error(`Restore verification failed: ${meta.name} should be empty`);
        continue;
      }
      if (actual.count !== expected.count || (actual.sha256 !== expected.sha256 && sameColumns(expected.columns, meta.columns))) {
        throw new Error(`Restore verification failed for table ${meta.name}`);
      }
    }

    let kept = false;
    const session = opts.keepSession;
    if (session && (await queryRows(tx, sql`SELECT 1 FROM users WHERE id = ${session.userId}`)).length) {
      await tx.insert(authSessions).values(session);
      kept = true;
    }
    return { verified: true as const, reloginRequired: !kept, schemaVersion: archive.schema.version, createdAt: archive.createdAt, counts };
  });
}

const sameColumns = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i]);

/** The restore drill: load an archive into an EMPTY database and prove it round-trips. Never overwrites data. */
export async function verifyRestoreIntoEmptyDb(db: Db, bytes: Buffer): Promise<RestoreReport> {
  return await importPortableArchive(db, bytes, { replace: false });
}

// ── backup files (local disk) ────────────────────────────────

export interface BackupInfo {
  file: string;
  name: string;
  bytes: number;
  createdAt: string;
}

const NAME = /^ascent-\d{8}-\d{6}\.json\.gz$/;
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

export const backupName = (now: Date) => `ascent-${stamp(now)}.json.gz`;
export const encryptedBackupName = (now: Date) => `${backupName(now)}.enc`;

export function backupDir(): string {
  return process.env.BACKUP_DIR ?? path.join(process.cwd(), "data", "backups");
}

function refuseEphemeralDisk(): void {
  if (process.env.VERCEL === "1") {
    throw new Error("Vercel's disk is ephemeral and cannot hold backups; download an export (/api/export/full) or enable encrypted remote backups");
  }
}

/** Reads an archive file, transparently decrypting it when it carries the encrypted-envelope header. */
export function readArchiveFile(file: string, passphrase = offsiteKey()): Buffer {
  const raw = fs.readFileSync(file);
  if (!isEncrypted(raw)) return raw;
  if (!passphrase) throw new Error("OFFSITE_KEY is not set");
  return decryptBuffer(raw, passphrase);
}

/** Opens a backup and checks every structural invariant and checksum. Throws if anything is wrong. */
export async function verifyBackup(file: string, passphrase?: string | null): Promise<{ tables: number; schemaVersion: string; createdAt: string; rows: number }> {
  const archive = validateArchive(readArchiveFile(file, passphrase ?? offsiteKey()));
  return {
    tables: Object.keys(archive.tables).length,
    schemaVersion: archive.schema.version,
    createdAt: archive.createdAt,
    rows: Object.values(archive.tables).reduce((n, t) => n + t.count, 0),
  };
}

export async function createBackup(db: Db, dir = backupDir(), now = new Date()): Promise<BackupInfo> {
  refuseEphemeralDisk();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, backupName(now));
  const tmp = `${file}.partial`;
  fs.writeFileSync(tmp, await createPortableArchive(db, now));
  try {
    await verifyBackup(tmp);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  fs.renameSync(tmp, file); // a half-written file never carries a backup name
  return { file, name: path.basename(file), bytes: fs.statSync(file).size, createdAt: now.toISOString() };
}

export function listBackups(dir = backupDir()): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse().map((name) => {
    const file = path.join(dir, name);
    const st = fs.statSync(file);
    return { file, name, bytes: st.size, createdAt: st.mtime.toISOString() };
  });
}

/** Deletes all but the newest `keep` backups. Returns deleted names. */
export function pruneBackups(dir = backupDir(), keep = 30): string[] {
  const old = listBackups(dir).slice(keep);
  for (const b of old) fs.rmSync(b.file);
  return old.map((b) => b.name);
}

/** Resolves a backup by bare name, refusing path traversal. */
export function resolveBackup(name: string, dir = backupDir()): string | null {
  if (!NAME.test(name)) return null;
  const file = path.join(dir, name);
  return fs.existsSync(file) ? file : null;
}

/** Local/self-hosted job body: verified backup file + prune. */
export async function nightlyBackup(db: Db, dir = backupDir(), keep = 30) {
  const info = await createBackup(db, dir);
  return { ...info, pruned: pruneBackups(dir, keep) };
}

// ── encrypted remote backups (Vercel) ────────────────────────

export interface RemoteBackupResult {
  name: string;
  bytes: number;
  createdAt: string;
  pruned: string[];
}

/**
 * Archive → encrypt → store in private Blob → read it back, decrypt and validate before reporting success. A backup
 * that cannot be read back is treated as no backup at all.
 */
export async function createRemoteBackup(db: Db, opts: { keep?: number; now?: Date } = {}): Promise<RemoteBackupResult> {
  const key = requireOffsiteKey();
  const now = opts.now ?? new Date();
  const name = encryptedBackupName(now);
  if (!REMOTE_BACKUP_NAME.test(name)) throw new Error("Invalid backup filename");
  const encrypted = encryptBuffer(await createPortableArchive(db, now), key);
  validateArchive(decryptBuffer(encrypted, key));
  const pruned = await storeRemoteBackup(name, encrypted, opts.keep ?? 30);
  const stored = await readRemoteBackup(name);
  if (!stored || !stored.equals(encrypted)) throw new Error("Remote backup could not be read back intact");
  return { name, bytes: encrypted.length, createdAt: now.toISOString(), pruned };
}

/** One entry point for cron and the Settings button: remote on Vercel, verified local file elsewhere. */
export async function runBackup(db: Db): Promise<{ name: string; bytes: number; createdAt: string; pruned: string[]; remote: boolean }> {
  if (process.env.VERCEL === "1") {
    if (!remoteBackupsConfigured()) throw new Error("Remote backups need OFFSITE_KEY; set it, or download an export instead");
    return { ...(await createRemoteBackup(db)), remote: true };
  }
  const r = await nightlyBackup(db);
  return { name: r.name, bytes: r.bytes, createdAt: r.createdAt, pruned: r.pruned, remote: false };
}

export interface BackupListing {
  supported: boolean;
  exportUrl: string;
  backups: Pick<BackupInfo, "name" | "bytes" | "createdAt">[];
}

export async function listBackupsForApp(): Promise<BackupListing> {
  const exportUrl = "/api/export/full";
  if (process.env.VERCEL === "1") {
    if (!remoteBackupsConfigured()) return { supported: false, exportUrl, backups: [] };
    return { supported: true, exportUrl, backups: await listRemoteBackups().catch(() => []) };
  }
  return { supported: true, exportUrl, backups: listBackups().map(({ name, bytes, createdAt }) => ({ name, bytes, createdAt })) };
}

export { getRemoteBackup } from "./remoteBackups";
