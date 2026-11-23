import { api, body } from "@/server/http";
import { updatePersonalTask } from "@/server/personalTasks";

export const PATCH = api(async ({ db, userId, params, req }) => {
  const { id } = await params;
  return { task: await updatePersonalTask(db, userId, id!, await body(req)) };
});
