"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow, StatTile } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import type { wellnessView } from "@/server/wellness";

type V = Awaited<ReturnType<typeof wellnessView>>;
const MOOD = ["Drained", "Low", "Steady", "Good", "Great"];
const ENERGY = ["Empty", "Low", "OK", "Fresh", "Charged"];

/** Wellness suite (#88): mood/energy check-in, win log, wind-down ritual, weekly sleep debt. A mirror, never a score. */
export function WellnessClient({ data }: { data: V }) {
  const { toast } = useFeedback();
  const [v, setV] = useState(data);
  useEffect(() => setV(data), [data]);
  const [mood, setMood] = useState<number | null>(data.today?.mood ?? null);
  const [energy, setEnergy] = useState<number | null>(data.today?.energy ?? null);
  const [wins, setWins] = useState<string[]>([...(data.today?.wins ?? []), "", "", ""].slice(0, 3));
  const [down, setDown] = useState<string[]>(data.today?.winddown ?? []);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await apiFetch<V>("/api/wellness", { body: { mood, energy, wins: wins.filter((w) => w.trim()), winddown: down } });
      setV(r);
      toast("Check-in saved — tonight's ritual is logged");
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }
  const scale = (value: number | null, set: (n: number | null) => void, words: string[], label: string) => (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-1" role="group" aria-label={label}>
        {words.map((w, i) => (
          <button key={w} type="button" aria-pressed={value === i + 1} onClick={() => set(value === i + 1 ? null : i + 1)} className={cx("flex-1 rounded-xl px-1 py-1.5 text-caption font-extrabold", value === i + 1 ? "bg-purple text-white" : "bg-surface-2 text-muted hover:text-ink")}>
            {i + 1}
            <span className="block text-[10px] font-bold opacity-80">{w}</span>
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card className="flex flex-col gap-3">
        <Eyebrow>Tonight&apos;s check-in · a mirror, not a score</Eyebrow>
        {scale(mood, setMood, MOOD, "Mood")}
        {scale(energy, setEnergy, ENERGY, "Energy")}
        <div>
          <span className="label">Wins today (up to 3 — small counts)</span>
          <div className="flex flex-col gap-1.5">
            {[0, 1, 2].map((i) => (
              <input key={i} className="field" maxLength={120} placeholder={i === 0 ? "e.g. finished the trees chapter" : "another win…"} value={wins[i] ?? ""} onChange={(e) => setWins(wins.map((w, j) => (j === i ? e.target.value : w)))} aria-label={`Win ${i + 1}`} />
            ))}
          </div>
        </div>
        <div>
          <span className="label">Wind-down ritual</span>
          <ul className="grid gap-1">
            {v.winddownChecklist.map((item) => (
              <li key={item}>
                <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5 text-body-s">
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-purple))]" checked={down.includes(item)} onChange={(e) => setDown(e.target.checked ? [...down, item] : down.filter((d) => d !== item))} />
                  <span dir="auto">{item}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <button className="btn-accent self-start" disabled={busy} onClick={save}>
          Save check-in
        </button>
        {v.series.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
            {v.series.map((s) => (
              <Chip key={s.date} tone="surface">
                {s.date.slice(5)} · m{s.mood ?? "–"} e{s.energy ?? "–"}
              </Chip>
            ))}
          </div>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <Eyebrow>Weekly sleep debt</Eyebrow>
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Debt (7 nights)" value={v.sleepDebt.debtHours} unit="h" tone={v.sleepDebt.debtHours > v.debtLimitHours ? "coral" : "mint"} hint={`gentle limit ${v.debtLimitHours}h`} />
          <StatTile label="Nights logged" value={v.sleepDebt.logged} unit="/7" />
        </div>
        <ul className="grid gap-1 text-body-s">
          {v.sleepDebt.nights.map((n) => (
            <li key={n.date} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-1.5">
              <span>{n.date}</span>
              <span className={cx("font-extrabold", n.shortHours > 0 ? "text-coral-ink" : "text-lime-ink")}>{n.shortHours > 0 ? `−${n.shortHours}h` : "full"}</span>
            </li>
          ))}
          {v.sleepDebt.nights.length === 0 && <li className="text-muted">No nights logged this week yet.</li>}
        </ul>
        <p className="text-caption text-muted">
          Debt = hours below your minimum sleep target across the last 7 nights. It is information for planning rest, never a penalty. {v.sleepDebt.debtHours > v.debtLimitHours ? "Above the gentle limit — consider a Rest Day Pass or an earlier lights-out." : "Within the gentle limit."}
        </p>
      </Card>
    </div>
  );
}