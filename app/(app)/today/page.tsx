import { queryOne } from "@/db/client";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import Link from "next/link";
import { chapters, chapterState, dayCloses, focusSessions, shields, subjects, testLogs } from "@/db/schema";
import { requireUser } from "@/server/context";
import { minutesForDay, openSession, view } from "@/server/focus";
import { testsForDay } from "@/server/tests";
import { getCheckin } from "@/server/checkins";
import { questsForDay, rulesActive, availableShields, streakBefore } from "@/server/quests";
import { isRestDay } from "@/server/restDays";
import { nextBoss, rivalView } from "@/server/arena";
import { goalView } from "@/server/reviews";
import { dueCardSummary } from "@/server/forge";
import { dueStudyLogReviewSummary } from "@/server/studyLogs";
import { weekItemsFor } from "@/server/plan";
import { boardView, lootView } from "@/server/life";
import { xpSummary } from "@/events/projections";
import { addDaysIso, diffDaysIso, weekStartSaturday } from "@/i18n/jalali";
import { CAMPAIGN_DAYS, campaignDay, daysToExam, TOTAL_WEEKS, weekNoOf } from "@/lib/campaign";
import { PHASE_WEEKS, weekPhase } from "@/domain/planner";
import { comboState } from "@/domain/combo";
import { Card, Chip, Eyebrow, PageHeader, ProgressBar, ShadowGap } from "@/ui/components";
import { MascotSlot, heroStateFor } from "@/ui/Mascot";
import { Icon } from "@/ui/icons";
import { LayeredProgress } from "@/ui/LayeredProgress";
import { TimerCard, type CoreQuest } from "./TimerCard";
import { TestLogCard } from "./TestLogCard";
import { CheckinCard } from "./CheckinCard";
import { QuestList, type QuestItem } from "./QuestList";
import { DailyBoard } from "./DailyBoard";
import { DayTools } from "./DayTools";
import { CoreMission } from "./CoreMission";
import { LearningQueue } from "./LearningQueue";
import { QuickActions } from "./QuickActions";

export const metadata = { title: "Today" };

const REALM_SUBJECTS: Record<number, string[]> = { 1: ["ai", "discrete"], 2: ["dsa", "logic"], 3: ["arch", "toc"], 4: ["os", "stats"] };

type ModeNotice = { label: string; text: string; href: string; action: string; tone: "purple" | "yellow" | "mint" };

function daysAway(days: number) {
  return days <= 0 ? "Today" : `In ${days} days`;
}

