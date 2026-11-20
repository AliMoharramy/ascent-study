"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, cx, Eyebrow, type Tone } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";
import type { wrappedView } from "@/server/wrapped";

type V = Awaited<ReturnType<typeof wrappedView>>;
const TONES: Tone[] = ["yellow", "mint", "coral", "purple", "lime", "surface"];

/** Weekly Wrapped (#98): six shareable slides from real logged data — no AI required. */
export function WrappedClient({ initial, currentWeek }: { initial: V; currentWeek: number }) {
  const { toast } = useFeedback();
  const [v, setV] = useState(initial);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  async function load(week: number) {
    setBusy(true);
    try {
      const r = await apiFetch<V>(`/api/wrapped?week=${week}`);
      setV(r);
      setI(0);
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }
  const slide = v.slides[i]!;
  async function share() {
    const text = `The Ascent · Weekly Wrapped W${v.week}\n` + v.slides.map((s) => `${s.title}: ${s.stat} — ${s.lines.join(" · ")}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Wrapped copied to clipboard — share it anywhere");
    } catch {
      toast("Clipboard unavailable in this browser", "warn");
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Weekly Wrapped · {v.start} → {v.end}</Eyebrow>
        <label className="ms-auto flex items-center gap-2 text-body-s font-bold">
          Week
          <select className="field w-24 py-1" value={v.week} disabled={busy} onChange={(e) => load(Number(e.target.value))}>
            {Array.from({ length: currentWeek }, (_, k) => k + 1).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-ghost" onClick={share}>
          <Icon name="upload" size={15} /> Copy slides
        </button>
      </div>
      <Card tone={TONES[i % TONES.length]} className="flex min-h-72 flex-col justify-between gap-4 p-6">
        <div className="flex items-center justify-between gap-2">
          <p className="text-caption font-extrabold uppercase tracking-widest opacity-70">
            Slide {i + 1}/6 · week {v.week}
            {v.isCurrent ? " (in progress)" : ""}
          </p>
          <p className="font-display text-title-m uppercase opacity-70">{slide.title}</p>
        </div>
        <p className="font-display text-display-l">{slide.stat}</p>
        <ul className="grid gap-1 text-body-s font-bold">
          {slide.lines.map((l, k) => (
            <li key={k} dir="auto">
              {l}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-2">
          <button className="rounded-pill border border-current px-3 py-1.5 font-extrabold disabled:opacity-30" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Previous slide">
            ←
          </button>
          <div className="flex gap-1.5">
            {v.slides.map((s, k) => (
              <button key={s.key} aria-label={`Go to slide ${k + 1}`} aria-current={k === i} onClick={() => setI(k)} className={cx("h-2.5 w-2.5 rounded-full bg-current", k === i ? "opacity-100" : "opacity-30")} />
            ))}
          </div>
          <button className="rounded-pill border border-current px-3 py-1.5 font-extrabold disabled:opacity-30" disabled={i === v.slides.length - 1} onClick={() => setI(i + 1)} aria-label="Next slide">
            →
          </button>
        </div>
      </Card>
      <p className="text-caption text-muted">Built only from your logged focus, tests, closes, sleep and mistakes. Works with AI off; copy the six slides as plain text to share.</p>
    </div>
  );
}