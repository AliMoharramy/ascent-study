import { api, ApiError } from "@/server/http";
import { ankiExport, planIcs } from "@/server/exports";
import { gameDay } from "@/lib/time";

/** File downloads (#103): GET /api/exports?kind=ics|anki — read-only, no CSRF needed. */
export const GET = api(async ({ db, userId, session, req }) => {
  const kind = new URL(req.url).searchParams.get("kind") ?? "ics";
  const d = gameDay(new Date(), session.user.timezone, session.user.rolloverHour);
  const file = kind === "ics" ? (await planIcs(db, userId, d, session.user.timezone)) : kind === "anki" ? (await ankiExport(db, userId)) : null;
  if (!file) throw new ApiError(400, "validation", "kind must be ics or anki");
  return new Response(file.content, {
    headers: { "content-type": file.mime, "content-disposition": `attachment; filename="${file.filename}"`, "cache-control": "no-store" },
  });
});