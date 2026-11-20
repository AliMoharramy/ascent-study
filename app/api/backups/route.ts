import { api } from "@/server/http";
import { appendEvent } from "@/events/store";
import { listBackupsForApp, runBackup } from "@/server/backup";

export const GET = api(async () => await listBackupsForApp());

export const POST = api(async ({ db, userId }) => {
  const r = await runBackup(db);
  await appendEvent(db, { userId, type: "backup.created", payload: { name: r.name, bytes: r.bytes, pruned: r.pruned, manual: true }, source: "system" });
  return { backup: { name: r.name, bytes: r.bytes, createdAt: r.createdAt }, pruned: r.pruned };
});
