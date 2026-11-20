import { api, body } from "@/server/http";
import { createCourse, listCourses } from "@/server/courses";

export const GET = api(async ({ db, req }) => ({ courses: (await listCourses(db, new URL(req.url).searchParams.get("subject") ?? undefined)) }));

export const POST = api(async ({ db, userId, req }) => ({ id: (await createCourse(db, userId, await body(req))) }));
