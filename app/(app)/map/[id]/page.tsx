import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { chapters, chapterState, errorItems, forgeArtifacts, lessonChapters, lessons, subjects, testLogs } from "@/db/schema";
import { requireUser } from "@/server/context";
import { clearStatus } from "@/domain/mastery";
import { formatJalali } from "@/i18n/jalali";
import { Card, Chip, Eyebrow, PageHeader, ProgressBar, StatTile } from "@/ui/components";
import { Icon } from "@/ui/icons";
import { TierOverride } from "./TierOverride";

export const metadata = { title: "Chapter" };

/** Chapter page (S05): Clear rule status, test history, errors, lessons, Forge, tier override. */
export default async function ChapterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, userId, cfg } = await requireUser();
  const ch = ((await db.select().from(chapters).where(eq(chapters.id, id)).limit(1))[0]);
  if (!ch) notFound();
  const sub = ((await db.select().from(subjects).where(eq(subjects.id, ch.subjectId)).limit(1))[0])!;
  const st = ((await db.select().from(chapterState).where(and(eq(chapterState.userId, userId), eq(chapterState.chapterId, id))).limit(1))[0]);
  const logs = (await db.select().from(testLogs).where(and(eq(testLogs.userId, userId), eq(testLogs.chapterId, id))).orderBy(desc(testLogs.loggedAt)));
  const clear = clearStatus(logs, cfg);
  const errs = (await db.select().from(errorItems).where(and(eq(errorItems.userId, userId), eq(errorItems.chapterId, id))).orderBy(desc(errorItems.createdAt)));
  const arts = (await db.select().from(forgeArtifacts).where(and(eq(forgeArtifacts.userId, userId), eq(forgeArtifacts.chapterId, id))));
  const ls = (await db.select({ id: lessons.id, no: lessons.no, title: lessons.title, status: lessons.status, min: lessons.durationMin, course: lessons.courseId }).from(lessonChapters).innerJoin(lessons, eq(lessons.id, lessonChapters.lessonId)).where(eq(lessonChapters.chapterId, id)));
  return (
    <div className="flex flex-col gap-4">
      <Link href="/map" className="text-body-s font-bold text-muted hover:text-ink">
        ← World Map
      </Link>
      <PageHeader eyebrow={`${sub.nameEn} · Chapter ${ch.no}`} title={<span className="fa normal-case" dir="rtl">{ch.title}</span>}>
        {ch.tier && <Chip tone={ch.tier === "M" ? "yellow" : ch.tier === "S" ? "mint" : "surface"}>Tier {ch.tier}{ch.tierLocked ? " (your override)" : ""}</Chip>}
        {ch.optional && <Chip>optional</Chip>}
        {st?.clearedAt && <Chip tone="lime" icon="star">Cleared {formatJalali(st.clearedAt)}</Chip>}
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-3">
        <Card tone={clear.cleared ? "yellow" : "surface"} className="flex flex-col gap-3 md:col-span-2">
          <Eyebrow>Clear rule · {cfg.clear.minSessions} spaced sessions ≥ {cfg.clear.minNetPct}% net</Eyebrow>
          <ProgressBar value={Math.min(1, (clear.cleared ? cfg.clear.minSessions : clear.passing.length) / cfg.clear.minSessions)} tone={clear.cleared ? "lime" : "purple"} label="Clear progress" />
          <p className="text-body-s font-bold">{clear.why}</p>
          <p className="text-caption opacity-70">Anti-gaming: each session needs ≥ {cfg.clear.minQuestions} questions and sessions must be ≥ {cfg.clear.minGapDays} days apart; wrong answers cost ⅓ (negative marking).</p>
        </Card>
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="a0 baseline" value={st?.a0 != null ? Math.round(st.a0 * 100) : "—"} unit={st?.a0 != null ? "%" : undefined} />
          <StatTile label="Net now" value={st?.netPct != null ? Math.round(st.netPct) : "—"} unit={st?.netPct != null ? "%" : undefined} />
          <StatTile label="Tests" value={logs.reduce((s, l) => s + l.correct + l.wrong + l.blank, 0)} />
          <StatTile label="Errors" value={errs.length} />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-2">
          <Eyebrow>Test sessions</Eyebrow>
          {logs.length === 0 && <p className="text-body-s text-muted">No tests yet — 3 tests and this node starts to glow.</p>}
          <ul className="flex flex-col gap-1 text-body-s">
            {logs.slice(0, 20).map((l) => (
              <li key={l.id} className="flex justify-between rounded-xl bg-surface-2 px-3 py-1.5">
                <span>{formatJalali(l.gameDay)}</span>
                <span>
                  {l.correct}✓ {l.wrong}✗ {l.blank}– · <b>{l.netPct}%</b>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-2">
          <Eyebrow>Errors & lessons learned</Eyebrow>
          {errs.length === 0 && <p className="text-body-s text-muted">No analysed errors on this chapter.</p>}
          <ul className="flex flex-col gap-1 text-body-s">
            {errs.slice(0, 12).map((e) => (
              <li key={e.id} className="rounded-xl bg-surface-2 px-3 py-1.5" dir="auto">
                <Chip>{e.cause}</Chip> {e.takeaway}
              </li>
            ))}
          </ul>
          <Link href="/forge" className="text-body-s font-bold text-purple-ink">
            Open the Forge →
          </Link>
        </Card>
        <Card className="flex flex-col gap-2">
          <Eyebrow>Lessons ({ls.length})</Eyebrow>
          {ls.length === 0 && <p className="text-body-s text-muted">No lessons linked. Link them from Courses.</p>}
          <ul className="flex flex-col gap-1 text-body-s">
            {ls.map((l) => (
              <li key={l.id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5">
                <Icon name={l.status === "done" ? "check" : "play"} size={14} className={l.status === "done" ? "text-lime" : "text-muted"} />
                <span className="fa flex-1" dir="auto">
                  {l.no}. {l.title}
                </span>
                <span className="text-caption text-muted">{Math.round(l.min)}m</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-3">
          <Eyebrow>Forge artifacts ({arts.length}) · Triage</Eyebrow>
          {arts.map((a) => (
            <p key={a.id} className="text-body-s font-bold">
              {a.title}
            </p>
          ))}
          <TierOverride chapterId={id} tier={ch.tier} locked={ch.tierLocked} />
        </Card>
      </div>
    </div>
  );
}
