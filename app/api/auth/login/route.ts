import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appendEvent } from "@/events/store";
import { login } from "@/server/auth";
import { CSRF_COOKIE, SESSION_COOKIE, cookieOptions, errorResponse, json } from "@/server/http";
import { takeToken } from "@/server/ratelimit";

const input = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) });

export async function POST(req: Request) {
  try {
    // NFR-05: per-IP burst 10, then ~1 attempt/min (account lockout still applies on top).
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const limit = takeToken(`login:${ip}`, 10, 1);
    if (!limit.ok) return json({ error: { code: "rate_limited", message: `Too many attempts from this network. Retry in ${limit.retryAfterSec}s.` } }, 429);
    const { username, password } = input.parse(await req.json());
    const db = getDb();
    const r = await login(db, username, password, req.headers.get("user-agent") ?? undefined);
    if (!r.ok) {
      if (r.reason === "locked") return json({ error: { code: "locked", message: `Too many attempts. Try again after ${new Date(r.lockedUntil!).toLocaleTimeString("en-GB", { timeZone: "Asia/Tehran" })}.` } }, 429);
      return json({ error: { code: "invalid", message: "Wrong username or password" } }, 401);
    }
    (await appendEvent(db, { userId: r.userId, type: "auth.login", payload: {}, source: "system" }));
    const jar = await cookies();
    jar.set(SESSION_COOKIE, r.token, cookieOptions(r.expiresAt, true));
    jar.set(CSRF_COOKIE, r.csrf, cookieOptions(r.expiresAt, false));
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
