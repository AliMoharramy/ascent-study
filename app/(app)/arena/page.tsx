import Link from "next/link";
import { requireUser } from "@/server/context";
import { listBosses, listMocks, nextBoss, rivalView, settleDuels } from "@/server/arena";
import { storyView } from "@/server/story";
import { chapters, subjects } from "@/db/schema";
import { weekNoOf } from "@/lib/campaign";
import { Card, Eyebrow, PageHeader, ShadowGap, StatTile } from "@/ui/components";
import { MascotSlot, shadeStateFor } from "@/ui/Mascot";
import { BossPanel, MockPanel, DuelTable } from "./ArenaClient";
import { BossRushPanel, ChallengeCardPanel } from "./ExtrasArena";
import { cardView, rushView } from "@/server/extras";

export const metadata = { title: "Arena" };

/** Arena (S09): Shadow vs You, weekly duels, bosses (spec → result), cshub mock exams. */
export default async function ArenaPage() {
  const { db, userId, today, cfg } = await requireUser();
  (await settleDuels(db, userId, today));
  const rival = (await rivalView(db, userId, today));
  const next = (await nextBoss(db, userId, today));
  const bosses = (await listBosses(db, userId)).map((b) => ({ ...b, spec: JSON.parse(b.specJson) as { title: string; questions: number; minutes: number; chapters: { chapterId: string; questions: number }[] } }));
  const titles = Object.fromEntries((await db.select({ id: chapters.id, t: chapters.title, no: chapters.no, s: chapters.subjectId }).from(chapters)).map((c) => [c.id, `${c.s.toUpperCase()} ${c.no} · ${c.t}`]));
  const subs = (await db.select({ id: subjects.id, en: subjects.nameEn, status: subjects.status }).from(subjects));
  const mocks = (await listMocks(db, userId));
  const story = (await storyView(db, userId, today));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow={`Week ${weekNoOf(today)} · Ch.4 The Arena`} title="Arena">
        <Link href="/arena/exam" className="btn-ghost">
          Exam simulator
        </Link>
        <Link href="/run" className="btn-accent">
          Start mini-run
        </Link>
      </PageHeader>
      {!cfg.flags.bosses && <p className="card text-body-s">Bosses are turned off in Settings → Feature flags.</p>}
      <Card tone="mint" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Rival & bonus dispatches · week {story.weekNo}</Eyebrow>
          <Link href="/life?tab=story" className="text-caption font-extrabold underline">
            Story chapter →
          </Link>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {story.events.map((e, i) => (
            <div key={i} className="rounded-2xl bg-white/40 p-3">
              <p className="text-caption font-extrabold uppercase opacity-70">{e.kind === "rival" ? "Rival" : "Bonus"}</p>
              <p className="text-body-s font-extrabold">{e.title}</p>
              <p className="text-body-s" dir="auto">
                {e.text}
              </p>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Card tone="purple" className="flex flex-col gap-3 md:col-span-2">
          <Eyebrow>You vs The Shadow</Eyebrow>
          {rival.enabled ? (
            <>
              <div className="flex items-center gap-3">
                <MascotSlot character="shade" state={shadeStateFor(rival.current)} size="sm" enabled={cfg.flags.mascots} />
                <div className="min-w-0 flex-1">
                  <ShadowGap you={rival.current.userMp} shadow={rival.current.shadowMp} />
                </div>
              </div>
              <details className="text-body-s">
                <summary className="cursor-pointer font-extrabold">Why? (every number explained)</summary>
                <ul className="mt-2 list-disc ps-5 opacity-90">
                  <li>{rival.current.why}</li>
                  <li>Pace p is clamped to [{cfg.rival.paceMin}, {cfg.rival.paceMax}] and updated weekly: p ← 0.5·p + 0.5·(your 4-week pace × {cfg.rival.userPaceBoost}). The Shadow is never above 110 % of the plan.</li>
                  <li>Mastery Points = cleared chapters weighted M3 / S2 / C1. Planned MP comes from your 25-week plan.</li>
                  <li>Shadow accuracy this week: {rival.accuracy}% (linear from your baseline {rival.a0Pct}% to {cfg.rival.targetNetPct}%).</li>
                  <li>If you stay ≥ {cfg.rival.restsBehind * 100}% behind for {cfg.rival.restsWeeks} weeks: “Shadow Rests” — the gap shrinks by {cfg.rival.restsGapCut * 100}%.</li>
                </ul>
              </details>
              {rival.weeks.some((w) => w.rested) && <p className="chip self-start bg-white text-on-color">The Shadow rested — the gap shrank</p>}
            </>
          ) : (
            <p className="font-bold">{rival.reason}</p>
          )}
        </Card>
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Duels won" value={rival.enabled ? rival.duels.filter((d) => d.winner === "user").length : 0} />
          <StatTile label="Duels lost" value={rival.enabled ? rival.duels.filter((d) => d.winner === "shadow").length : 0} />
          <StatTile label="Bosses down" value={bosses.filter((b) => b.defeated).length} />
          <StatTile label="Mocks" value={mocks.reduce((s, m) => s + m.results.length, 0)} />
        </div>
      </div>
      {rival.enabled && <DuelTable duels={rival.duels} />}
      <div className="grid gap-4 md:grid-cols-2">
        <ChallengeCardPanel data={(await cardView(db, userId, today))} />
        <BossRushPanel data={(await rushView(db, userId, today))} />
      </div>
      <BossPanel bosses={bosses} titles={titles} nextId={next?.id ?? null} today={today} />
      <MockPanel mocks={mocks} subjects={subs.map((s) => ({ id: s.id, name: s.en, skipped: s.status === "dropped" }))} />
    </div>
  );
}
