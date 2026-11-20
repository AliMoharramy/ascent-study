import fs from "node:fs";
import { ApiError, api } from "@/server/http";
import { getRemoteBackup, resolveBackup } from "@/server/backup";

export const GET = api(async ({ params }) => {
  const { name } = await params;
  const headers = { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" };
  if (process.env.VERCEL === "1") {
    const stream = name ? await getRemoteBackup(name) : null;
    if (!stream) throw new ApiError(404, "not_found", "Backup not found");
    return new Response(stream, { headers });
  }
  const file = name ? resolveBackup(name) : null;
  if (!file) throw new ApiError(404, "not_found", "Backup not found");
  return new Response(new Uint8Array(fs.readFileSync(file)), { headers });
});
