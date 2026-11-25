import { z } from "zod";
import { api, body } from "@/server/http";
import { setLessonChapters, setLessonStatus } from "@/server/courses";

const input = z.object({
  status: z.enum(["todo", "watching", "done"]).optional(),
  chapterIds: z.array(z.string().max(60)).max(20).optional(),
  clientRequestId: z.string().min(1).max(80).optional(),
});

export const PATCH = api(async ({ db, userId, params, req }) => {
  const { id } = await params;
  const b = input.parse(await body(req));
  if (b.status) (await setLessonStatus(db, userId, id!, b.status, b.clientRequestId));
  const chapterIds = b.chapterIds ? (await setLessonChapters(db, userId, id!, b.chapterIds)) : undefined;
  return { ok: true, chapterIds };
});
