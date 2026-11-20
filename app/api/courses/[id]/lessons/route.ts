import { z } from "zod";
import { ApiError, api, body } from "@/server/http";
import { getCourse, importLessons, previewLessons } from "@/server/courses";

const input = z.object({ text: z.string().min(1).max(500_000), mode: z.enum(["replace", "append"]).default("replace"), commit: z.boolean().default(false) });

export const POST = api(async ({ db, userId, params, req }) => {
  const { id } = await params;
  if (!id || !(await getCourse(db, id))) throw new ApiError(404, "not_found", "Course not found");
  const { text, mode, commit } = input.parse(await body(req));
  if (!commit) return { preview: previewLessons(text) };
  const t0 = performance.now();
  const parsed = (await importLessons(db, userId, id, text, mode));
  return { preview: parsed, ms: Math.round(performance.now() - t0), course: (await getCourse(db, id)) };
});
