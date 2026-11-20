"use client";

import { useState } from "react";
import { cx, Eyebrow, ProgressBar, type Tone } from "./components";

/**
 * Goal-gradient dashboard (#47, F-INS-08): four progress layers (day / week / realm / campaign) switchable in one
 * click, plus countdowns to the exam and the next boss. The nearest goal is shown first (goal-gradient effect).
 */
export type Layer = { key: string; label: string; value: number; caption: string; tone: Tone };

export function LayeredProgress({ layers, countdowns, className }: { layers: Layer[]; countdowns: { label: string; value: string }[]; className?: string }) {
  const [active, setActive] = useState(0);
  const l = layers[active]!;
  return (
    <section className={cx("card flex flex-col gap-4", className)} aria-label="Progress layers">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>How far to the summit</Eyebrow>
        <div className="flex gap-1 rounded-pill bg-surface-2 p-1" role="tablist" aria-label="Progress layer">
          {layers.map((x, i) => (
            <button key={x.key} role="tab" aria-selected={i === active} onClick={() => setActive(i)} className={cx("rounded-pill px-3 py-1 text-caption font-extrabold", i === active ? "bg-purple text-white" : "text-muted hover:text-ink")}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" aria-label={l.label}>
        <p className="font-display text-display-m leading-none">{Math.round(l.value * 100)}%</p>
        <ProgressBar value={l.value} tone={l.tone} label={`${l.label} progress`} className="mt-2 h-4" />
        <p className="mt-2 text-body-s font-bold text-muted">{l.caption}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {layers.map((x, i) => (
          <button key={x.key} onClick={() => setActive(i)} className="flex flex-col gap-1 rounded-2xl bg-surface-2 p-2 text-start" aria-label={`${x.label}: ${Math.round(x.value * 100)}%`}>
            <span className="text-caption font-extrabold uppercase tracking-wider text-muted">{x.label}</span>
            <ProgressBar value={x.value} tone={x.tone} label={`${x.label} progress`} className="h-1.5" />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {countdowns.map((c) => (
          <span key={c.label} className="chip bg-on-color/90 text-white">
            {c.label}: {c.value}
          </span>
        ))}
      </div>
    </section>
  );
}
