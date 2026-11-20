import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDb, type Db } from "@/db/client";
import { TimerError } from "@/domain/timer";
import { CSRF_COOKIE, SESSION_COOKIE, csrfMatches, getSessionUser, type SessionUser } from "./auth";
import { EventRequestConflict } from "@/events/store";
import { CheckinLocked } from "./checkins";
import { FocusConflict } from "./focus";
import { LifeEventDenied, ShieldDenied } from "./quests";
import { HabitLimit } from "./habits";
import { ResetWeekDenied } from "./plan";
import { UndoDenied } from "./undo";
import { ClaimDenied } from "./shop";
import { RestDayDenied } from "./restDays";
import { LifeDenied } from "./life";
import { ExtrasDenied } from "./extras";
import { LearningDenied } from "./learning";
import { BuddyConsentRequired } from "./burnout";
import { ProposalDenied } from "./coach";
import { ExperimentDenied } from "./experiments";
import { takeToken } from "./ratelimit";

const RULE_ERRORS = [LifeEventDenied, ShieldDenied, HabitLimit, ResetWeekDenied, UndoDenied, ClaimDenied, RestDayDenied, LifeDenied, ExtrasDenied, LearningDenied, BuddyConsentRequired, ProposalDenied, ExperimentDenied];

/**
 * Route-handler wrapper: session auth (401), CSRF on mutating requests (403), zod validation (400),
 * domain conflicts (409). Errors use stable `code`s (doc 07 §7).
 */

export type ApiCtx = { db: Db; session: SessionUser; userId: string; req: Request; params: Promise<Record<string, string>> };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message } }, e.status);
  if (e instanceof ZodError)
    return json({ error: { code: "validation", message: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") } }, 400);
  if (e instanceof FocusConflict || e instanceof TimerError) return json({ error: { code: "conflict", message: e.message } }, 409);
  if (e instanceof CheckinLocked) return json({ error: { code: "locked", message: e.message } }, 409);
  if (e instanceof EventRequestConflict) return json({ error: { code: "conflict", message: e.message } }, 409);
  if (RULE_ERRORS.some((C) => e instanceof C)) return json({ error: { code: "rule", message: (e as Error).message } }, 409);
  if (e instanceof Error && /^Unknown /.test(e.message)) return json({ error: { code: "not_found", message: e.message } }, 404);
  // Do not log driver errors: PG messages may contain SQL, data or connection details.
  // Only a short diagnostic code (SQLSTATE such as 55P03 or ECONNRESET), never the message.
  const code = e && typeof e === "object" && "code" in e ? (e as { code?: unknown }).code : undefined;
  console.error(typeof code === "string" && /^[0-9A-Z_]{3,24}$/.test(code) ? `[api] internal_error ${code}` : "[api] internal_error");
  return json({ error: { code: "internal", message: "Internal error" } }, 500);
}

export async function currentSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return await getSessionUser(getDb(), token);
}

export function api(handler: (ctx: ApiCtx) => Promise<Response | unknown> | Response | unknown, opts: { mutating?: boolean } = {}) {
  return async (req: Request, routeCtx?: unknown) => {
    try {
      const db = getDb();
      const session = await currentSession();
      if (!session) throw new ApiError(401, "unauthorized", "Not signed in");
      const mutating = opts.mutating ?? !["GET", "HEAD"].includes(req.method);
      if (mutating) {
        // NFR-05: per-user mutation budget (burst 60, sustained 1/s) — quick logs never hit this.
        const limit = takeToken(`mut:${session.user.id}`, 60, 60);
        if (!limit.ok) throw new ApiError(429, "rate_limited", `Slow down a moment — retry in ${limit.retryAfterSec}s`);
        const h = await headers();
        if (!csrfMatches(session.csrfToken, h.get("x-csrf-token"))) throw new ApiError(403, "csrf", "Missing or invalid CSRF token");
      }
      const params = (routeCtx as { params?: Promise<Record<string, string>> } | undefined)?.params ?? Promise.resolve({});
      const out = await handler({ db, session, userId: session.user.id, req, params });
      return out instanceof Response ? out : json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function body<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "bad_json", "Request body must be JSON");
  }
}

export const cookieOptions = (expires: Date, httpOnly: boolean) => ({
  httpOnly,
  sameSite: "lax" as const,
  secure: process.env.COOKIE_SECURE === "true" || (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false"),
  path: "/",
  expires,
});

export { SESSION_COOKIE, CSRF_COOKIE };
