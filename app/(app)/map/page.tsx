import { queryRows, queryOne } from "@/db/client";
import { and, eq, sql } from "drizzle-orm";
import { asc } from "drizzle-orm";
import Link from "next/link";
import { bosses, chapters, chapterState, reviewRounds, subjects, weekPlanItems } from "@/db/schema";
import { requireUser } from "@/server/context";
import { fogFor } from "@/domain/fog";
import { specialNode } from "@/domain/pillars";
import { addDaysIso } from "@/i18n/jalali";
import { weekNoOf } from "@/lib/campaign";
import { capsuleView } from "@/server/extras";
import { Card, Eyebrow, PageHeader } from "@/ui/components";
import { WorldMap, type MapNode, type MapSubject } from "./WorldMap";

export const metadata = { title: "World Map" };

export default async function MapPage() {
  const { db, userId, today, cfg } = await requireUser();
  const subs = (await db.select().from(subjects).orderBy(asc(subjects.sort))).filter((s) => s.status !== "dropped"); // linear algebra (dropped) is never drawn
  const st = new Map((await db.select().from(chapterState).where(eq(chapterState.userId, userId))).map((s) => [s.chapterId, s]));
  const focus = new Map((await queryRows<{ ch: string; m: number }>(db, sql`SELECT chapter_id AS ch, sum(minutes) AS m FROM focus_sessions WHERE user_id = ${userId} AND status = 'ended' AND chapter_id IS NOT NULL GROUP BY chapter_id`)).map((r) => [r.ch, r.m]));
  const planned = new Map((await db.select({ ch: weekPlanItems.chapterId, wk: sql<number>`max(${weekPlanItems.weekNo})` }).from(weekPlanItems).where(and(eq(weekPlanItems.userId, userId))).groupBy(weekPlanItems.chapterId)).map((r) => [r.ch, r.wk]));
  const cur = weekNoOf(today);
  const comebacks = (await queryOne<{ n: number }>(db, sql`SELECT count(*) AS n FROM events WHERE user_id = ${userId} AND type = 'comeback.settled' AND game_day >= ${addDaysIso(today, -7)}`))?.n ?? 0;
  const round3 = new Set((await db.select({ s: reviewRounds.subjectId }).from(reviewRounds).where(and(eq(reviewRounds.userId, userId), eq(reviewRounds.round, 3), eq(reviewRounds.status, "done")))).map((r) => r.s));
  const hardBossChapters = new Set<string>();
  for (const b of (await db.select().from(bosses).where(and(eq(bosses.userId, userId), eq(bosses.defeated, true))))) {
    if (b.kind !== "region" && b.kind !== "final") continue;
    for (const c of (JSON.parse(b.specJson) as { chapters?: { chapterId: string }[] }).chapters ?? []) hardBossChapters.add(c.chapterId);
  }
  const nodes: MapNode[] = (await db
    .select()
    .from(chapters)
    .orderBy(asc(chapters.no)))
    .filter((c) => subs.some((s) => s.id === c.subjectId))
    .map((c) => {
      const s = st.get(c.id);
      const state: MapNode["state"] = s?.clearedAt ? "cleared" : (s?.netPct != null || (focus.get(c.id) ?? 0) > 0) ? "progress" : (planned.get(c.id) ?? 99) < cur ? "fog" : "unseen";
      const fog = fogFor({ state, plannedWeek: planned.get(c.id) ?? null, curWeek: cur, comebacks });
      return { id: c.id, subjectId: c.subjectId, no: c.no, title: c.title, tier: c.tier, optional: c.optional, state, net: s?.netPct ?? null, plannedWeek: planned.get(c.id) ?? null, fogPct: fog.pct, fogWeeks: fog.weeksBehind, weight: c.eqWeight, special: specialNode(c.no, round3.has(c.subjectId), hardBossChapters.has(c.id)) };
    });
  const mapSubs: MapSubject[] = subs.map((s) => ({ id: s.id, nameEn: s.nameEn, nameFa: s.nameFa }));
  const required = nodes.filter((n) => !n.optional).length;
  const fogged = nodes.filter((n) => n.state === "fog" && n.fogPct > 0).length;
  const hot = [...nodes].filter((n) => !n.optional && n.weight != null).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 6);
  return (
    <div>
      <PageHeader eyebrow="Ch.2 · The Knowledge Lands" title="World Map">
        <span className="chip bg-surface-1 text-ink">{required} required nodes · {nodes.length - required} optional</span>
        <span className="chip bg-yellow text-on-color">{nodes.filter((n) => n.state === "cleared").length} cleared</span>
        {cfg.flags.fog ? <span className="chip bg-coral text-on-color">{fogged} in fog</span> : <span className="chip bg-surface-1 text-muted">fog off</span>}
      </PageHeader>
      <Card className="mb-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Eyebrow>Past-exam hot spots · T-DATA-07 weights</Eyebrow>
          <span className="text-caption text-muted">Share of each subject&apos;s expected questions — the triage engine&apos;s Eq input.</span>
        </div>
        <ol className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {hot.map((n, i) => (
            <li key={n.id}>
              <Link href={`/map/${n.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-1.5 text-body-s hover:bg-surface-1">
                <span className="flex min-w-0 items-center gap-2">
                  <b className="text-muted">{i + 1}</b>
                  <span className="fa truncate font-bold" dir="auto">
                    {subs.find((s) => s.id === n.subjectId)?.nameEn} {n.no} · {n.title}
                  </span>
                </span>
                <b className="shrink-0 text-coral-ink">{(n.weight! * 100).toFixed(1)}%</b>
              </Link>
            </li>
          ))}
        </ol>
      </Card>
      <WorldMap nodes={nodes} subjects={mapSubs} fogEnabled={cfg.flags.fog} capsule={(await capsuleView(db, userId, today))} />
    </div>
  );
}