export default async function TodayPage() {
  const { db, userId, today, cfg } = await requireUser();
  const [subjectRows, chapterRows] = await Promise.all([
    db.select({ id: subjects.id, nameEn: subjects.nameEn, nameFa: subjects.nameFa, status: subjects.status }).from(subjects).orderBy(asc(subjects.sort)),
    db.select({ id: chapters.id, no: chapters.no, title: chapters.title, sub: chapters.subjectId }).from(chapters).orderBy(asc(chapters.subjectId), asc(chapters.no)),
  ]);
  const activeSubjects = subjectRows.filter((subject) => subject.status !== "dropped");
  const chapterOpts = chapterRows
    .filter((chapter) => activeSubjects.some((subject) => subject.id === chapter.sub))
    .map((chapter) => ({ id: chapter.id, label: `${chapter.sub.toUpperCase()} ${chapter.no} · ${chapter.title}` }));

  const [open, minutesToday, tests, recentLogs, checkin, xp, board, loot, questRows, goal, adaptive, fixed] = await Promise.all([
    openSession(db, userId),
    minutesForDay(db, userId, today),
    testsForDay(db, userId, today),
    db.select({ correct: testLogs.correct, wrong: testLogs.wrong }).from(testLogs).where(eq(testLogs.userId, userId)).orderBy(desc(testLogs.loggedAt)).limit(50),
    getCheckin(db, userId, today),
    xpSummary(db, userId, today),
    boardView(db, userId, today),
    lootView(db, userId, today),
    questsForDay(db, userId, today),
    goalView(db, userId, today),
    dueCardSummary(db, userId, today, 3),
    dueStudyLogReviewSummary(db, userId, today, 3),
  ]);
  const combo = comboState(recentLogs);

  const quests = questRows.map((quest): QuestItem => ({
    id: quest.id,
    kind: quest.kind,
    title: quest.title,
    whenText: quest.whenText,
    tiers: JSON.parse(quest.tiersJson),
    target: JSON.parse(quest.targetJson),
    tierDone: quest.tierDone,
    progress: quest.progress,
    status: quest.status,
    habitId: quest.habitId,
  }));
  const coreQ = quests.find((quest) => quest.kind === "core");
  const coreRow = questRows.find((quest) => quest.kind === "core");
  const core: CoreQuest | null = coreQ && coreRow
    ? {
        id: coreQ.id,
        title: coreQ.title,
        tiers: coreQ.tiers,
        target: coreQ.target,
        chapterId: coreRow.refType === "chapter" ? coreRow.refId : null,
        subjectId: coreRow.refType === "chapter" && coreRow.refId ? coreRow.refId.replace(/-\d+$/, "") : null,
        tierDone: coreQ.tierDone,
        progress: coreQ.progress,
      }
    : null;
  const daily = quests.filter((quest) => (quest.kind === "fixed" || quest.kind === "comeback") && quest.status !== "waiting");
  const pillars = quests.filter((quest) => quest.kind === "pillar" && quest.status !== "waiting");
  const questionsToday = tests.totals.correct + tests.totals.wrong + tests.totals.blank;

  const weekStart = weekStartSaturday(today);
  const weekRows = await db.select({ day: focusSessions.gameDay, minutes: focusSessions.minutes })
    .from(focusSessions)
    .where(and(eq(focusSessions.userId, userId), gte(focusSessions.gameDay, weekStart), lte(focusSessions.gameDay, addDaysIso(weekStart, 6))));
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = addDaysIso(weekStart, index);
    const minutes = day === today
      ? minutesToday
      : weekRows.filter((row) => row.day === day).reduce((sum, row) => sum + (row.minutes ?? 0), 0);
    return { day, minutes };
  });
  const activeDays = week.filter((day) => day.minutes > 0).length;
  const weekMinutes = week.reduce((sum, day) => sum + day.minutes, 0);

  const weekNo = weekNoOf(today);
  const plannedWeekMin = (await weekItemsFor(db, userId, weekNo)).reduce((sum, item) => sum + item.plannedMin, 0);
  const cleared = new Set((await db.select({ id: chapterState.chapterId }).from(chapterState).where(and(eq(chapterState.userId, userId), sql`${chapterState.clearedAt} IS NOT NULL`))).map((row) => row.id));
  const realm = weekPhase(Math.max(2, Math.min(19, weekNo))).realm ?? 1;
  const realmChapters = (await db.select({ id: chapters.id, sub: chapters.subjectId, optional: chapters.optional }).from(chapters))
    .filter((chapter) => REALM_SUBJECTS[realm]!.includes(chapter.sub) && !chapter.optional);
  const allRequired = (await queryOne<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM chapters c JOIN subjects s ON s.id = c.subject_id WHERE s.status = 'active' AND c.optional = false AND s.mode IS NULL`))?.n ?? 1;
  const realmCleared = realmChapters.filter((chapter) => cleared.has(chapter.id)).length;
  const boss = await nextBoss(db, userId, today);
  const layers = [
    { key: "week", label: "Week", value: plannedWeekMin ? Math.min(1, weekMinutes / plannedWeekMin) : activeDays / 7, caption: plannedWeekMin ? `${Math.round(weekMinutes / 6) / 10}h of ${Math.round(plannedWeekMin / 6) / 10}h planned this week` : `${activeDays} of 7 days active`, tone: "yellow" as const },
    { key: "realm", label: `Realm ${["I", "II", "III", "IV"][realm - 1]}`, value: realmCleared / Math.max(1, realmChapters.length), caption: `${realmCleared} of ${realmChapters.length} required chapters cleared · gate at week ${PHASE_WEEKS[realm]![1]}`, tone: "mint" as const },
    { key: "campaign", label: "Campaign", value: campaignDay(today) / CAMPAIGN_DAYS, caption: `Day ${campaignDay(today)} of ${CAMPAIGN_DAYS} elapsed · ${cleared.size} of ${allRequired} required chapters cleared`, tone: "purple" as const },
  ];

  const rival = await rivalView(db, userId, today);
  const yesterday = addDaysIso(today, -1);
  const [yClose, yShield, flame, shieldRows, baseline, restToday] = await Promise.all([
    db.select().from(dayCloses).where(and(eq(dayCloses.userId, userId), eq(dayCloses.date, yesterday))).limit(1).then((rows) => rows[0]),
    db.select({ id: shields.id }).from(shields).where(and(eq(shields.userId, userId), eq(shields.usedForDate, yesterday))).limit(1).then((rows) => rows[0]),
    streakBefore(db, userId, today).then((streak) => streak.flame),
    availableShields(db, userId),
    rulesActive(db, userId, today).then((active) => !active),
    isRestDay(db, userId, today),
  ]);
  const openLoop = yClose?.missedCore && yClose.rulesActive
    ? "Yesterday's Core slipped. A small Comeback today closes the loop — never miss twice."
    : yClose?.coreTier === "seed"
      ? "Yesterday was a Seed day. A Standard today turns it into a streak."
      : null;
  const finalAscent = daysToExam(today) <= 7 || weekNoOf(today) === TOTAL_WEEKS;
  const modeNotices: ModeNotice[] = [];
  if (baseline) modeNotices.push({ label: "Baseline week", text: "Observe and log your study; penalties are off during Baseline.", href: "/baseline", action: "Baseline report", tone: "purple" });
  if (restToday) modeNotices.push({ label: "Rest Day", text: "No penalties today and your Flame stays untouched.", href: "/plan", action: "Plan view", tone: "yellow" });
  if (finalAscent) modeNotices.push({ label: "Final Ascent", text: "Review only: skip new material and use the exam plan.", href: "/final", action: "Final kit", tone: "mint" });

  const heroState = heroStateFor({ restDay: restToday, coreTier: core?.tierDone ?? null, minutesToday, focusGoalHit: goal.focus >= goal.goal.minutes });
  const archieState = openLoop ? "warning" : tests.count ? (tests.netPct >= 45 ? "cheering" : "thinking") : "reading";
  const archieLine = openLoop ?? (tests.count
    ? `Today: ${Math.round(tests.netPct)}% net across ${tests.count} tests.${tests.netPct < 45 ? " 10 minutes in Forge lifts this the fastest." : " Keep the streak of clean logs."}`
    : "Log your first tests and I'll point at the weakest section.");
  const rewardSummary = board.claimed ? "Claimed today" : board.allDone ? "Claim ready" : "Quest Board";

  return (
    <div className="today-command-grid">
      <div className="today-heading">
        <PageHeader eyebrow="Your study day" title="Today" />
      </div>

      <section className="today-overview rounded-card border border-line bg-surface-1 p-4 shadow-card" aria-label="Daily overview">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <Eyebrow>Daily overview</Eyebrow>
          <p className="text-caption text-muted">Recorded progress · questions · reviews · XP</p>
        </div>
        <div className="grid grid-cols-2 gap-y-4 md:grid-cols-4 md:gap-y-0">
          <div className="min-w-0 pe-3">
            <p className="text-caption font-extrabold uppercase tracking-wider text-muted">Recorded focus / goal</p>
            <p className="mt-1 font-display text-title-m leading-none">{goal.focus} <span className="font-body text-body-s font-extrabold text-muted">/ {goal.goal.minutes} min</span></p>
            <ProgressBar value={goal.focus / Math.max(1, goal.goal.minutes)} tone="lime" label={`Recorded focus ${goal.focus} of configured daily goal ${goal.goal.minutes} minutes`} className="mt-2 h-2" />
          </div>
          <div className="min-w-0 border-s border-line ps-3 pe-3">
            <p className="text-caption font-extrabold uppercase tracking-wider text-muted">Questions logged</p>
            <p className="mt-1 font-display text-title-m leading-none">{questionsToday}</p>
          </div>
          <div className="min-w-0 border-s border-line ps-3 pe-3">
            <p className="text-caption font-extrabold uppercase tracking-wider text-muted">Due reviews</p>
            <p className="mt-1 font-display text-title-m leading-none">{adaptive.count + fixed.count}</p>
            <p className="mt-1 text-caption text-muted">Forge {adaptive.count} · Study Log {fixed.count}</p>
          </div>
          <div className="min-w-0 border-s border-line ps-3">
            <p className="text-caption font-extrabold uppercase tracking-wider text-muted">Daily XP</p>
            <p className="mt-1 font-display text-title-m leading-none">{xp.todayXp}</p>
          </div>
        </div>
      </section>

      {modeNotices.length > 0 && (
        <aside className="today-mode rounded-2xl border border-line bg-surface-1 p-4" aria-label="Today's study context">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow>Today&apos;s mode</Eyebrow>
              {modeNotices.map((notice) => <Chip key={notice.label} tone={notice.tone}>{notice.label}</Chip>)}
            </div>
            <div className="flex flex-wrap gap-2">
              {modeNotices.map((notice) => <Link key={notice.href} href={notice.href} className="btn-ghost min-h-10 px-3 text-caption">{notice.action}<Icon name="arrow" size={13} /></Link>)}
            </div>
          </div>
          <ul className="mt-2 grid gap-1 text-body-s text-muted sm:grid-cols-2 xl:grid-cols-3">
            {modeNotices.map((notice) => <li key={notice.label}>{notice.text}</li>)}
          </ul>
        </aside>
      )}

      <div className="today-core"><CoreMission core={core} /></div>
      <div className="today-focus">
        <TimerCard className="h-full" subjects={activeSubjects} initial={open ? view(open) : null} core={core} heroState={heroState} mascots={cfg.flags.mascots} />
      </div>

      <div className="today-actions">
        <QuickActions
          today={today}
          testLog={<TestLogCard className="w-full" subjects={activeSubjects} initialDay={{ count: tests.count, netPct: tests.netPct, totals: tests.totals }} recent={tests.rows.slice(0, 4)} initialCombo={combo.current} chapters={chapterOpts} defaultChapter={core?.chapterId} />}
        />
      </div>

      <section className="today-agenda card flex flex-col gap-4" aria-labelledby="today-agenda-title">
        <div>
          <Eyebrow>Today&apos;s plan</Eyebrow>
          <h2 id="today-agenda-title" className="mt-1 font-display text-title-l uppercase">Daily agenda</h2>
        </div>
        {openLoop && <p className="rounded-xl bg-yellow/15 px-3 py-2 text-body-s font-bold text-yellow-ink">{openLoop}</p>}
        <QuestList quests={daily} title="Daily quests" compact />
        <QuestList quests={pillars} title="Pillar quests" compact />
      </section>

      <div className="today-queue"><LearningQueue adaptive={adaptive} fixed={fixed} today={today} /></div>
      <div className="today-progress"><LayeredProgress layers={layers} countdowns={[]} className="h-full" /></div>

      <Card className="today-challenge flex flex-col gap-3" aria-label="Upcoming challenges">
        <div>
          <Eyebrow>Up next</Eyebrow>
          <h2 className="mt-1 font-display text-title-l uppercase">Challenges</h2>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-extrabold">Final exam</h3>
            <span className="font-display text-title-m">{daysAway(daysToExam(today))}</span>
          </div>
          <Link href={finalAscent ? "/final" : "/arena/exam"} className="btn-ghost mt-2 min-h-10 px-3 text-caption">{finalAscent ? "Open final kit" : "Exam plan"}<Icon name="arrow" size={13} /></Link>
        </div>
        {boss ? (
          <div className="rounded-2xl bg-surface-2 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-extrabold">{boss.kind === "weekly" ? "Weekly Boss" : boss.kind === "region" ? "Region Boss" : "Mini-Trial"}</h3>
              <span className="text-body-s font-extrabold">{daysAway(diffDaysIso(boss.scheduledFor, today))}</span>
            </div>
            <p className="mt-1 text-caption text-muted">{JSON.parse(boss.specJson).questions} tests · {JSON.parse(boss.specJson).minutes} min{boss.thresholdPct == null ? "" : ` · ${boss.thresholdPct}% threshold`}</p>
            <Link href="/arena" className="btn-ghost mt-2 min-h-10 px-3 text-caption">Open Arena<Icon name="arrow" size={13} /></Link>
          </div>
        ) : (
          <p className="text-body-s text-muted">No boss is scheduled next. Your exam plan is still available above.</p>
        )}
      </Card>

      <Card tone="mint" className="today-coach grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 md:flex md:flex-wrap" aria-label="Archie coach">
        <MascotSlot character="archie" state={archieState} size="sm" enabled={cfg.flags.mascots} />
        <div className="min-w-0 flex-1">
          <Eyebrow>Archie · coach</Eyebrow>
          <p className="mt-1 break-words text-body-s font-bold" dir="auto">{archieLine}</p>
        </div>
        <Link href="/run" className="btn-ghost-on-color col-span-2 min-h-11 w-fit px-4 md:ms-auto md:col-span-1">Mini-run · 12 min<Icon name="arrow" size={14} /></Link>
      </Card>

      <details className="today-rewards rounded-card border border-line bg-surface-1 p-4 shadow-card">
        <summary className="flex min-h-12 cursor-pointer flex-wrap items-center justify-between gap-3">
          <div>
            <Eyebrow>Rewards</Eyebrow>
            <h2 className="mt-1 font-display text-title-l uppercase">Quest Board &amp; Vault</h2>
          </div>
          <Chip tone={board.claimed ? "purple" : board.allDone ? "lime" : "surface"}>{rewardSummary}{loot.today && !board.claimed ? " · Vault ready" : ""}</Chip>
        </summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <DailyBoard board={board} loot={loot} />
        </div>
      </details>

      <details className="today-safety rounded-card border border-line bg-surface-1 p-4 shadow-card">
        <summary className="flex min-h-12 cursor-pointer flex-wrap items-center justify-between gap-3">
          <div>
            <Eyebrow>Support when needed</Eyebrow>
            <h2 className="mt-1 font-display text-title-l uppercase">Safety tools &amp; Shadow</h2>
          </div>
          <Chip tone="surface">{shieldRows.length} Shields · Flame {flame}</Chip>
        </summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <DayTools shields={shieldRows.length} flame={flame} yesterday={yesterday} yesterdayPenalty={yClose?.penaltyTotal ?? 0} yesterdayShielded={!!yShield} />
          <Card tone="purple" className="flex flex-col gap-3" aria-label="The Shadow">
            <Eyebrow>The Shadow</Eyebrow>
            {rival.enabled ? (
              <>
                <ShadowGap you={rival.current.userMp} shadow={rival.current.shadowMp} />
                <p className="text-caption opacity-80">{rival.current.why}</p>
              </>
            ) : <p className="text-body-s font-bold">{rival.reason}</p>}
          </Card>
        </div>
      </details>

      <details className="today-close rounded-card border border-line bg-surface-1 p-4 shadow-card">
        <summary className="flex min-h-12 cursor-pointer flex-wrap items-center justify-between gap-3">
          <div>
            <Eyebrow>Close your day</Eyebrow>
            <h2 className="mt-1 font-display text-title-l uppercase">Check-in &amp; nightly review</h2>
          </div>
          <Chip tone={checkin ? "lime" : "surface"}>{checkin ? "Check-in saved" : "Check-in available"}</Chip>
        </summary>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <CheckinCard initial={checkin} today={today} />
          <Card className="flex flex-col gap-3">
            <Eyebrow>Nightly review</Eyebrow>
            <h3 className="font-display text-title-m uppercase">A short look back</h3>
            <p className="text-body-s text-muted">The check-in and nightly review save separately. Both stay available at any time.</p>
            <div className="mt-auto flex flex-wrap gap-2">
              <Link href="/review" className="btn-primary min-h-11">Open nightly review<Icon name="arrow" size={15} /></Link>
              <Link href="/deck" className="btn-ghost min-h-11">Five-minute deck<Icon name="arrow" size={15} /></Link>
            </div>
            <Chip tone="dark" icon="keyboard">Press ? for shortcuts</Chip>
          </Card>
        </div>
      </details>
    </div>
  );
}
