import { and, eq, gte } from "drizzle-orm";
import { weekPlanItems } from "@/db/schema";
import { requireUser } from "@/server/context";
import { capacityView, planView } from "@/server/plan";
import { getRestDays } from "@/server/restDays";
import { energyView, forecastView, rankView, weakView, whatIfView } from "@/server/insights";
import { Card, Eyebrow, PageHeader } from "@/ui/components";
import { PlanClient } from "./PlanClient";
import { PlanIntelligence } from "./PlanIntelligence";

export const metadata = { title: "Plan" };

/** Plan (S10, #33 #34 #57): capacity & windows, Triage, 25-week calendar with Load Ratio, Burn Gap, Rebalance, Reset Week. */
export default async function PlanPage() {
  const { db, userId, today, cfg } = await requireUser();
  const v = (await planView(db, userId, today, cfg));
  const cap = (await capacityView(db, userId, today, cfg));
  const rows = (await db
    .select({ chapterId: weekPlanItems.chapterId, plannedMin: weekPlanItems.plannedMin, weekNo: weekPlanItems.weekNo })
    .from(weekPlanItems)
    .where(and(eq(weekPlanItems.userId, userId), gte(weekPlanItems.weekNo, v.currentWeek))));
  const agg = new Map<string, { minutes: number; weeks: Set<number> }>();
  for (const r of rows) {
    const a = agg.get(r.chapterId) ?? { minutes: 0, weeks: new Set<number>() };
    a.minutes += r.plannedMin;
    a.weeks.add(r.weekNo);
    agg.set(r.chapterId, a);
  }
  const labelOf = (id: string) => {
    const c = v.chapters.find((x) => x.id === id);
    return c ? `${c.subjectId.toUpperCase()} ${c.no} · ${c.title}` : id;
  };
  const planned = [...agg.entries()].map(([chapterId, a]) => ({ chapterId, label: labelOf(chapterId), minutes: a.minutes, weeks: a.weeks.size }));
  return (
    <div>
      <PageHeader eyebrow={`Week ${v.currentWeek} of 25`} title="Plan">
        <a href="/api/exports?kind=ics" download className="btn-ghost no-print" title="Next 4 weeks of plan items in your capacity windows + exam day (RFC 5545)">
          Export calendar (.ics)
        </a>
      </PageHeader>
      {v.prereqWarnings.length > 0 && (
        <Card tone="coral" className="mb-4 flex flex-col gap-1">
          <Eyebrow>Prerequisite warnings · triage graph</Eyebrow>
          <ul className="list-disc ps-5 text-body-s font-bold">
            {v.prereqWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <p className="text-caption opacity-80">Warnings only — tiers are never changed without your confirmation on the chapter page.</p>
        </Card>
      )}
      <PlanClient view={v} capacity={cap} fillFraction={cfg.planner.fillFraction} restDays={(await getRestDays(db, userId))} today={today} />
      <div className="mt-4">
        <PlanIntelligence
          forecast={(await forecastView(db, userId, today))}
          energy={(await energyView(db, userId))}
          weak={(await weakView(db, userId))}
          rank={(await rankView(db, userId, today))}
          planned={planned}
          chapters={v.chapters.map((c) => ({ id: c.id, label: `${c.subjectId.toUpperCase()} ${c.no} · ${c.title}` }))}
          initialWhatIf={(await whatIfView(db, userId, today, [], []))}
        />
      </div>
    </div>
  );
}