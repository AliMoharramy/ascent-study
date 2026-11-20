// npm run offsite — weekly-style ENCRYPTED copy (AES-256-GCM, OFFSITE_KEY) in OFFSITE_DIR, newest 8 kept.
// To restore an offsite copy use `npm run restore -- <file.json.gz.enc>`; it decrypts with OFFSITE_KEY.
import { closeDb, getDb } from "../src/db/client";
import { createOffsiteBackup, listOffsite } from "../src/server/offsite";

try {
  const r = await createOffsiteBackup(getDb());
  console.log(`offsite ${r.file} (${r.bytes} B encrypted from ${r.sourceBytes} B, verified); copies: ${listOffsite().length}`);
} finally {
  await closeDb();
}
