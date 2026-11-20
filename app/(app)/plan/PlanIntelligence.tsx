"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow, StatTile } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import type { energyView, forecastView, rankView, weakView, whatIfView } from "@/server/insights";

type Forecast = Awaited<ReturnType<typeof forecastView>>;
type Energy = Awaited<ReturnType<typeof energyView>>;
type Weak = Awaited<ReturnType<typeof weakView>>;
type Rank = Awaited<ReturnType<typeof rankView>>;
type WhatIf = Awaited<ReturnType<typeof whatIfView>>;
type Planned = { chapterId: string; label: string; minutes: number; weeks: number };
type AddRow = { chapterId: string; tier: "M" | "S" | "C"; plannedMin: number };

const Band = ({ lo, hi, pct }: { lo: number; hi: number; pct: number }) => (
  <svg viewBox="0 0 200 14" className="h-3.5 w-full" role="img" aria-label={`Forecast ${pct}% with band ${lo} to ${hi}`}>
    <rect x="0" y="5" width="200" height="4" rx="2" fill="rgb(var(--surface-2))" />
    <rect x={Math.max(0, lo) * 2} y="3" width={Math.max(2, (Math.min(100, hi) - Math.max(0, lo)) * 2)} height="8" rx="4" fill="rgb(var(--c-mint) / 0.55)" />
    <circle cx={Math.min(100, Math.max(0, pct)) * 2} cy="7" r="5" fill="rgb(var(--c-purple))" />
  </svg>
);

