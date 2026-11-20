"use client";

import { Card, Chip, cx, Eyebrow, StatTile } from "@/ui/components";
import type { miningView, skipView, timeView } from "@/server/insights";

type Mining = Awaited<ReturnType<typeof miningView>>;
type Time = Awaited<ReturnType<typeof timeView>>;
type Skip = Awaited<ReturnType<typeof skipView>>;

/** Mistake coach (#100): mining clusters, time-per-question vs target, and the skip-strategy EV trainer. */
export function ForgeInsights({ mining, time, skip }: { mining: Mining; time: Time; skip: Skip }) {
  const maxCause = Math.max(1, ...mining.causes.map((c) => c.count));
  const y = (ev: number) => 140 - ((ev + 1 / 3) / (4 / 3)) * 120;
  const x = (p: number) => 20 + p * 480;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-3">
        <Eyebrow>Mistake mining · last 90 days</Eyebrow>
        <p className="text-body-s text-muted">{mining.total} analyzed mistakes clustered by cause and repeated concept.</p>
        <ul className="grid gap-1.5">
          {mining.causes.map((c) => (
            <li key={c.cause} className="grid grid-cols-[110px_1fr_32px] items-center gap-2 text-body-s">
              <span className="truncate font-bold">{c.cause}</span>
              <span className="h-2.5 overflow-hidden rounded-pill bg-surface-2">
                <span className="block h-full rounded-pill bg-coral" style={{ width: `${(c.count / maxCause) * 100}%` }} />
              </span>
              <b className="text-end">{c.count}</b>
            </li>
          ))}
          {mining.causes.length === 0 && <li className="text-muted">No mistakes logged yet — the Forge stays quiet.</li>}
        </ul>
        <div className="flex flex-wrap gap-1.5">
          {mining.examples.map((c) => (
            <details key={c.word} className="rounded-xl bg-surface-2 px-2 py-1">
              <summary className="cursor-pointer text-caption font-extrabold">
                {c.word} · {c.count}
              </summary>
              <ul className="mt-1 grid gap-1 text-caption text-muted">
                {c.samples.map((s, i) => (
                  <li key={i} className="fa" dir="auto">
                    “{s}”
                  </li>
                ))}
                {c.samples.length === 0 && <li>no takeaway mentions this word yet</li>}
              </ul>
            </details>
          ))}
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <Eyebrow>Time per question · last 28 days</Eyebrow>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Sec / question" value={time.secPerQ ?? "—"} tone={time.slow ? "coral" : "mint"} />
          <StatTile label="Target" value={time.target} unit="s" hint="skill perks lower it" />
          <StatTile label="Timed sessions" value={time.timedSessions} />
        </div>
        <p className="text-body-s">
          {time.secPerQ === null ? "Add “seconds spent” when logging tests to unlock pacing feedback." : time.slow ? `Above target by ${Math.round(time.secPerQ - time.target)}s — train with timed sets and skip faster (see the curve below).` : "At or under target — pacing is exam-ready."}
        </p>
        <Chip tone={time.slow ? "coral" : "lime"}>{time.slow ? "Slow pace" : "Exam pace"}</Chip>
      </Card>
      <Card className="flex flex-col gap-3 lg:col-span-2">
        <Eyebrow>Skip-strategy trainer · expected value of attempting</Eyebrow>
        <svg viewBox="0 0 520 170" className="w-full" role="img" aria-label="Expected value of attempting a question versus your accuracy">
          <line x1={20} x2={500} y1={y(0)} y2={y(0)} stroke="rgb(var(--border))" strokeWidth="2" strokeDasharray="4 4" />
          <line x1={x(skip.threshold)} x2={x(skip.threshold)} y1={10} y2={150} stroke="rgb(var(--c-coral))" strokeWidth="2" strokeDasharray="4 4" />
          <path d={skip.curve.map((pt, i) => `${i ? "L" : "M"}${x(pt.p)},${y(pt.ev)}`).join(" ")} fill="none" stroke="rgb(var(--c-purple))" strokeWidth="3" />
          {skip.p !== null && <circle cx={x(skip.p)} cy={y(skip.evAtP ?? 0)} r="6" fill="rgb(var(--c-yellow))" stroke="rgb(var(--text))" strokeWidth="2" />}
          <text x={x(skip.threshold) + 4} y={20} className="fill-[rgb(var(--c-coral))] text-[11px] font-black">
            break-even 25%
          </text>
          <text x={20} y={165} className="fill-[rgb(var(--text-muted))] text-[11px] font-bold">
            0%
          </text>
          <text x={250} y={165} className="fill-[rgb(var(--text-muted))] text-[11px] font-bold">
            your accuracy →
          </text>
          <text x={480} y={165} className="fill-[rgb(var(--text-muted))] text-[11px] font-bold">
            100%
          </text>
          <text x={4} y={y(1) + 4} className="fill-[rgb(var(--text-muted))] text-[11px] font-bold">
            +1
          </text>
          <text x={4} y={y(0) + 4} className="fill-[rgb(var(--text-muted))] text-[11px] font-bold">
            0
          </text>
          <text x={4} y={y(-1 / 3) + 4} className="fill-[rgb(var(--text-muted))] text-[11px] font-bold">
            −⅓
          </text>
        </svg>
        <p className="text-body-s font-bold">{skip.advice}</p>
        <p className="text-caption text-muted">
          EV = p − (1 − p)/3 with 4 choices and −⅓ negative marking: attempting pays only above p* = 25%. {skip.p !== null ? `Your EV right now: ${skip.evAtP} per question (${skip.answered} answered in 28 days).` : ""} Below break-even, skipping unknowns is strategy, not weakness.
        </p>
        <ul className="grid gap-1.5">
          {skip.missions.map((m) => (
            <li key={m.chapterId} className={cx("rounded-xl bg-surface-2 px-3 py-2 text-body-s")}>
              <b className="fa" dir="auto">
                {m.title}
              </b>
              <span className="block text-muted">{m.mission}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}