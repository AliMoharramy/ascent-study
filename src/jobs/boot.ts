import cron from "node-cron";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { appendEvent } from "@/events/store";
import { dispatchReminders } from "@/server/notify";
import { gameDay } from "@/lib/time";

const g = globalThis as unknown as { __ascentBooted?: boolean };

/** Register local jobs only. No schema changes, seed import, connection or offsite uploads at boot. */
export async function boot() {
  if (g.__ascentBooted || process.env.DISABLE_JOBS === "true" || process.env.VERCEL === "1") return;
  g.__ascentBooted = true;
  const backupDir = process.env.BACKUP_DIR;
  // Optional operator-owned local backups. Vercel backups are explicit downloads, not scheduled uploads.
  if (backupDir) {
    cron.schedule(
      "30 3 * * *",
      async () => {
        if (process.env.DISABLE_JOBS === "true") return;
        try {
          const { nightlyBackup } = await import("@/server/backup");
          const db = getDb();
          const r = await nightlyBackup(db, backupDir);
          const [user] = await db.select({ id: users.id }).from(users).limit(1);
          if (user) await appendEvent(db, { userId: user.id, type: "backup.created", payload: { name: r.name, bytes: r.bytes, pruned: r.pruned }, source: "job" });
          console.log("[job] backup_completed");
        } catch {
          console.error("[job] backup_failed");
        }
      },
      { timezone: process.env.TZ || "Asia/Tehran", name: "nightly-backup" },
    );
  }
  // Opt-in reminder channels; local tests/development disable scheduling via DISABLE_JOBS=true.
  cron.schedule(
    "*/15 * * * *",
    async () => {
      if (process.env.DISABLE_JOBS === "true") return;
      try {
        const db = getDb();
        const allUsers = await db.select({ id: users.id, tz: users.timezone, r: users.rolloverHour }).from(users);
        for (const u of allUsers) {
          await dispatchReminders(db, u.id, gameDay(new Date(), u.tz, u.r));
        }
      } catch {
        console.error("[job] reminder_dispatch_failed");
      }
    },
    { timezone: process.env.TZ || "Asia/Tehran", name: "reminder-dispatch" },
  );
}
