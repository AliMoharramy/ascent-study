import { z } from "zod";
import { api } from "@/server/http";
import { getStudyLog } from "@/server/studyLogs";

export const GET = api(async ({ db, userId, params }) => {
  const id = z.string().min(1).parse((await params).id);
  return await getStudyLog(db, userId, id);
});
