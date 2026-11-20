import Link from "next/link";
import { asc } from "drizzle-orm";
import { subjects } from "@/db/schema";
import { requireUser } from "@/server/context";
import { listCourses, watchMinutes } from "@/server/courses";
import { listTestSources } from "@/server/reference";
import { formatHours } from "@/domain/lessonParse";
import { Chip, cx, ProgressBar, SectionTitle } from "@/ui/components";
import { Icon } from "@/ui/icons";
import { NewCourseButton } from "./NewCourse";
import { TestSources } from "./TestSources";
import { LearningClient } from "./LearningClient";
import { interleaveView, masteryView } from "@/server/learning";

export const metadata = { title: "Courses" };

const tones = ["bg-yellow", "bg-mint", "bg-coral", "bg-purple text-white", "bg-lime"];

export default async function CoursesPage() {
  const { db, userId, today } = await requireUser();
  const subs = (await db.select().from(subjects).orderBy(asc(subjects.sort))).filter((s) => s.status !== "dropped");
  const courses = (await listCourses(db));
  const sources = (await listTestSources(db));
  return (
    <div>
      <SectionTitle action={<NewCourseButton subjects={subs.map((s) => ({ id: s.id, nameEn: s.nameEn }))} />}>Courses</SectionTitle>
      <div className="mb-6">
        <LearningClient mastery={(await masteryView(db, userId))} interleave={(await interleaveView(db, userId, today))} />
      </div>
      <div className="grid gap-6">
        {subs.map((s, i) => {
          const cs = courses.filter((c) => c.subjectId === s.id);
          const ts = sources.filter((t) => t.subjectId === s.id);
          if (cs.length === 0 && ts.length === 0) return null;
          return (
            <section key={s.id} aria-label={s.nameEn}>
              <div className="mb-2 flex items-baseline gap-3">
                <h3 className="font-display text-title-l uppercase">{s.nameEn}</h3>
                <span className="fa text-body-s text-muted" lang="fa">
                  {s.nameFa}
                </span>
              </div>
              <TestSources sources={ts} />
              <div className="grid gap-3 md:grid-cols-2">
                {cs.map((c) => {
                  const total = c.totalMin || 0;
                  const watch = watchMinutes(total, c.speed);
                  return (
                    <Link key={c.id} href={`/courses/${c.id}`} className={cx("card-color group flex flex-col gap-3 text-on-color transition hover:-translate-y-0.5", tones[i % tones.length])}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-caption font-extrabold uppercase tracking-widest opacity-70">{c.kind === "teaching" ? "Teaching" : "Tips & tests"}</p>
                          <p className="fa mt-1 text-title-m font-bold" lang="fa" dir="rtl">
                            {c.title}
                          </p>
                          <p className="text-body-s opacity-80">{[c.instructor, c.platform].filter(Boolean).join(" · ") || "Instructor unknown"}</p>
                        </div>
                        <span className="grid h-10 w-10 place-items-center rounded-full bg-on-color text-white transition group-hover:translate-x-0.5">
                          <Icon name="arrow" size={18} />
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {c.estimated ? (
                          <Chip tone="dark">Estimate {c.estHoursMin}–{c.estHoursMax} h · needs lesson list</Chip>
                        ) : (
                          <>
                            <Chip tone="dark">{c.lessonCount || c.sessions} lessons</Chip>
                            <Chip tone="dark">{formatHours(total)} @1×</Chip>
                            <Chip tone="dark">{formatHours(watch)} @{c.speed}×</Chip>
                          </>
                        )}
                      </div>
                      {c.lessonCount > 0 && (
                        <div className="flex items-center gap-3">
                          <ProgressBar value={c.doneMin / Math.max(1, total)} tone="surface" track="dark" className="[&>div]:bg-on-color" label="Watched" />
                          <span className="text-caption font-extrabold">
                            {c.doneCount}/{c.lessonCount}
                          </span>
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
