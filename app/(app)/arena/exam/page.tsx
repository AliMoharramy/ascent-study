import { asc } from "drizzle-orm";
import { subjects } from "@/db/schema";
import { requireUser } from "@/server/context";
import { listMocks } from "@/server/arena";
import { PageHeader } from "@/ui/components";
import { ExamSimulator } from "./ExamSimulator";

export const metadata = { title: "Exam simulator" };

/** Timed mock exam (F-LRN-01): answer sheet + clock + exact net; questions stay in your own test bank. */
export default async function ExamPage() {
  const { db, userId } = await requireUser();
  const mocks = (await listMocks(db, userId)).map((m) => ({
    no: m.no,
    dateJalali: m.dateJalali,
    questions: m.questions,
    minutes: m.minutes,
    budget: m.budget,
    results: m.results.map((r) => ({ id: r.id, netPct: r.netPct, netPctNoSkip: r.netPctNoSkip, gameDay: r.gameDay })),
  }));
  const subs = (await db
    .select({ id: subjects.id, en: subjects.nameEn, status: subjects.status })
    .from(subjects)
    .orderBy(asc(subjects.sort)))
    .map((s) => ({ id: s.id, name: s.en, skipped: s.status === "dropped" }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Ch.4 · The Arena · Mock exam" title="Exam simulator">
        <span className="chip bg-surface-1 text-ink">Real clock · answer sheet · negative marking</span>
        <span className="chip bg-yellow text-on-color">No question storage</span>
      </PageHeader>
      <ExamSimulator mocks={mocks} subjects={subs} />
    </div>
  );
}
