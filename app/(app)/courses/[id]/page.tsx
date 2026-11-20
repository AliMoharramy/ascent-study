import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { chapters } from "@/db/schema";
import { requireUser } from "@/server/context";
import { getCourse } from "@/server/courses";
import { CourseDetail } from "./CourseDetail";

export const metadata = { title: "Course" };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await requireUser();
  const data = (await getCourse(db, id));
  if (!data) notFound();
  const chs = (await db.select({ id: chapters.id, no: chapters.no, title: chapters.title }).from(chapters).where(eq(chapters.subjectId, data.course.subjectId)).orderBy(asc(chapters.no)));
  return <CourseDetail course={data.course} lessons={data.lessons} chapters={chs} />;
}
