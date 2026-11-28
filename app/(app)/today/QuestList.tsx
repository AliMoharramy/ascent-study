"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { cx } from "@/ui/components";
import { Icon } from "@/ui/icons";
import { useFeedback } from "@/ui/feedback";

export type QuestItem = {
  id: string;
  kind: string;
  title: string;
  whenText: string | null;
  tiers: Record<"seed" | "standard" | "stretch", string>;
  target: { metric: string; seed: number; standard: number; stretch: number };
  tierDone: "seed" | "standard" | "stretch" | null;
  progress: number;
  status: string;
  habitId: string | null;
};

const TIERS = ["seed", "standard", "stretch"] as const;

/** Daily Fixed / Pillars / Comeback list (S01). Habit quests are ticked here at a tier; study quests fill from logs. */
export function QuestList({ quests, title, tone = "surface", compact = false, className }: { quests: QuestItem[]; title: string; tone?: "surface" | "lime"; compact?: boolean; className?: string }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  async function tick(q: QuestItem, t: (typeof TIERS)[number] | null) {
    setBusy(q.id);
    try {
      await apiFetch(`/api/quests/${q.id}`, { body: { tier: t } });
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className={cx(compact ? "flex min-w-0 flex-col gap-3" : "card flex flex-col gap-3", tone === "lime" && "bg-lime text-on-color", className)} aria-label={title}>
      <h3 className="text-caption font-extrabold uppercase tracking-[0.14em]">{title}</h3>
      {quests.length === 0 && <p className="text-body-s text-muted">No active quests in this group today.</p>}
      <ul className="flex flex-col gap-2">
        {quests.map((q) => {
          const manual = !!q.habitId || q.target.metric === "check";
          const pct = q.target.metric === "count" && q.habitId ? null : Math.min(1, q.progress / Math.max(1, q.target.standard));
          return (
            <li key={q.id} className={cx("min-w-0 rounded-2xl p-3", tone === "lime" ? "bg-on-color/10" : "bg-surface-2")}>
              <div className="flex items-start gap-3">
                <span className={cx("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2", q.tierDone ? "border-lime bg-lime text-on-color" : "border-line")} aria-hidden="true">
                  {q.tierDone && <Icon name="check" size={13} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold" dir="auto">
                    {q.kind === "comeback" && <span className="chip me-1 bg-coral text-on-color">Comeback</span>}
                    {q.title}
                  </p>
                  <p className="text-caption opacity-70" dir="auto">
                    {q.whenText ? `${q.whenText} · ` : ""}
                    {q.tierDone ? `${q.tierDone}: ${q.tiers[q.tierDone]}` : `Seed: ${q.tiers.seed}`}
                  </p>
                  {pct !== null && !manual && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-on-color/10" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${q.title} progress`}>
                      <div className="h-full rounded-pill bg-purple" style={{ width: `${pct * 100}%` }} />
                    </div>
                  )}
                </div>
                {pct !== null && !manual && (
                  <span className="shrink-0 text-caption font-extrabold">
                    {Math.round(q.progress)}/{q.target.standard}
                  </span>
                )}
              </div>
              {manual && q.status === "open" && (
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Mark ${q.title}`}>
                  {TIERS.map((t) => (
                    <button key={t} type="button" disabled={busy === q.id} aria-pressed={q.tierDone === t} onClick={() => tick(q, q.tierDone === t ? null : t)} className={cx("chip py-1 capitalize", q.tierDone === t ? "bg-purple text-white" : "border border-line bg-surface-1 text-ink")} title={q.tiers[t]}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
