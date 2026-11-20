import { ApiError, api, body } from "@/server/http";
import { deleteCourse, getCourse, updateCourse } from "@/server/courses";

export const GET = api(async ({ db, params }) => {
  const { id } = await params;
  const c = id ? (await getCourse(db, id)) : null;
  if (!c) throw new ApiError(404, "not_found", "Course not found");
  return c;
});

export const PATCH = api(async ({ db, userId, params, req }) => {
  const { id } = await params;
  if (!id || !(await getCourse(db, id))) throw new ApiError(404, "not_found", "Course not found");
  (await updateCourse(db, userId, id, await body(req)));
  return (await getCourse(db, id));
});

export const DELETE = api(async ({ db, userId, params }) => {
  const { id } = await params;
  if (!id || !(await getCourse(db, id))) throw new ApiError(404, "not_found", "Course not found");
  (await deleteCourse(db, userId, id));
  return { ok: true };
});
