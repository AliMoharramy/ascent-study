// npm run restore -- <backup-file> [--drill] [--replace] [--migrate]
//
// Restores a verified archive (.json.gz, or the encrypted .json.gz.enc using OFFSITE_KEY) into the database named
// by RESTORE_DATABASE_URL — never silently into DATABASE_URL.
//
//   --drill     rehearsal: the target must be EMPTY and is never overwritten. Use a fresh/scratch database.
//   --replace   allow overwriting a database that already holds a user (the previous data is lost: back it up first).
//   --migrate   apply the PostgreSQL migrations to the target first (use for a brand-new empty database).
//
// The restore is one transaction that re-checks every table against the archive; if anything differs, nothing changes.
import { createDb, closeDb } from "../src/db/client";
import { migrationUrl, runPgMigrations } from "../src/db/migrate-pg";
import { importPortableArchive, readArchiveFile, validateArchive } from "../src/server/backup";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npm run restore -- <backup-file> [--drill] [--replace] [--migrate]");
  process.exit(1);
}
if (flags.has("--drill") && flags.has("--replace")) {
  console.error("--drill never overwrites data; drop --replace or drop --drill");
  process.exit(1);
}
const target = process.env.RESTORE_DATABASE_URL;
if (!target) {
  console.error("Set RESTORE_DATABASE_URL to the database to restore INTO (a scratch database for a drill).");
  process.exit(1);
}
if (target === process.env.DATABASE_URL && !flags.has("--replace")) {
  console.error("RESTORE_DATABASE_URL equals DATABASE_URL (the live database); restoring there needs an explicit --replace.");
  process.exit(1);
}

const archive = validateArchive(readArchiveFile(file));
console.log(`archive ok: ${Object.keys(archive.tables).length} tables, schema ${archive.schema.version}, made ${archive.createdAt}`);
if (flags.has("--migrate")) {
  // Migrations need a direct connection; the restore target is used as-is for them.
  process.env.DIRECT_DATABASE_URL = target;
  const m = await runPgMigrations(migrationUrl());
  console.log(`migrations: ${m.applied.length ? m.applied.join(", ") : "already up to date"}`);
}
const db = createDb(target);
try {
  const report = await importPortableArchive(db, readArchiveFile(file), { replace: flags.has("--replace") });
  const rows = Object.values(report.counts).reduce((n, c) => n + c, 0);
  console.log(`${flags.has("--drill") ? "drill passed" : "restored"}: ${rows} rows verified across ${Object.keys(report.counts).length} tables; sign in again (sessions are never restored)`);
} finally {
  await closeDb();
}
