"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";
import { Modal } from "@/ui/Modal";
import type { habitStats } from "@/server/habits";

type H = Awaited<ReturnType<typeof habitStats>>[number];
type Score = { text: string; rating: "+" | "=" | "-"; time: string };
const PILLARS = ["mind", "body", "rest", "craft", "bonds", "learn", "read"] as const;
const TIER_BG = { seed: "bg-mint/60", standard: "bg-lime", stretch: "bg-yellow" } as const;

const blank = { title: "", pillar: "body", identity: "", anchor: "", place: "", timeWindow: "", tiers: { seed: "", standard: "", stretch: "" }, metric: { type: "check", standard: 1 }, temptation: "", envPrep: "", daysPerWeek: 7, contractSs: 0, xp: 10, status: "trial" };

type Vote = { for: number; against: number; today: "for" | "against" | null };
type Identity = { self: Vote; byHabit: Record<string, Vote> };

export function HabitsClient({ habits, scorecard, today, identity, shaping }: { habits: H[]; scorecard: Score[]; today: string; identity: Identity; shaping: { habitId: string; streak: number; propose: number | null; currentTarget: number | null }[] }) {
  const { toast } = useFeedback();
  const router = useRouter();
  const [edit, setEdit] = useState<{ id?: string; h: typeof blank } | null>(null);
  const [score, setScore] = useState<Score[]>(scorecard);
  const [line, setLine] = useState("");
  const [weeks, setWeeks] = useState(false);
  async function vote(habitId: string | null, v: "for" | "against") {
    try {
      await apiFetch("/api/life", { body: { action: "identity", habitId, vote: v } });
      toast(v === "for" ? "Identity vote cast" : "Identity vote recorded");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  async function post(body: Record<string, unknown>, ok?: string) {
    try {
      await apiFetch("/api/habits", { body });
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message, "warn");
      return false;
    }
  }
  const active = habits.filter((h) => h.status === "trial" || h.status === "active");
  const others = habits.filter((h) => !(h.status === "trial" || h.status === "active"));
  const card = (h: H) => (
    <Card key={h.id} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Eyebrow>
            {h.pillar} · {h.status}
            {h.suggested !== h.status && ` → ready for ${h.suggested}`}
          </Eyebrow>
          <p className="text-title-m font-extrabold" dir="auto">
            {h.title}
          </p>
          {h.identity && (
            <p className="text-caption italic text-muted" dir="auto">
              “{h.identity}”
            </p>
          )}
        </div>
        <button className="btn-ghost px-2.5 py-1.5" onClick={() => setEdit({ id: h.id, h: { ...blank, ...h, tiers: h.tiers, metric: h.metric as typeof blank.metric } as typeof blank })} aria-label={`Edit ${h.title}`}>
          <Icon name="gear" size={14} />
        </button>
      </div>
      <p className="rounded-2xl bg-surface-2 px-3 py-2 text-body-s font-bold" dir="auto">
        {h.intention}
      </p>
      {shaping.find((s) => s.habitId === h.id && s.propose != null) && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-mint/25 px-3 py-2 text-body-s">
          <b>{shaping.find((s) => s.habitId === h.id)!.streak} successful days in a row.</b>
          <span>
            Shape up: {shaping.find((s) => s.habitId === h.id)!.currentTarget} → {shaping.find((s) => s.habitId === h.id)!.propose} (+5%, at least +1).
          </span>
          <button
            className="btn-ghost px-2.5 py-1"
            onClick={async () => {
              if (await post({ action: "shaping_accept", id: h.id }, "Target shaped up — keep the streak")) router.refresh();
            }}
          >
            Accept step
          </button>
        </div>
      )}
      {weeks ? (
        <div className="flex gap-1" role="img" aria-label="Last 12 weeks">
          {h.weeks.map((w) => (
            <div key={w.start} className="flex flex-1 flex-col gap-1" title={`Week of ${w.start}: ${w.done} done`}>
              {w.cells.map((c) => (
                <span key={c.d} title={`${c.d}: ${c.tier ?? "—"}`} className={cx("aspect-square w-full rounded-sm", c.tier ? TIER_BG[c.tier] : "bg-surface-2")} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }} role="img" aria-label="Last 28 days">
          {h.heat.map((c) => (
            <span key={c.d} title={`${c.d}: ${c.tier ?? "—"}`} className={cx("aspect-square rounded-md", c.tier ? TIER_BG[c.tier] : "bg-surface-2")} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-caption font-extrabold">
        <span>7d {Math.round(h.c7 * 100)}%</span>
        <span>30d {Math.round(h.c30 * 100)}%</span>
        <span>Seed→Standard {Math.round(h.seedToStandard * 100)}%</span>
        {h.contractSs < 0 && <Chip tone="coral">Contract {h.contractSs} SS</Chip>}
        <span className="flex items-center gap-1">
          identity
          <button className={cx("rounded-full px-1.5 py-0.5", identity.byHabit[h.id]?.today === "for" ? "bg-lime text-on-color" : "bg-surface-2")} onClick={() => vote(h.id, "for")} aria-label={`Vote for ${h.title} as identity`} aria-pressed={identity.byHabit[h.id]?.today === "for"}>
            +{identity.byHabit[h.id]?.for ?? 0}
          </button>
          <button className={cx("rounded-full px-1.5 py-0.5", identity.byHabit[h.id]?.today === "against" ? "bg-coral text-on-color" : "bg-surface-2")} onClick={() => vote(h.id, "against")} aria-label={`Vote against ${h.title} as identity`} aria-pressed={identity.byHabit[h.id]?.today === "against"}>
            −{identity.byHabit[h.id]?.against ?? 0}
          </button>
        </span>
      </div>
      {(h.status === "trial" || h.status === "active") && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Log ${h.title} today`}>
          {(["seed", "standard", "stretch"] as const).map((t) => (
            <button key={t} title={h.tiers[t]} aria-pressed={h.today === t} onClick={() => post({ action: "log", id: h.id, tier: h.today === t ? null : t, day: today })} className={cx("chip py-1.5 capitalize", h.today === t ? "bg-purple text-white" : "border border-line bg-surface-2 text-ink")}>
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-caption">
        {h.status !== "archived" && (
          <button className="underline" onClick={() => post({ action: "status", id: h.id, status: "archived" }, "Archived")}>
            Archive
          </button>
        )}
        {(h.status === "proposed" || h.status === "archived") && (
          <button className="underline" onClick={() => post({ action: "status", id: h.id, status: "trial" }, "Trial started (14 days, no penalties)")}>
            Start trial
          </button>
        )}
        {h.suggested !== h.status && (
          <button className="font-bold text-purple-ink underline" onClick={() => post({ action: "status", id: h.id, status: h.suggested }, `Moved to ${h.suggested}`)}>
            Promote to {h.suggested}
          </button>
        )}
      </div>
    </Card>
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    if (await post({ action: "save", id: edit.id, habit: edit.h }, "Habit saved")) setEdit(null);
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-accent" onClick={() => setEdit({ h: { ...blank } })}>
          <Icon name="plus" size={14} /> New habit
        </button>
        <button className="btn-ghost" onClick={() => setWeeks((x) => !x)} aria-pressed={weeks}>
          {weeks ? "Last 28 days" : "Last 12 weeks"}
        </button>
        <div className="flex items-center gap-1.5 rounded-2xl bg-surface-1 px-3 py-1.5 text-caption font-bold">
          I am someone who keeps promises
          <button className={cx("rounded-full px-2 py-0.5", identity.self.today === "for" ? "bg-lime text-on-color" : "bg-surface-2")} onClick={() => vote(null, "for")} aria-pressed={identity.self.today === "for"}>
            +{identity.self.for}
          </button>
          <button className={cx("rounded-full px-2 py-0.5", identity.self.today === "against" ? "bg-coral text-on-color" : "bg-surface-2")} onClick={() => vote(null, "against")} aria-pressed={identity.self.today === "against"}>
            −{identity.self.against}
          </button>
        </div>
      </div>
      <p className="text-caption text-muted">Max 7 active habits. Trial = 14 days without penalties. Mastered = 66+ days at ≥ 80 % consistency. Identity votes are a ledger of evidence, never a score penalty.</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{active.map(card)}</div>
      {others.length > 0 && (
        <>
          <Eyebrow>Proposed · mastered · archived</Eyebrow>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{others.map(card)}</div>
        </>
      )}
      <Card className="flex flex-col gap-3">
        <Eyebrow>Habit Scorecard (baseline week) — current behaviours rated + / = / −</Eyebrow>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!line.trim()) return;
            const next = [...score, { text: line.trim(), rating: "=" as const, time: "" }];
            if (await post({ action: "scorecard", items: next })) {
              setScore(next);
              setLine("");
            }
          }}
        >
          <input className="field" dir="auto" value={line} onChange={(e) => setLine(e.target.value)} placeholder="e.g. Check phone right after waking" aria-label="Behaviour" />
          <button className="btn-ghost">Add</button>
        </form>
        <ul className="flex flex-col gap-1.5">
          {score.map((s, i) => (
            <li key={i} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5 text-body-s">
              <span className="flex-1" dir="auto">
                {s.text}
              </span>
              {(["+", "=", "-"] as const).map((r) => (
                <button
                  key={r}
                  aria-pressed={s.rating === r}
                  onClick={async () => {
                    const next = score.map((x, j) => (j === i ? { ...x, rating: r } : x));
                    if (await post({ action: "scorecard", items: next })) setScore(next);
                  }}
                  className={cx("h-7 w-7 rounded-full font-black", s.rating === r ? (r === "+" ? "bg-lime text-on-color" : r === "-" ? "bg-coral text-on-color" : "bg-line") : "border border-line")}
                >
                  {r}
                </button>
              ))}
            </li>
          ))}
        </ul>
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit habit" : "New habit"} wide>
        {edit && (
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["title", "Title"],
                ["identity", "Identity (“I am someone who…”)"],
                ["anchor", "When — anchor (after …)"],
                ["timeWindow", "…or time window (05:45–07:00)"],
                ["place", "Where"],
                ["temptation", "Temptation bundle"],
                ["envPrep", "Environment prep (night before)"],
              ] as const
            ).map(([k, l]) => (
              <label key={k}>
                <span className="label">{l}</span>
                <input className="field" dir="auto" value={edit.h[k]} onChange={(e) => setEdit({ ...edit, h: { ...edit.h, [k]: e.target.value } })} />
              </label>
            ))}
            <label>
              <span className="label">Pillar</span>
              <select className="field" value={edit.h.pillar} onChange={(e) => setEdit({ ...edit, h: { ...edit.h, pillar: e.target.value } })}>
                {PILLARS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            {(["seed", "standard", "stretch"] as const).map((t) => (
              <label key={t}>
                <span className="label">{t} {t === "seed" && "(2-minute version)"}</span>
                <input className="field" dir="auto" value={edit.h.tiers[t]} onChange={(e) => setEdit({ ...edit, h: { ...edit.h, tiers: { ...edit.h.tiers, [t]: e.target.value } } })} />
              </label>
            ))}
            <label>
              <span className="label">Days per week</span>
              <input type="number" min={1} max={7} className="field" value={edit.h.daysPerWeek} onChange={(e) => setEdit({ ...edit, h: { ...edit.h, daysPerWeek: Number(e.target.value) } })} />
            </label>
            <label>
              <span className="label">Contract (SS if missed, 0 = none)</span>
              <input type="number" min={-20} max={0} className="field" value={edit.h.contractSs} onChange={(e) => setEdit({ ...edit, h: { ...edit.h, contractSs: Number(e.target.value) } })} />
            </label>
            <label>
              <span className="label">Status</span>
              <select className="field" value={edit.h.status} onChange={(e) => setEdit({ ...edit, h: { ...edit.h, status: e.target.value } })}>
                {["proposed", "trial", "active", "mastered", "archived"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <p className="text-caption text-muted sm:col-span-2">Implementation Intention: “I will [standard] at/after [anchor] in [place]”. When, where and the Seed are required for trial/active habits.</p>
            <button className="btn-accent justify-self-start">Save</button>
          </form>
        )}
      </Modal>
    </div>
  );
}
