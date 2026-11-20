import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { appendEvent } from "@/events/store";
import { gameDay } from "@/lib/time";
import { runBackup } from "@/server/backup";
import { dispatchReminders } from "@/server/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Vercel cron entrypoint (vercel.json). Vercel has no long-running process, so the in-process node-cron jobs
 * are replaced by scheduled GETs here, guarded by CRON_SECRET (Vercel sends `Authorization: Bearer <secret>`).
 * Jobs: `reminders` (opt-in dispatch) and `backup` (verified, encrypted archive in private Blob).
 */
export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(req)) {
    return Response.json({ error: { code: "unauthorized", message: "Invalid cron secret" } }, { status: 401 });
  }
  const { job } = await params;
  const db = getDb();
  if (job === "reminders") {
    let sent = 0;
    for (const u of await db.select({ id: users.id, tz: users.timezone, r: users.rolloverHour }).from(users)) {
      sent += await dispatchReminders(db, u.id, gameDay(new Date(), u.tz, u.r));
    }
    return Response.json({ ok: true, job, sent });
  }
  if (job === "backup") {
    try {
      const r = await runBackup(db);
      const [user] = await db.select({ id: users.id }).from(users).limit(1);
      if (user) await appendEvent(db, { userId: user.id, type: "backup.created", payload: { name: r.name, bytes: r.bytes, pruned: r.pruned }, source: "job" });
      return Response.json({ ok: true, job, name: r.name, bytes: r.bytes });
    } catch {
      // A failed backup must be visible to the platform (non-2xx) without leaking details.
      console.error("[cron] backup_failed");
      return Response.json({ error: { code: "backup_failed", message: "Backup failed" } }, { status: 500 });
    }
  }
  return Response.json({ error: { code: "not_found", message: `Unknown job ${job}` } }, { status: 404 });
}
