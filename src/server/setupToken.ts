import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Optional guard for the first-run account creation.
 *
 * A fresh deployment is publicly reachable before its owner has created the one and only account, so whoever opens the
 * URL first could claim it. Set `SETUP_TOKEN` (any long random string) in the server environment and creating the
 * account additionally requires that value. Unset = the previous behaviour (fine on localhost / a private network).
 */

export function setupTokenRequired(): boolean {
  return !!process.env.SETUP_TOKEN?.trim();
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** True when no token is configured, or when `given` equals it (constant-time, length-independent). */
export function setupTokenMatches(given: string | null | undefined): boolean {
  const expected = process.env.SETUP_TOKEN?.trim();
  if (!expected) return true;
  return timingSafeEqual(digest(given?.trim() ?? ""), digest(expected));
}
