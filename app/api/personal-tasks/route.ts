import { api, body } from "@/server/http";
import { createPersonalTask, listPersonalTasks } from "@/server/personalTasks";

export const GET = api(async ({ db, userId }) => ({ tasks: await listPersonalTasks(db, userId) }));

export const POST = api(async ({ db, userId, req }) => ({ task: await createPersonalTask(db, userId, await body(req)) }));
