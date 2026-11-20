import { del, get, list, put } from "@vercel/blob";
import { offsiteKey } from "./backupCrypto";

/**
 * Private Vercel Blob storage for ENCRYPTED backup archives only. The Blob store is never the live database and
 * never takes part in concurrency control: PostgreSQL is the single source of truth. A backup is written only
 * after it has been encrypted, so a leaked Blob URL or token cannot expose study data.
 */

const PREFIX = "ascent/backups/";
export const REMOTE_BACKUP_NAME = /^ascent-\d{8}-\d{6}\.json\.gz\.enc$/;

export interface RemoteBackupInfo {
  name: string;
  bytes: number;
  createdAt: string;
}

/** Remote backups need both the platform and an encryption key, otherwise the cron job must fail loudly. */
export function remoteBackupsConfigured(): boolean {
  return process.env.VERCEL === "1" && !!offsiteKey();
}

export async function storeRemoteBackup(name: string, bytes: Buffer, keep = 30): Promise<string[]> {
  if (!REMOTE_BACKUP_NAME.test(name)) throw new Error("Invalid backup filename");
  await put(`${PREFIX}${name}`, bytes, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/octet-stream",
    cacheControlMaxAge: 60,
  });
  const backups = await listRemoteBackups();
  const old = backups.slice(keep);
  if (old.length) await del(old.map((backup) => `${PREFIX}${backup.name}`));
  return old.map((backup) => backup.name);
}

export async function listRemoteBackups(): Promise<RemoteBackupInfo[]> {
  const entries = await list({ prefix: PREFIX, limit: 1000 });
  return entries.blobs
    .map((blob) => ({ name: blob.pathname.slice(PREFIX.length), bytes: blob.size, createdAt: blob.uploadedAt.toISOString() }))
    .filter((backup) => REMOTE_BACKUP_NAME.test(backup.name))
    .sort((a, b) => b.name.localeCompare(a.name));
}

export async function getRemoteBackup(name: string): Promise<ReadableStream<Uint8Array> | null> {
  if (!REMOTE_BACKUP_NAME.test(name)) return null;
  const remote = await get(`${PREFIX}${name}`, { access: "private", useCache: false });
  return remote?.statusCode === 200 ? remote.stream : null;
}

/** Reads one stored backup fully, for the verify-after-write step. */
export async function readRemoteBackup(name: string): Promise<Buffer | null> {
  const stream = await getRemoteBackup(name);
  return stream ? Buffer.from(await new Response(stream).arrayBuffer()) : null;
}
