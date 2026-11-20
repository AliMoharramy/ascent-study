import { requireUser } from "@/server/context";
import { councilData, getNightly, goalView, monthlyReviewView, reviewRoundsView } from "@/server/reviews";
import { monthlyView } from "@/server/life";
import { ensurePlan } from "@/server/plan";
import { nextBoss } from "@/server/arena";
import { aiCallLog, aiStatus, anomalyAlerts } from "@/server/ai";
import { wrappedView } from "@/server/wrapped";
import { experimentsView } from "@/server/experiments";
import { weekNoOf } from "@/lib/campaign";
import { cx, PageHeader } from "@/ui/components";
import { MascotSlot } from "@/ui/Mascot";
import { MonthlyReview, NightlyReview, ReviewRounds, WeeklyCouncil } from "./ReviewClient";
import { CoachClient } from "./CoachClient";
import { WrappedClient } from "./WrappedClient";
import { LabClient } from "./LabClient";

export const metadata = { title: "Review" };
export const maxDuration = 60;

const TABS = [
  { key: "nightly", label: "Nightly" },
  { key: "council", label: "Weekly Council" },
  { key: "rounds", label: "Review rounds" },
  { key: "monthly", label: "Monthly" },
  { key: "lab", label: "Experiment Lab" },
  { key: "coach", label: "AI Coach" },
  { key: "wrapped", label: "Wrapped" },
] as const;

/** Review rituals: Nightly (#42), Weekly Council (#56), TOC ×3 rounds + monthly review + Spark pattern (#81), AI coach (#92–#94), Wrapped (#98). */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: raw } = await searchParams;
  const tab = TABS.some((t) => t.key === raw) ? (raw as (typeof TABS)[number]["key"]) : "nightly";
  const { db, userId, today, cfg } = await requireUser();
  (await ensurePlan(db, userId, today, cfg));
  const n = (await getNightly(db, userId, today));
  const c = (await councilData(db, userId, today));
  const boss = (await nextBoss(db, userId, today));
  const g = (await goalView(db, userId, today));
  const m = (await monthlyReviewView(db, userId, today));
  const theme = (await monthlyView(db, userId, today));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Reflection" title={TABS.find((t) => t.key === tab)!.label}>
        <nav aria-label="Review sections" className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <a key={t.key} href={`/review${t.key === "nightly" ? "" : `?tab=${t.key}`}`} aria-current={t.key === tab ? "page" : undefined} className={cx("chip py-2", t.key === tab ? "bg-purple text-white" : "border border-line bg-surface-1 text-ink")}>
              {t.label}
            </a>
          ))}
        </nav>
        <MascotSlot character="archie" state="reviewing" size="xs" enabled={cfg.flags.mascots} />
      </PageHeader>
      {tab === "council" && <WeeklyCouncil data={c} nextBoss={boss ? { title: JSON.parse(boss.specJson).title as string, date: boss.scheduledFor, questions: JSON.parse(boss.specJson).questions as number } : null} />}
      {tab === "rounds" && <ReviewRounds data={(await reviewRoundsView(db, userId, today))} today={today} />}
      {tab === "monthly" && <MonthlyReview data={m} theme={theme} />}
      {tab === "lab" && <LabClient data={(await experimentsView(db, userId, today))} />}
      {tab === "coach" && <CoachClient status={(await aiStatus(db, userId, today))} log={(await aiCallLog(db, userId))} anomalies={await anomalyAlerts(db, userId, today)} />}
      {tab === "wrapped" && <WrappedClient initial={(await wrappedView(db, userId, today))} currentWeek={weekNoOf(today)} />}
      {tab === "nightly" && (
        <NightlyReview
          quests={n.quests.filter((q) => q.status !== "waiting").map((q) => ({ id: q.id, kind: q.kind, title: q.title, tierDone: q.tierDone, habit: !!q.habitId, tiers: JSON.parse(q.tiersJson) }))}
          saved={n.saved}
          checklist={n.checklist}
          goal={{ minutes: g.goal.minutes, focus: g.focus, upgrade: g.upgrade }}
        />
      )}
    </div>
  );
}
