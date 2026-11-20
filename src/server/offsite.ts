import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/db/client";
import { createPortableArchive, encryptedBackupName, importPortableArchive, validateArchive, type BackupInfo, type RestoreReport } from "./backup";
import { decryptBuffer, decryptFile, encryptBuffer, encryptFile, offsiteKey, requireOffsiteKey } from "./backupCrypto";

/**
 * Encrypted offsite copy (F-OPS-03): AES-256-GCM over a verified portable archive. The key comes from OFFSITE_KEY
 * and never touches the file. Local nightly backups are unchanged; this is the weekly copy that can leave the
 * machine (USB, another host, any dumb storage).
 */

export { decryptFile, encryptFile, offsiteKey };

const NAME = /^ascent-\d{8}-\d{6}\.json\.gz\.enc$/;

export interface OffsiteInfo extends BackupInfo {
  sourceBytes: number;
}

export function offsiteDir(): string {
  return process.env.OFFSITE_DIR ?? path.join(process.cwd(), "data", "offsite");
}

export async function createOffsiteBackup(db: Db, opts: { dir?: string; passphrase?: string | null; keep?: number; now?: Date } = {}): Promise<OffsiteInfo> {
  const dir = opts.dir ?? offsiteDir();
  const passphrase = opts.passphrase === undefined ? requireOffsiteKey() : opts.passphrase;
  if (!passphrase) throw new Error("OFFSITE_KEY is not set — refusing to write an unencrypted offsite copy");
  const now = opts.now ?? new Date();
  const archive = await createPortableArchive(db, now);
  const encrypted = encryptBuffer(archive, passphrase);
  validateArchive(decryptBuffer(encrypted, passphrase)); // prove the copy is readable before reporting success
  fs.mkdirSync(dir, { recursive: true });
  const name = encryptedBackupName(now);
  const file = path.join(dir, name);
  const tmp = `${file}.partial`;
  fs.writeFileSync(tmp, encrypted);
  fs.renameSync(tmp, file);
  pruneOffsite(dir, opts.keep ?? 8);
  return { file, name, bytes: encrypted.length, sourceBytes: archive.length, createdAt: now.toISOString() };
}

export function listOffsite(dir = offsiteDir()): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse().map((name) => {
    const file = path.join(dir, name);
    const st = fs.statSync(file);
    return { file, name, bytes: st.size, createdAt: st.mtime.toISOString() };
  });
}

export function pruneOffsite(dir = offsiteDir(), keep = 8): string[] {
  const old = listOffsite(dir).slice(keep);
  for (const b of old) fs.rmSync(b.file);
  return old.map((b) => b.name);
}

/** Decrypts an offsite copy and restores it into `db`, verified and atomic. Refuses a non-empty target unless `replace`. */
export async function restoreOffsite(db: Db, file: string, opts: { passphrase?: string | null; replace?: boolean } = {}): Promise<RestoreReport> {
  const passphrase = opts.passphrase === undefined ? offsiteKey() : opts.passphrase;
  if (!passphrase) throw new Error("OFFSITE_KEY is not set");
  if (!fs.existsSync(file)) throw new Error(`Offsite backup not found: ${file}`);
  const plain = decryptBuffer(fs.readFileSync(file), passphrase);
  return await importPortableArchive(db, plain, { replace: opts.replace });
}
