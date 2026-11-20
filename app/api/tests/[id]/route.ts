import { ApiError, api } from "@/server/http";
import { deleteTestLog } from "@/server/tests";

export const DELETE = api(async ({ db, userId, params }) => {
  const { id } = await params;
  if (!id || !(await deleteTestLog(db, userId, id))) throw new ApiError(404, "not_found", "Test log not found");
  return { ok: true };
});
