import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appendEvent } from "@/events/store";
import { login } from "@/server/auth";
import { errorResponse, json } from "@/server/http";
import { takeToken } from "@/server/ratelimit";

const input = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) });

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const limit = takeToken(`login:${ip}`, 10, 1);
    if (!limit.ok) return json({ error: { code: "rate_limited", message: `Too many attempts from this network. Retry in ${limit.retryAfterSec}s.` } }, 429);

    const { username, password } = input.parse(await req.json());
    const db = getDb();
    const result = await login(db, username, password, req.headers.get("user-agent") ?? "Ascent Focus Windows");
    if (!result.ok) {
      if (result.reason === "locked") {
        return json({ error: { code: "locked", message: "Too many attempts. Try again after the account lock expires." } }, 429);
      }
      return json({ error: { code: "invalid", message: "Wrong username or password" } }, 401);
    }

    await appendEvent(db, { userId: result.userId, type: "auth.login", payload: { client: "windows_widget" }, source: "system" });
    return NextResponse.json({
      token: result.token,
      csrfToken: result.csrf,
      userId: result.userId,
      username: username.trim().toLowerCase(),
      expiresAt: result.expiresAt.toISOString(),
    }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    return errorResponse(error);
  }
}
