import { eq } from "drizzle-orm";
import { authSessions } from "@/db/schema";
import { importPortableArchive, runBackup, validateArchive } from "@/server/backup";
import { decryptBuffer, isEncrypted, offsiteKey } from "@/server/backupCrypto";
import { ApiError, api } from "@/server/http";

// Vercel rejects request bodies over 4.5 MB before this code runs; larger archives use `npm run restore`.
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * Full-data import: replaces the entire database with an uploaded archive exported from Settings (for example
 * from Vercel, to continue locally). A verified safety backup is taken first, and the replacement itself is one
 * transaction that re-checks every table against the archive, so a failed import changes nothing.
 */
export const POST = api(async ({ db, req, session }) => {
  let bytes: Buffer = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) throw new ApiError(400, "empty", "Upload an archive exported from Settings");
  if (bytes.length > MAX_BYTES) throw new ApiError(413, "too_large", "File exceeds the 64 MB import limit");
  try {
    if (isEncrypted(bytes)) {
      const key = offsiteKey();
      if (!key) throw new ApiError(400, "key_required", "This archive is encrypted and OFFSITE_KEY is not set on the server");
      bytes = decryptBuffer(bytes, key);
    }
    validateArchive(bytes);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_archive", error instanceof Error ? error.message : "Not a valid backup archive");
  }
  // The safety copy must exist BEFORE anything is replaced; without a place to keep it, refuse.
  let safety: string;
  try {
    safety = (await runBackup(db)).name;
  } catch {
    throw new ApiError(409, "safety_backup_unavailable", "Could not store a safety backup of the current data, so nothing was replaced");
  }
  const keepSession = (await db.select().from(authSessions).where(eq(authSessions.id, session.sessionId)).limit(1))[0];
  try {
    const report = await importPortableArchive(db, bytes, { replace: true, keepSession });
    return { ok: true, safetyBackup: safety, reloginRequired: report.reloginRequired, counts: report.counts };
  } catch (error) {
    throw new ApiError(409, "import_failed", error instanceof Error ? error.message : "Import failed; nothing was changed");
  }
}, { mutating: true });
