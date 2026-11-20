"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { cx, Eyebrow } from "@/ui/components";
import { Icon } from "@/ui/icons";

type Checkin = {
  energyMorning: number | null;
  energyNoon: number | null;
  energyNight: number | null;
  blocker: string | null;
  escapeMinutes: number | null;
  escapeKind: string | null;
  classAttended: boolean | null;
} | null;

const ESCAPES = [
  ["coding", "Coding"],
  ["new_idea", "New idea"],
  ["social", "Social"],
  ["video", "Video"],
  ["games", "Games"],
  ["news", "News"],
  ["other", "Other"],
] as const;

/** Nightly check-in ≤ 1 minute (F-LOG-05): ≤ 5 fields, one tap per answer, saves in one request. */
export function CheckinCard({ className, initial, today }: { className?: string; initial: Checkin; today: string }) {
  const [energy, setEnergy] = useState<[number | null, number | null, number | null]>([initial?.energyMorning ?? null, initial?.energyNoon ?? null, initial?.energyNight ?? null]);
  const [blocker, setBlocker] = useState(initial?.blocker ?? "");
  const [escapeMin, setEscapeMin] = useState(initial?.escapeMinutes?.toString() ?? "");
  const [escapeKind, setEscapeKind] = useState<string | null>(initial?.escapeKind ?? null);
  const [klass, setKlass] = useState<boolean | null>(initial?.classAttended ?? null);
  const [saved, setSaved] = useState<string | null>(initial ? "Saved earlier today — edits allowed for 24h" : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<{ ms: number }>("/api/checkin", {
        body: { date: today, energyMorning: energy[0], energyNoon: energy[1], energyNight: energy[2], blocker: blocker || null, escapeMinutes: escapeMin === "" ? null : Number(escapeMin), escapeKind, classAttended: klass },
      });
      setSaved(`Saved in ${r.ms} ms`);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const periods = ["Morning", "Noon", "Night"] as const;

  return (
    <section className={cx("card flex flex-col gap-4", className)} aria-label="Nightly check-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Eyebrow className="text-purple-ink opacity-100">Nightly check-in · 1 minute</Eyebrow>
          <h2 className="mt-1 font-display text-title-l uppercase">How did today feel?</h2>
        </div>
        <Icon name="moonStar" size={30} className="text-purple-ink" />
      </div>
      <form onSubmit={save} className="grid gap-4 lg:grid-cols-2">
        <fieldset className="grid gap-2">
          <legend className="label">Energy (1 = empty · 5 = full)</legend>
          {periods.map((p, i) => (
            <div key={p} className="flex items-center gap-2" role="radiogroup" aria-label={`${p} energy`}>
              <span className="w-16 text-body-s font-bold text-muted">{p}</span>
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={energy[i] === v}
                  onClick={() => setEnergy((e) => e.map((x, j) => (j === i ? (x === v ? null : v) : x)) as typeof energy)}
                  className={cx("h-9 w-9 rounded-full text-body-s font-extrabold transition", energy[i] === v ? "bg-purple text-white" : "bg-surface-2 text-ink hover:bg-line")}
                >
                  {v}
                </button>
              ))}
            </div>
          ))}
          <div className="mt-1 flex items-center gap-2" role="radiogroup" aria-label="Attended class">
            <span className="w-16 text-body-s font-bold text-muted">Class</span>
            {(
              [
                [true, "Yes"],
                [false, "No"],
                [null, "No class"],
              ] as const
            ).map(([v, l]) => (
              <button key={l} type="button" role="radio" aria-checked={klass === v} onClick={() => setKlass(v)} className={cx("chip py-1.5 text-body-s", klass === v ? "bg-purple text-white" : "bg-surface-2 text-ink")}>
                {l}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid content-start gap-3">
          <div>
            <label className="label" htmlFor="blocker">
              Biggest blocker
            </label>
            <input id="blocker" dir="auto" className="field" value={blocker} onChange={(e) => setBlocker(e.target.value)} placeholder="e.g. کلاس طولانی، خستگی…" maxLength={300} />
          </div>
          <div>
            <span className="label">Biggest escape</span>
            <div className="flex flex-wrap gap-1.5">
              {ESCAPES.map(([id, l]) => (
                <button key={id} type="button" aria-pressed={escapeKind === id} onClick={() => setEscapeKind(escapeKind === id ? null : id)} className={cx("chip py-1.5", escapeKind === id ? "bg-coral text-on-color" : "border border-line bg-surface-2 text-ink")}>
                  {l}
                </button>
              ))}
              <input aria-label="Escape minutes" inputMode="numeric" className="field w-24 py-1.5" value={escapeMin} onChange={(e) => setEscapeMin(e.target.value.replace(/\D/g, ""))} placeholder="min" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-accent px-6" disabled={busy}>
              <Icon name="check" size={18} /> Save check-in
            </button>
            {saved && !err && <span className="text-body-s font-semibold text-lime-ink" role="status">{saved}</span>}
            {err && <span className="text-body-s font-semibold text-coral-ink" role="alert">{err}</span>}
          </div>
        </div>
      </form>
    </section>
  );
}
