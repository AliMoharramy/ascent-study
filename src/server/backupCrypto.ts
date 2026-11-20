import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * AES-256-GCM envelope for backup archives. The key comes from OFFSITE_KEY (a passphrase or 64 hex chars) and
 * never touches the file: scrypt derives the 32-byte key from a random per-file salt. The GCM tag makes a
 * tampered or truncated copy fail loudly instead of restoring silently wrong data.
 *
 * Layout: MAGIC | salt(16) | iv(12) | tag(16) | ciphertext
 */

export const MAGIC = Buffer.from("ASCENT-OFFSITE-1\n");
const SALT = 16;
const IV = 12;
const TAG = 16;

export function offsiteKey(): string | null {
  const key = process.env.OFFSITE_KEY?.trim();
  return key ? key : null;
}

export function requireOffsiteKey(): string {
  const key = offsiteKey();
  if (!key) throw new Error("OFFSITE_KEY is not set — refusing to write or read an encrypted backup without it");
  return key;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  // A 64-hex value is accepted as a raw key; anything else is a passphrase.
  if (/^[0-9a-fA-F]{64}$/.test(passphrase)) return Buffer.from(passphrase, "hex");
  return crypto.scryptSync(passphrase, salt, 32, { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function isEncrypted(buf: Buffer): boolean {
  return buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptBuffer(plain: Buffer, passphrase: string): Buffer {
  const salt = crypto.randomBytes(SALT);
  const iv = crypto.randomBytes(IV);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decryptBuffer(buf: Buffer, passphrase: string): Buffer {
  if (buf.length < MAGIC.length + SALT + IV + TAG || !isEncrypted(buf)) throw new Error("Not an encrypted backup file");
  const salt = buf.subarray(MAGIC.length, MAGIC.length + SALT);
  const iv = buf.subarray(MAGIC.length + SALT, MAGIC.length + SALT + IV);
  const tag = buf.subarray(MAGIC.length + SALT + IV, MAGIC.length + SALT + IV + TAG);
  const body = buf.subarray(MAGIC.length + SALT + IV + TAG);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error("Could not decrypt the backup — wrong OFFSITE_KEY or a damaged file");
  }
}

export function encryptFile(src: string, dest: string, passphrase: string): void {
  const encrypted = encryptBuffer(fs.readFileSync(src), passphrase);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, encrypted);
}

/** Writes `dest` only after authentication succeeds, so a damaged file never leaves partial plaintext behind. */
export function decryptFile(src: string, dest: string, passphrase = offsiteKey()): void {
  if (!passphrase) throw new Error("OFFSITE_KEY is not set");
  const plain = decryptBuffer(fs.readFileSync(src), passphrase);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, plain);
}
