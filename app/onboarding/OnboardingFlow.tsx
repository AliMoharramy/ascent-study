"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, requestId } from "@/ui/client";
import { cx, Eyebrow, ProgressBar } from "@/ui/components";
import { Icon } from "@/ui/icons";
import type { XpSummary } from "@/events/projections";

const GOALS = [
  { tier: "seed", minutes: 30, label: "Seed", note: "30 min a day — a start you can't fail" },
  { tier: "standard", minutes: 120, label: "Standard", note: "2 hours of focus a day" },
  { tier: "stretch", minutes: 240, label: "Stretch", note: "4 hours — the deep-work days" },
] as const;

/** Four short steps, no long forms: ≤ 2 minutes to the first XP and the first lit node. Re-runnable. */
export function OnboardingFlow({ daysLeft, examFa, rerun, goal }: { daysLeft: number; examFa: string; rerun: boolean; goal: number | null }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [g, setG] = useState<(typeof GOALS)[number]>(GOALS.find((x) => x.minutes === goal) ?? GOALS[1]);
  const [ok, setOk] = useState({ exam: true, la: true });
  const [t, setT] = useState({ correct: "", wrong: "", blank: "" });
  const [xp, setXp] = useState<XpSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function saveGoal() {
    setErr(null);
    try {
      await apiFetch("/api/reviews", { body: { action: "goal", minutes: g.minutes, tier: g.tier } });
      setStep(2);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function firstQuest(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const n = (v: string) => Number(v || 0);
      const r = await apiFetch<{ xp: XpSummary }>("/api/tests", { body: { subjectId: "foundations", correct: n(t.correct), wrong: n(t.wrong), blank: n(t.blank), clientRequestId: requestId() } });
      setXp(r.xp);
      setStep(3);
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }
  async function finish() {
    await apiFetch("/api/reviews", { body: { action: "onboarding" } }).catch(() => null);
    router.push("/today");
    router.refresh();
  }

  const total = Number(t.correct || 0) + Number(t.wrong || 0) + Number(t.blank || 0);

  return (
    <div className="w-full max-w-xl">
      <ProgressBar value={(step + 1) / 4} tone="yellow" label="Onboarding progress" className="mb-4" />
      {step === 0 && (
        <section className="card-color animate-pop bg-yellow">
          <Eyebrow>Ch.1 · The Awakening {rerun && "· replay"}</Eyebrow>
          <h1 className="mt-3 font-display text-display-l uppercase leading-[0.92]">The fog is thick.</h1>
          <p className="mt-3 text-body font-semibold">
            From where you stand the Summit is invisible. There is only one path — and today, only one step. {daysLeft} days to the Great Exam.
          </p>
          <p className="fa mt-2 text-body font-bold" lang="fa" dir="rtl">
            مه غلیظ است. فقط یک مسیر هست — و امروز فقط یک گام.
          </p>
          <button className="btn-primary mt-6" onClick={() => setStep(1)} autoFocus>
            Take the first step <Icon name="arrow" size={16} />
          </button>
        </section>
      )}
      {step === 1 && (
        <section className="card animate-pop flex flex-col gap-4">
          <Eyebrow>Confirm the decisions</Eyebrow>
          <label className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[rgb(var(--c-purple))]" checked={ok.exam} onChange={(e) => setOk({ ...ok, exam: e.target.checked })} />
            <span>
              <b>Exam: 16 Ordibehesht 1406</b> <span className="fa text-muted">({examFa})</span> — 25 weeks, Saturday-based.
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[rgb(var(--c-purple))]" checked={ok.la} onChange={(e) => setOk({ ...ok, la: e.target.checked })} />
            <span>
              <b>Linear algebra is dropped</b> — in mock exams it counts as an intentional skip, not a weakness.
            </span>
          </label>
          <fieldset>
            <legend className="label">Daily goal (you can change it any time)</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {GOALS.map((x) => (
                <button key={x.tier} type="button" aria-pressed={g.tier === x.tier} onClick={() => setG(x)} className={cx("rounded-3xl p-3 text-start", g.tier === x.tier ? "bg-purple text-white" : "bg-surface-2")}>
                  <span className="block font-display text-title-l uppercase">{x.label}</span>
                  <span className="text-caption font-bold">{x.note}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <button className="btn-accent self-start" disabled={!ok.exam || !ok.la} onClick={saveGoal}>
            I commit <Icon name="check" size={16} />
          </button>
        </section>
      )}
      {step === 2 && (
        <form onSubmit={firstQuest} className="card-color animate-pop flex flex-col gap-4 bg-mint">
          <Eyebrow>Your first Seed quest</Eyebrow>
          <h2 className="font-display text-display-m uppercase leading-none">Solve 3 foundations tests</h2>
          <p className="text-body-s font-semibold">Open any test book now, do three, then type the result. Two minutes. That&apos;s the whole quest.</p>
          <div className="grid grid-cols-3 gap-2">
            {(["correct", "wrong", "blank"] as const).map((k) => (
              <label key={k} className="flex flex-col rounded-2xl bg-on-color/90 px-3 py-2 text-white">
                <span className="text-caption font-extrabold uppercase opacity-70">{k}</span>
                <input inputMode="numeric" className="bg-transparent font-display text-display-m outline-none" value={t[k]} onChange={(e) => setT({ ...t, [k]: e.target.value.replace(/\D/g, "") })} placeholder="0" aria-label={k} />
              </label>
            ))}
          </div>
          <button className="btn-primary self-start" disabled={total < 1}>
            Log it
          </button>
          <button type="button" className="text-body-s font-bold underline" onClick={finish}>
            Skip — I&apos;ll start from Today
          </button>
        </form>
      )}
      {step === 3 && (
        <section className="card animate-pop flex flex-col items-center gap-4 text-center">
          <Eyebrow>First light</Eyebrow>
          <svg viewBox="0 0 200 120" className="w-64" role="img" aria-label="Your first node is lit on the world map">
            <path d="M10 100 C60 90 80 60 110 64 S170 40 190 20" fill="none" stroke="rgb(var(--border))" strokeWidth="4" strokeDasharray="6 8" />
            {[30, 70, 110, 150].map((x, i) => (
              <circle key={x} cx={x} cy={[96, 80, 64, 40][i]} r="9" fill={i === 0 ? "rgb(var(--c-yellow))" : "rgb(var(--surface-2))"} stroke="rgb(var(--border))" strokeWidth="2" className={i === 0 ? "node-light" : ""} />
            ))}
          </svg>
          <p className="font-display text-display-l leading-none text-yellow-ink">+{xp ? xp.todayXp : 0} XP</p>
          <p className="text-body font-bold">The first node is lit. Nothing else is required today — but the Core quest is waiting if you want it.</p>
          <button className="btn-primary" onClick={finish} autoFocus>
            Enter Today <Icon name="arrow" size={16} />
          </button>
        </section>
      )}
      {err && (
        <p role="alert" className="mt-3 rounded-2xl bg-coral px-4 py-2 text-body-s font-bold text-on-color">
          {err}
        </p>
      )}
    </div>
  );
}
