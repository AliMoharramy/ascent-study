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
import { weekItemsFor } from "@/server/plan";
import { boardView, lootView } from "@/server/life";
import { xpSummary } from "@/events/projections";
import { addDaysIso, diffDaysIso, weekStartSaturday, WEEKDAYS_EN } from "@/i18n/jalali";
import { CAMPAIGN_DAYS, campaignDay, daysToExam, TOTAL_WEEKS, weekNoOf } from "@/lib/campaign";
import { PHASE_WEEKS, weekPhase } from "@/domain/planner";
import { comboState } from "@/domain/combo";
import { BossBar, Card, Chip, DueChip, Eyebrow, ProgressRing, ShadowGap, StatTile } from "@/ui/components";
import { MascotSlot, heroStateFor } from "@/ui/Mascot";
import { Icon } from "@/ui/icons";
import { LayeredProgress } from "@/ui/LayeredProgress";
import { TimerCard, type CoreQuest } from "./TimerCard";
import { TestLogCard } from "./TestLogCard";
import { CheckinCard } from "./CheckinCard";
import { QuestList, type QuestItem } from "./QuestList";
import { DailyBoard } from "./DailyBoard";
import { DayTools } from "./DayTools";

export const metadata = { title: "Today" };

const REALM_SUBJECTS: Record<number, string[]> = { 1: ["ai", "discrete"], 2: ["dsa", "logic"], 3: ["arch", "toc"], 4: ["os", "stats"] };

