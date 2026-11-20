import { api } from "@/server/http";
import { backupName, createPortableArchive } from "@/server/backup";

/**
 * Full-data export: a consistent snapshot of EVERYTHING as one verified gzip archive. Sessions are not included,
 * so the file carries no live login credentials; restore it with `npm run restore` or Settings → Import.
 */
export const GET = api(async ({ db }) => {
  const now = new Date();
  const bytes = await createPortableArchive(db, now);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${backupName(now)}"`,
      "cache-control": "no-store",
    },
  });
});