/** Plan intelligence (#95, #99): forecast band, energy peaks, weak-point hunter, what-if planner, rank interval. */
export function PlanIntelligence({ forecast, energy, weak, rank, planned, chapters, initialWhatIf }: { forecast: Forecast; energy: Energy; weak: Weak; rank: Rank; planned: Planned[]; chapters: { id: string; label: string }[]; initialWhatIf: WhatIf }) {
  const { toast } = useFeedback();
  const [wi, setWi] = useState<WhatIf>(initialWhatIf);
  const [drop, setDrop] = useState<string[]>([]);
  const [add, setAdd] = useState<AddRow[]>([]);
  const [form, setForm] = useState<{ chapterId: string; tier: "M" | "S" | "C"; min: string }>({ chapterId: "", tier: "S", min: "120" });
  const [busy, setBusy] = useState(false);
  async function run(nextDrop: string[], nextAdd: AddRow[]) {
    setBusy(true);
    try {
      const r = await apiFetch<{ whatIf: WhatIf }>("/api/insights", { body: { drop: nextDrop, add: nextAdd } });
      setWi(r.whatIf);
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }
  const maxHeat = Math.max(1, ...energy.heat);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-3">
        <Eyebrow>Net-% forecast · last {forecast.windowDays} days, recency-weighted</Eyebrow>
        <div className="flex items-baseline gap-3">
          <p className="font-display text-display-l leading-none">{forecast.overall.n ? `${forecast.overall.pct}%` : "—"}</p>
          <p className="text-body-s text-muted">
            band {forecast.overall.lo}% … {forecast.overall.hi}% · {forecast.overall.n} test days
          </p>
        </div>
        <Band lo={forecast.overall.lo} hi={forecast.overall.hi} pct={forecast.overall.pct} />
        <ul className="grid gap-2">
          {forecast.bySubject.map((s) => (
            <li key={s.subjectId} className="grid grid-cols-[110px_1fr_120px] items-center gap-2 text-body-s">
              <span className="truncate font-bold">{s.name}</span>
              <Band lo={s.forecast.lo} hi={s.forecast.hi} pct={s.forecast.pct} />
              <span className="text-end text-muted">
                {s.forecast.pct}% [{s.forecast.lo}, {s.forecast.hi}]
              </span>
            </li>
          ))}
          {forecast.bySubject.length === 0 && <li className="text-muted">Log tests for a few days to unlock per-subject forecasts.</li>}
        </ul>
        <p className="text-caption text-muted">The band widens when data is scarce — it is honest uncertainty, not a promise.</p>
      </Card>
      <Card className="flex flex-col gap-3">
        <Eyebrow>Energy peaks · real focus minutes by hour ({energy.timezone})</Eyebrow>
        <div className="flex h-24 items-end gap-0.5" role="img" aria-label="Focus minutes by hour of day">
          {energy.heat.map((v, h) => (
            <span key={h} title={`${String(h).padStart(2, "0")}:00 — ${v} min`} className={cx("flex-1 rounded-t", energy.peaks.includes(h) ? "bg-yellow" : "bg-surface-2")} style={{ height: `${Math.max(3, (v / maxHeat) * 100)}%` }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {energy.peaks.map((h) => (
            <Chip key={h} tone="yellow">
              peak {String(h).padStart(2, "0")}:00–{String(h + 1).padStart(2, "0")}:00
            </Chip>
          ))}
          {energy.peaks.length === 0 && <Chip tone="surface">no focus sessions yet</Chip>}
        </div>
        <p className="text-caption text-muted">{energy.sessions} ended sessions. Schedule the hardest chapter inside a peak hour; keep admin work in the valleys.</p>
        <Eyebrow>Weak-point hunter</Eyebrow>
        <ul className="grid gap-1.5">
          {weak.slice(0, 5).map((w) => (
            <li key={w.chapterId} className="rounded-xl bg-surface-2 px-3 py-2 text-body-s">
              <span className="flex items-center justify-between gap-2">
                <b className="fa truncate" dir="auto">
                  {w.subject} · {w.title}
                </b>
                <Chip tone="coral">score {w.score}</Chip>
              </span>
              <span className="block text-caption text-muted">
                net {w.netPct ?? "—"}% · {w.errors} mistakes · {w.mission}
              </span>
            </li>
          ))}
          {weak.length === 0 && <li className="text-muted">No weak points detected yet.</li>}
        </ul>
      </Card>
      <Card className="flex flex-col gap-3">
        <Eyebrow>What-if planner · remaining weeks</Eyebrow>
        <p className="text-caption text-muted">Drop or add chapters and see load, coverage and forecast move. Pure simulation — nothing is written to the plan.</p>
        <div className="grid max-h-44 gap-1 overflow-y-auto">
          {planned.map((c) => (
            <label key={c.chapterId} className="flex cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5 text-body-s">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[rgb(var(--c-coral))]"
                checked={drop.includes(c.chapterId)}
                onChange={(e) => {
                  const next = e.target.checked ? [...drop, c.chapterId] : drop.filter((d) => d !== c.chapterId);
                  setDrop(next);
                  void run(next, add);
                }}
              />
              <span className={cx("fa min-w-0 flex-1 truncate", drop.includes(c.chapterId) && "line-through opacity-60")} dir="auto">
                {c.label}
              </span>
              <span className="shrink-0 text-caption text-muted">
                {c.minutes} min · {c.weeks}w
              </span>
            </label>
          ))}
          {planned.length === 0 && <p className="text-muted">No planned chapters from this week on.</p>}
        </div>
        <form
          className="grid grid-cols-[1fr_70px_80px_auto] items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.chapterId) return;
            const next = [...add, { chapterId: form.chapterId, tier: form.tier, plannedMin: Number(form.min || 0) }];
            setAdd(next);
            void run(drop, next);
          }}
        >
          <label>
            <span className="label">Add chapter</span>
            <select className="field" value={form.chapterId} onChange={(e) => setForm({ ...form, chapterId: e.target.value })}>
              <option value="">Pick…</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Tier</span>
            <select className="field" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as AddRow["tier"] })}>
              {(["M", "S", "C"] as const).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Min</span>
            <input className="field" inputMode="numeric" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value.replace(/\D/g, "") })} />
          </label>
          <button className="btn-ghost" disabled={busy || !form.chapterId}>
            Add
          </button>
        </form>
        {add.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {add.map((a, i) => (
              <Chip key={`${a.chapterId}-${i}`} tone="mint">
                + {chapters.find((c) => c.id === a.chapterId)?.label ?? a.chapterId} ({a.tier}, {a.plannedMin}m)
                <button
                  type="button"
                  className="ms-1 font-black"
                  aria-label="Remove added chapter"
                  onClick={() => {
                    const next = add.filter((_, j) => j !== i);
                    setAdd(next);
                    void run(drop, next);
                  }}
                >
                  ×
                </button>
              </Chip>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Load" value={wi.minutes} unit="min" hint={`${wi.deltaMin >= 0 ? "+" : ""}${wi.deltaMin} vs plan`} tone={wi.deltaMin > 0 ? "coral" : "mint"} />
          <StatTile label="Coverage" value={Math.round(wi.coverage * 100)} unit="%" />
          <StatTile label="Forecast" value={wi.forecast} unit="%" hint={`base ${wi.baseForecast}%`} tone="purple" />
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <Eyebrow>Rank interval · transparent assumption</Eyebrow>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Est. rank" value={rank.estimate.rank} tone="purple" />
          <StatTile label="Interval" value={`${rank.estimate.lo}–${rank.estimate.hi}`} />
          <StatTile label="Forecast net" value={rank.forecast.pct} unit="%" />
        </div>
        <p className="text-body-s font-bold">{rank.note}</p>
        <p className="text-caption text-muted">
          Source: {rank.estimate.source}. The curve maps net % to rank using public karname aggregates; band factor widens the interval. When official data arrives, edit Config → rank and the estimate updates everywhere.
        </p>
      </Card>
    </div>
  );
}