// npm run backup — one verified backup file now (written to BACKUP_DIR, default data/backups), pruned to 30.
// Run it from your own machine against production by pointing DATABASE_URL at the database: the archive is a
// consistent snapshot taken in a read-only transaction, so it is safe while the app is in use.
import { closeDb, getDb } from "../src/db/client";
import { nightlyBackup } from "../src/server/backup";

try {
  const r = await nightlyBackup(getDb());
  console.log(`backup ${r.file} (${r.bytes} B, verified); pruned: ${r.pruned.join(", ") || "none"}`);
} finally {
  await closeDb();
}
