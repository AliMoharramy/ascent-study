import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { gameDay } from "@/lib/time";
import { currentSession } from "./http";
import { currentConfig, ensureDefaultConfig } from "./config";

/**
 * For server components: the signed-in user (redirects to /login otherwise) plus shared context.
 * Memoized per request: the layout and the page both call it, and each call costs several round trips.
 */
export const requireUser = cache(async function requireUser() {
  const db = getDb();
  const session = await currentSession();
  if (!session) redirect("/login");
  await ensureDefaultConfig(db, session.user.id);
  const cfg = await currentConfig(db, session.user.id);
  const tz = session.user.timezone;
  const rollover = session.user.rolloverHour;
  const now = new Date();
  return { db, session, user: session.user, userId: session.user.id, cfg, tz, rollover, now, today: gameDay(now, tz, rollover) };
});