export default async function TodayPage() {
  const { db, userId, today, tz, rollover, cfg } = await requireUser();
  const subjectRows = (await db.select({ id: subjects.id, nameEn: subjects.nameEn, nameFa: subjects.nameFa, status: subjects.status }).from(subjects).orderBy(asc(subjects.sort)));
  const activeSubjects = subjectRows.filter((s) => s.status !== "dropped");
  const chapterOpts = (await db
    .select({ id: chapters.id, no: chapters.no, title: chapters.title, sub: chapters.subjectId })
    .from(chapters)
    .orderBy(asc(chapters.subjectId), asc(chapters.no)))
    .filter((c) => activeSubjects.some((s) => s.id === c.sub))
    .map((c) => ({ id: c.id, label: `${c.sub.toUpperCase()} ${c.no} · ${c.title}` }));
  const open = (await openSession(db, userId));
  const minutesToday = (await minutesForDay(db, userId, today));
  const tests = (await testsForDay(db, userId, today));
  const combo = comboState((await db.select({ correct: testLogs.correct, wrong: testLogs.wrong }).from(testLogs).where(eq(testLogs.userId, userId)).orderBy(desc(testLogs.loggedAt)).limit(50)));
  const checkin = (await getCheckin(db, userId, today));
  const xp = (await xpSummary(db, userId, today));
  const board = (await boardView(db, userId, today));
  const loot = (await lootView(db, userId, today));

  const quests = (await questsForDay(db, userId, today)).map(
    (q): QuestItem => ({ id: q.id, kind: q.kind, title: q.title, whenText: q.whenText, tiers: JSON.parse(q.tiersJson), target: JSON.parse(q.targetJson), tierDone: q.tierDone, progress: q.progress, status: q.status, habitId: q.habitId }),
  );
  const coreQ = quests.find((q) => q.kind === "core");
  const coreRow = (await questsForDay(db, userId, today)).find((q) => q.kind === "core");
  const core: CoreQuest | null = coreQ
    ? { id: coreQ.id, title: coreQ.title, tiers: coreQ.tiers, target: coreQ.target, chapterId: coreRow?.refType === "chapter" ? coreRow.refId : null, subjectId: coreRow?.refType === "chapter" && coreRow.refId ? coreRow.refId.replace(/-\d+$/, "") : null, tierDone: coreQ.tierDone, progress: coreQ.progress }
    : null;
  const daily = quests.filter((q) => (q.kind === "fixed" || q.kind === "comeback") && q.status !== "waiting");
  const pillars = quests.filter((q) => q.kind === "pillar" && q.status !== "waiting");

  // week glance
  const weekStart = weekStartSaturday(today);
  const weekRows = (await db
    .select({ day: focusSessions.gameDay, minutes: focusSessions.minutes })
    .from(focusSessions)
    .where(and(eq(focusSessions.userId, userId), gte(focusSessions.gameDay, weekStart), lte(focusSessions.gameDay, addDaysIso(weekStart, 6)))));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDaysIso(weekStart, i);
    const m = d === today ? minutesToday : weekRows.filter((r) => r.day === d).reduce((s, r) => s + (r.minutes ?? 0), 0);
    return { d, label: WEEKDAYS_EN[i]!, minutes: m, isToday: d === today };
  });
  const activeDays = week.filter((w) => w.minutes > 0).length;
  const maxMin = Math.max(60, ...week.map((w) => w.minutes));
  const weekMinutes = week.reduce((s, w) => s + w.minutes, 0);

  // goal gradient layers
  const wk = weekNoOf(today);
  const goal = (await goalView(db, userId, today));
  const plannedWeekMin = (await weekItemsFor(db, userId, wk)).reduce((s, i) => s + i.plannedMin, 0);
  const cleared = new Set((await db.select({ id: chapterState.chapterId }).from(chapterState).where(and(eq(chapterState.userId, userId), sql`${chapterState.clearedAt} IS NOT NULL`))).map((r) => r.id));
  const realm = weekPhase(Math.max(2, Math.min(19, wk))).realm ?? 1;
  const realmChapters = (await db.select({ id: chapters.id, sub: chapters.subjectId, optional: chapters.optional }).from(chapters)).filter((c) => REALM_SUBJECTS[realm]!.includes(c.sub) && !c.optional);
  const allRequired = (await queryOne<{ n: number }>(db, sql`SELECT count(*) AS n FROM chapters c JOIN subjects s ON s.id = c.subject_id WHERE s.status = 'active' AND c.optional = false AND s.mode IS NULL`))?.n ?? 1;
  const boss = (await nextBoss(db, userId, today));
  const realmEnd = PHASE_WEEKS[realm]![1];
  const layers = [
    { key: "day", label: "Day", value: goal.value, caption: `${goal.focus} / ${goal.goal.minutes} min daily goal`, tone: "lime" as const },
    { key: "week", label: "Week", value: plannedWeekMin ? Math.min(1, weekMinutes / plannedWeekMin) : activeDays / 7, caption: plannedWeekMin ? `${Math.round(weekMinutes / 6) / 10}h of ${Math.round(plannedWeekMin / 6) / 10}h planned this week` : `${activeDays} of 7 days active`, tone: "yellow" as const },
    { key: "realm", label: `Realm ${["I", "II", "III", "IV"][realm - 1]}`, value: realmChapters.filter((c) => cleared.has(c.id)).length / Math.max(1, realmChapters.length), caption: `${realmChapters.filter((c) => cleared.has(c.id)).length} of ${realmChapters.length} chapters cleared · gate at week ${realmEnd}`, tone: "mint" as const },
    { key: "campaign", label: "Campaign", value: campaignDay(today) / CAMPAIGN_DAYS, caption: `Day ${campaignDay(today)} of ${CAMPAIGN_DAYS} · ${cleared.size} of ${allRequired} chapters cleared`, tone: "purple" as const },
  ];
  const countdowns = [
    { label: "Exam", value: `${daysToExam(today)} days` },
    ...(boss ? [{ label: boss.kind === "weekly" ? "Weekly Boss" : boss.kind === "region" ? "Region Boss" : "Mini-Trial", value: `${diffDaysIso(boss.scheduledFor, today)} days` }] : []),
  ];

  // rival / safety net / open loop
  const rival = (await rivalView(db, userId, today));
  const yesterday = addDaysIso(today, -1);
  const yClose = ((await db.select().from(dayCloses).where(and(eq(dayCloses.userId, userId), eq(dayCloses.date, yesterday))).limit(1))[0]);
  const yShield = !!((await db.select({ id: shields.id }).from(shields).where(and(eq(shields.userId, userId), eq(shields.usedForDate, yesterday))).limit(1))[0]);
  const flame = (await streakBefore(db, userId, today)).flame;
  const openLoop = yClose?.missedCore && yClose.rulesActive ? "Yesterday's Core slipped. A small Comeback today closes the loop — never miss twice." : yClose?.coreTier === "seed" ? "Yesterday was a Seed day. A Standard today turns it into a streak." : null;
  const baseline = !(await rulesActive(db, userId, today));
  const restToday = (await isRestDay(db, userId, today));
  const heroState = heroStateFor({ restDay: restToday, coreTier: core?.tierDone ?? null, minutesToday, focusGoalHit: goal.focus >= goal.goal.minutes });
  const archieState = openLoop ? "warning" : tests.count ? (tests.netPct >= 45 ? "cheering" : "thinking") : "reading";
  const archieLine = openLoop ?? (tests.count ? `Today: ${Math.round(tests.netPct)}% net across ${tests.count} tests.${tests.netPct < 45 ? " 10 minutes in Forge lifts this the fastest." : " Keep the streak of clean logs."}` : "Log your first tests and I'll point at the weakest section.");

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
      {baseline && (
        <Card tone="purple" className="flex flex-wrap items-center justify-between gap-3 md:col-span-6 xl:col-span-12">
          <div>
            <Eyebrow>Ch.1 The Awakening · Baseline week</Eyebrow>
            <p className="mt-1 text-body font-bold">This week we only observe: log as you are, take ~15 scouting tests per subject. No penalties, the Shadow sleeps.</p>
          </div>
          <Link href="/baseline" className="btn bg-white text-on-color">
            Baseline report <Icon name="arrow" size={16} />
          </Link>
        </Card>
      )}

      {restToday && (
        <Card tone="purple" className="flex flex-wrap items-center justify-between gap-3 md:col-span-6 xl:col-span-12">
          <div>
            <Eyebrow>Rest Day Pass · planned</Eyebrow>
            <p className="mt-1 text-body font-bold">Today is rest: no penalties tonight and the flame is untouched. Study only if you feel like it.</p>
          </div>
          <Link href="/plan" className="btn bg-white text-on-color">
            Plan view <Icon name="arrow" size={16} />
          </Link>
        </Card>
      )}

      {(daysToExam(today) <= 7 || weekNoOf(today) === TOTAL_WEEKS) && (
        <Card tone="mint" className="flex flex-wrap items-center justify-between gap-3 md:col-span-6 xl:col-span-12">
          <div>
            <Eyebrow>Final Ascent · review only</Eyebrow>
            <p className="mt-1 text-body font-bold">The last mile: no new material, no new settings. Review your own sheets, sleep on plan, breathe when it spikes.</p>
          </div>
          <Link href="/final" className="btn bg-white text-on-color">
            Final kit & review plan <Icon name="arrow" size={16} />
          </Link>
        </Card>
      )}

      <TimerCard className="md:col-span-6 xl:col-span-7 xl:row-span-2" subjects={activeSubjects} initial={open ? view(open) : null} initialMinutesToday={minutesToday} today={today} tz={tz} rollover={rollover} core={core} heroState={heroState} mascots={cfg.flags.mascots} />

      <Card tone="mint" className="flex flex-col items-start gap-4 md:col-span-6 xl:col-span-5 sm:flex-row sm:items-center">
        <MascotSlot character="archie" state={archieState} size="md" enabled={cfg.flags.mascots} />
        <div className="min-w-0 flex-1">
          <Eyebrow>Archie · coach</Eyebrow>
          <p className="mt-1 text-body-s font-bold">{archieLine}</p>
          <Link href="/run" className="btn-ghost-on-color mt-2 w-fit px-3 py-1.5 text-caption">
            Mini-run · 12 min <Icon name="arrow" size={13} />
          </Link>
          <Link href="/study-log" className="btn-ghost-on-color mt-1 w-fit px-3 py-1.5 text-caption">
            Log study notes <Icon name="arrow" size={13} />
          </Link>
        </div>
      </Card>

      <Card tone="coral" className="flex flex-col justify-between gap-3 md:col-span-3 xl:col-span-2">
        <Eyebrow>{boss ? (boss.kind === "weekly" ? "Weekly Boss" : boss.kind === "region" ? "Region Boss" : "Mini-Trial") : "Final boss"}</Eyebrow>
        <p className="font-display text-display-l leading-none">{boss ? diffDaysIso(boss.scheduledFor, today) : daysToExam(today)}</p>
        <p className="text-body-s font-extrabold">{boss ? `days · ${JSON.parse(boss.specJson).questions} tests · ${JSON.parse(boss.specJson).minutes} min` : "days to the Summit · 16 Ordibehesht"}</p>
        {boss && <BossBar hp={100} label={`Threshold ${boss.thresholdPct ?? "—"}%`} />}
        <Link href="/arena" className="text-body-s font-extrabold underline">
          Arena →
        </Link>
      </Card>

      <Card tone="purple" className="flex flex-col gap-3 md:col-span-3 xl:col-span-3" aria-label="Shadow">
        <Eyebrow>The Shadow</Eyebrow>
        {rival.enabled ? (
          <>
            <ShadowGap you={rival.current.userMp} shadow={rival.current.shadowMp} />
            <p className="text-caption opacity-80">{rival.current.why}</p>
          </>
        ) : (
          <p className="text-body-s font-bold">{rival.reason}</p>
        )}
      </Card>

      <QuestList quests={daily} title="Daily" className="md:col-span-3 xl:col-span-5" />

      <TestLogCard className="md:col-span-3 xl:col-span-4" subjects={activeSubjects} initialDay={{ count: tests.count, netPct: tests.netPct, totals: tests.totals }} recent={tests.rows.slice(0, 4)} initialCombo={combo.current} chapters={chapterOpts} defaultChapter={core?.chapterId} />

      <QuestList quests={pillars} title="Pillars" className="md:col-span-3 xl:col-span-4" />

      <LayeredProgress layers={layers} countdowns={countdowns} className="md:col-span-3 xl:col-span-4" />

      <DailyBoard board={board} loot={loot} />

      <Card className="flex flex-col gap-4 md:col-span-3 xl:col-span-4" aria-label="Week at a glance">
        <div className="flex items-center justify-between">
          <div>
            <Eyebrow>Week {wk} glance</Eyebrow>
            <p className="mt-1 font-display text-display-m leading-none">
              {Math.floor(weekMinutes / 60)}h {weekMinutes % 60}m
            </p>
          </div>
          <ProgressRing value={activeDays / 7} tone="lime" label={`${activeDays} of 7 days active`}>
            {activeDays}/7
          </ProgressRing>
        </div>
        <div className="flex h-24 items-end justify-between gap-1.5" role="img" aria-label="Focus minutes per day this week">
          {week.map((w) => (
            <div key={w.d} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-16 w-full items-end">
                <div className={w.isToday ? "w-full rounded-lg bg-yellow" : "w-full rounded-lg bg-purple/70"} style={{ height: `${Math.max(4, Math.round((w.minutes / maxMin) * 64))}px` }} title={`${w.minutes} min`} />
              </div>
              <span className={w.isToday ? "text-caption font-extrabold text-yellow-ink" : "text-caption text-muted"}>{w.label}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-col gap-4 md:col-span-3 xl:col-span-4">
        {openLoop && (
          <Card tone="yellow" className="flex flex-col gap-2">
            <Eyebrow>Open loop</Eyebrow>
            <p className="text-body-s font-bold">{openLoop}</p>
          </Card>
        )}
        <DayTools shields={(await availableShields(db, userId)).length} flame={flame} yesterday={yesterday} yesterdayPenalty={yClose?.penaltyTotal ?? 0} today={today} yesterdayShielded={yShield} />
      </div>

      <CheckinCard className="md:col-span-6 xl:col-span-7" initial={checkin} today={today} />

      <Card tone="mint" className="flex flex-col gap-3 md:col-span-6 xl:col-span-5">
        <Eyebrow>Today in numbers</Eyebrow>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="XP" value={xp.todayXp} tone="surface" />
          <StatTile label="Focus" value={minutesToday} unit="min" tone="surface" />
          <StatTile label="Net" value={tests.count ? `${Math.round(tests.netPct)}` : "—"} unit={tests.count ? "%" : undefined} tone="surface" />
        </div>
        <div className="flex flex-wrap gap-2">
          <DueChip>Nightly review tonight</DueChip>
          <Chip tone="dark" icon="keyboard">
            Press ? for shortcuts
          </Chip>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/review" className="btn-primary">
            Nightly review (2 min) <Icon name="arrow" size={16} />
          </Link>
          <Link href="/deck" className="btn-ghost-on-color">
            Five-minute deck <Icon name="arrow" size={16} />
          </Link>
        </div>
      </Card>
    </div>
  );
}
