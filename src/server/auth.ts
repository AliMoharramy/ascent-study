import crypto from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt, lt } from "drizzle-orm";
import { withUserTransaction, type Db } from "@/db/client";
import { authSessions, users } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";
import { ensureDefaultConfig } from "./config";

/**
 * Single-user auth (F-CORE-01): Argon2id passwords, 30-day sessions, lock after 5 failed attempts.
 * Session token = 32 random bytes in an HttpOnly cookie; the DB stores only its SHA-256.
 * CSRF: per-session token, sent back by the client in the `x-csrf-token` header (double submit).
 */

export const SESSION_COOKIE = "ascent_session";
export const CSRF_COOKIE = "ascent_csrf";
export const SESSION_DAYS = 30;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

// Argon2id (algorithm 2), OWASP-recommended baseline parameters.
const ARGON = { algorithm: 2 as const, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = (hashStr: string, pw: string) => verify(hashStr, pw).catch(() => false);

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("base64url");

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters";
  if (pw.length > 256) return "Password too long";
  return null;
}

type UserInput = { username: string; name: string; password: string };

async function insertUser(db: Db, input: UserInput, passwordHash: string): Promise<string> {
  const id = newId();
  return await withUserTransaction(db, id, async (tx) => {
    const now = nowIso();
    await tx.insert(users).values({ id, username: input.username.trim().toLowerCase(), name: input.name.trim(), passwordHash, createdAt: now, updatedAt: now });
    return id;
  });
}

export async function createUser(db: Db, input: UserInput): Promise<string> {
  const problem = validatePasswordStrength(input.password);
  if (problem) throw new Error(problem);
  const passwordHash = await hashPassword(input.password);
  return await insertUser(db, input, passwordHash);
}

export class SetupAlreadyCompleted extends Error {
  constructor() { super("Setup has already been completed"); }
}

/** The singleton index is the final guard; user and defaults are one atomic first-run operation. */
export async function setupUser(db: Db, input: UserInput): Promise<{ id: string }> {
  const problem = validatePasswordStrength(input.password);
  if (problem) throw new Error(problem);
  const passwordHash = await hashPassword(input.password);
  try {
    return await withUserTransaction(db, "setup:singleton", async (tx) => {
      if ((await tx.select({ id: users.id }).from(users).limit(1))[0]) throw new SetupAlreadyCompleted();
      const id = await insertUser(tx, input, passwordHash);
      await ensureDefaultConfig(tx, id);
      return { id };
    });
  } catch (error) {
    let cause: unknown = error;
    while (cause && typeof cause === "object") {
      if ("code" in cause && cause.code === "23505" && "constraint" in cause &&
          (cause.constraint === "uq_users_singleton" || cause.constraint === "users_username_key")) throw new SetupAlreadyCompleted();
      cause = "cause" in cause ? cause.cause : undefined;
    }
    throw error;
  }
}

export async function setPassword(db: Db, userId: string, password: string): Promise<void> {
  const problem = validatePasswordStrength(password);
  if (problem) throw new Error(problem);
  const passwordHash = await hashPassword(password);
  await withUserTransaction(db, userId, async (tx) => {
    await tx.update(users).set({ passwordHash, failedLogins: 0, lockedUntil: null, updatedAt: nowIso() }).where(eq(users.id, userId));
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
  });
}

export type LoginResult =
  | { ok: true; token: string; csrf: string; userId: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "locked"; lockedUntil?: string };

export async function login(db: Db, username: string, password: string, userAgent?: string, now = new Date()): Promise<LoginResult> {
  const user = (await db.select().from(users).where(eq(users.username, username.trim().toLowerCase())).limit(1))[0];
  if (!user) {
    // constant-ish time: still run a hash verification
    await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$0000000000000000000000000000000000000000000", password);
    return { ok: false, reason: "invalid" };
  }
  if (user.lockedUntil && new Date(user.lockedUntil) > now) return { ok: false, reason: "locked", lockedUntil: user.lockedUntil };

  // Argon2 is slow and CPU-bound: verify OUTSIDE the lock, then apply its outcome atomically below.
  const good = await verifyPassword(user.passwordHash, password);
  return await withUserTransaction(db, user.id, async (tx): Promise<LoginResult> => {
    // Re-read under the lock: concurrent attempts (or a password change) may have happened while hashing.
    const fresh = (await tx.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
    if (!fresh || fresh.passwordHash !== user.passwordHash) return { ok: false, reason: "invalid" };
    if (fresh.lockedUntil && new Date(fresh.lockedUntil) > now) return { ok: false, reason: "locked", lockedUntil: fresh.lockedUntil };
    if (!good) {
      const failed = (fresh.lockedUntil && new Date(fresh.lockedUntil) <= now ? 0 : fresh.failedLogins) + 1;
      const lock = failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null;
      await tx.update(users).set({ failedLogins: lock ? 0 : failed, lockedUntil: lock, updatedAt: now.toISOString() }).where(eq(users.id, user.id));
      return lock ? { ok: false, reason: "locked", lockedUntil: lock } : { ok: false, reason: "invalid" };
    }
    const token = randomToken();
    const csrf = randomToken();
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
    // Reset counters, open the session and prune expired ones atomically.
    await tx.update(users).set({ failedLogins: 0, lockedUntil: null, updatedAt: now.toISOString() }).where(eq(users.id, user.id));
    await tx.insert(authSessions)
      .values({ id: sha256(token), userId: user.id, csrfToken: csrf, expiresAt: expiresAt.toISOString(), createdAt: now.toISOString(), userAgent: userAgent?.slice(0, 200) ?? null });
    await tx.delete(authSessions).where(lt(authSessions.expiresAt, now.toISOString()));
    return { ok: true, token, csrf, userId: user.id, expiresAt };
  });
}

export interface SessionUser {
  sessionId: string;
  csrfToken: string;
  user: typeof users.$inferSelect;
}

export async function getSessionUser(db: Db, token: string | undefined | null, now = new Date()): Promise<SessionUser | null> {
  if (!token) return null;
  const row = (await db
    .select()
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.id, sha256(token)), gt(authSessions.expiresAt, now.toISOString())))
    .limit(1))[0];
  if (!row) return null;
  return { sessionId: row.auth_sessions.id, csrfToken: row.auth_sessions.csrfToken, user: row.users };
}

export async function logout(db: Db, token: string | undefined | null): Promise<void> {
  if (!token) return;
  await db.delete(authSessions).where(eq(authSessions.id, sha256(token)));
}

export function csrfMatches(expected: string, given: string | null | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const _internal = { sha256, newId };
