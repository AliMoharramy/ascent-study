"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, Eyebrow, StatTile } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import type { programView } from "@/server/rest";
import { SleepCsvImport } from "./SleepCsvImport";

type V = Awaited<ReturnType<typeof programView>>;
const toMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function RestClient({ view, today, week }: { view: V; today: string; week: number }) {
  const { toast } = useFeedback();
  const [f, setF] = useState({ date: today, bed: "23:30", wake: view.week.wakeTarget });
  async function post(body: Record<string, unknown>, ok: string) {
    try {
      const r = await apiFetch<{ result: { wakeOk?: boolean; bedOk?: boolean; ok?: number; errors?: string[] } | null }>("/api/sleep", { body });
      toast(r.result?.errors?.length ? `${r.result.ok} imported, ${r.result.errors.length} errors: ${r.result.errors[0]}` : ok + (r.result?.wakeOk ? " · Wake on time ✔" : "") + (r.result?.bedOk ? " · Lights out ✔" : ""));
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  const minWake = Math.min(...view.weeks.map((w) => toMin(w.wakeTarget)), ...view.recent.map((n) => toMin(n.wake)));
  const maxWake = Math.max(...view.weeks.map((w) => toMin(w.wakeTarget)), ...view.recent.map((n) => toMin(n.wake)));
  const y = (m: number) => 10 + ((m - minWake) / Math.max(1, maxWake - minWake)) * 120;
  return (
    <div className="flex flex-col gap-4">
      {!view.enabled && <Card className="text-body-s">The Sleep Program is turned off (Settings → Feature flags). Logging still works.</Card>}
      {view.concern && <Card tone="coral" className="text-body-s font-bold">{view.concern}</Card>}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Wake target" value={view.week.wakeTarget} tone="yellow" hint={`goal 05:30 · week ${week}`} />
        <StatTile label="Bed target" value={view.week.bedTarget} tone="purple" />
        <StatTile label="Status" value={view.week.hold ? "Hold" : "Shifting"} tone={view.week.hold ? "coral" : "lime"} hint={view.week.hold ? view.week.reasons.join("; ") : "−20 min / week"} />
        <StatTile label="Body this week" value={view.body.minutes ? `${view.body.daysPerWeek}×${view.body.minutes}` : "—"} unit="min" hint={view.body.label} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="flex flex-col gap-2">
          <Eyebrow>Wake target by week vs your last two weeks</Eyebrow>
          <svg viewBox="0 0 520 150" className="w-full" role="img" aria-label="Sleep program wake targets">
            <polyline fill="none" stroke="rgb(var(--c-yellow))" strokeWidth="3" points={view.weeks.map((w, i) => `${10 + i * 20.5},${y(toMin(w.wakeTarget))}`).join(" ")} />
            {view.weeks.map((w, i) => (w.hold ? <circle key={w.week} cx={10 + i * 20.5} cy={y(toMin(w.wakeTarget))} r="4" fill="rgb(var(--c-coral))" /> : null))}
            <line x1={10 + (week - 1) * 20.5} x2={10 + (week - 1) * 20.5} y1="0" y2="150" stroke="rgb(var(--c-purple))" strokeDasharray="4 4" />
            {view.recent.map((n, i) => (
              <circle key={n.date} cx={10 + (week - 1) * 20.5 - (view.recent.length - 1 - i) * 3} cy={y(toMin(n.wake))} r="3" fill={n.wakeOk ? "rgb(var(--c-lime))" : "rgb(var(--text-muted))"} />
            ))}
          </svg>
          <p className="text-caption text-muted">Yellow = weekly target (−20 min while not on Hold). Red dots = Hold weeks. Guards: avg of last 3 nights &lt; 6h15, wake spread &gt; 45 min (Friday ±45 min graced), Life Event.</p>
          <ul className="mt-2 grid gap-1 text-body-s">
            {view.recent.slice(-7).reverse().map((n) => (
              <li key={n.date} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-1.5">
                <span>{n.date}</span>
                <span>
                  {n.bed} → {n.wake} · {Math.floor(n.minutes / 60)}h{n.minutes % 60}m
                </span>
                <span className="flex gap-1">
                  <Chip tone={n.bedOk ? "lime" : "surface"}>bed</Chip>
                  <Chip tone={n.wakeOk ? "lime" : "surface"}>wake</Chip>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <Eyebrow>Log a night (Seed = just log it)</Eyebrow>
            <form
              className="grid grid-cols-3 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void post({ action: "log", ...f }, "Night logged");
              }}
            >
              <label className="col-span-3">
                <span className="label">Morning of</span>
                <input type="date" className="field" value={f.date} max={today} onChange={(e) => setF({ ...f, date: e.target.value })} />
              </label>
              <label>
                <span className="label">Bed</span>
                <input type="time" className="field" value={f.bed} onChange={(e) => setF({ ...f, bed: e.target.value })} />
              </label>
              <label>
                <span className="label">Wake</span>
                <input type="time" className="field" value={f.wake} onChange={(e) => setF({ ...f, wake: e.target.value })} />
              </label>
              <button className="btn-accent self-end">Save</button>
            </form>
          </Card>
          <SleepCsvImport />
          <Card className="flex flex-col gap-2 text-caption text-muted">
            <p>
              Program start: wake {view.start.wake}, bed {view.start.bed} (your Mi Band averages). Change it after the baseline week:
            </p>
            <button className="btn-ghost self-start" onClick={() => post({ action: "start", wake: f.wake, bed: f.bed }, "Program start updated")}>
              Use the times above as the start
            </button>
            <p>Not medical advice — if sleep stays very short or irregular, talk to a professional.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
