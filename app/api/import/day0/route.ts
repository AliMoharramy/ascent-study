import { z } from "zod";
import { api, body } from "@/server/http";
import { commitDay0, day0Template, previewDay0 } from "@/server/importDay0";

export const GET = api(() => new Response(day0Template(), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="day0-kit-template.csv"' } }));

const input = z.object({ csv: z.string().min(1).max(2_000_000), commit: z.boolean().default(false) });

export const POST = api(async ({ db, userId, req, session }) => {
  const { csv, commit } = input.parse(await body(req));
  const preview = (await previewDay0(db, csv));
  if (!commit) return { preview };
  const result = (await commitDay0(db, userId, preview, { tz: session.user.timezone }));
  return { preview, result };
});
