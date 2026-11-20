import { z } from "zod";
import { getDb } from "@/db/client";
import { setupUser, SetupAlreadyCompleted } from "@/server/auth";
import { body, errorResponse, json } from "@/server/http";
import { takeToken } from "@/server/ratelimit";
import { importSubjects, loadSubjectsFile } from "@/server/seed";
import { setupTokenMatches } from "@/server/setupToken";

/** First-run setup: the auth service serializes creation of the single user. */
const input = z.object({
  username: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9_.-]+$/, "letters, digits, _ . - only"),
  name: z.string().trim().min(1).max(64),
  password: z.string().min(10).max(256),
  setupToken: z.string().max(256).optional(),
});

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const limit = takeToken(`setup:${ip}`, 10, 1);
    if (!limit.ok) return json({ error: { code: "rate_limited", message: `Too many attempts. Retry in ${limit.retryAfterSec}s.` } }, 429);
    const { setupToken, ...data } = input.parse(await body(req));
    // Checked before any hashing or database work: an unauthorised visitor must not be able to claim a fresh server.
    if (!setupTokenMatches(setupToken)) return json({ error: { code: "setup_token", message: "Invalid or missing setup token" } }, 403);
    const db = getDb();
    const { id } = await setupUser(db, data);
    // Reference data (subjects, chapters, courses…) is idempotent and runs under its own locks, so a fresh deployment
    // is usable even if the operator never ran `npm run db:seed`. It is not part of any cold start, and a failure
    // here must not undo the account: Settings → Seed (or `npm run db:seed`) can repeat it safely.
    let seeded = true;
    try {
      await importSubjects(db, loadSubjectsFile(), { userId: id });
    } catch {
      seeded = false;
      console.error("[setup] seed_failed");
    }
    return json({ ok: true, seeded });
  } catch (e) {
    if (e instanceof SetupAlreadyCompleted) return json({ error: { code: "already_setup", message: "Setup already completed" } }, 409);
    return errorResponse(e);
  }
}
