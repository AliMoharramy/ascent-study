"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow, StatTile } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { formatJalali } from "@/i18n/jalali";
import type { finalView } from "@/server/final";

type V = Awaited<ReturnType<typeof finalView>>;

/** 3-minute box-breathing coach (#112, F-FIN-05): 4-4-4-4 × 11 cycles, calm scale animation, logged on completion. */
function BreathingCoach({ breathing, onDone }: { breathing: V["ascent"]["breathing"]; onDone: (cycles: number, seconds: number) => void }) {
  const cycleSecs = breathing.inhale + breathing.holdIn + breathing.exhale + breathing.holdOut;
  const total = breathing.cycles * cycleSecs;
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (running && elapsed >= total) {
      setRunning(false);
      setDone(true);
      onDone(breathing.cycles, total);
    }
  }, [running, elapsed, total, breathing.cycles, onDone]);

  const within = elapsed % cycleSecs;
  const phase = within < breathing.inhale ? 0 : within < breathing.inhale + breathing.holdIn ? 1 : within < breathing.inhale + breathing.holdIn + breathing.exhale ? 2 : 3;
  const labels = ["Breathe in", "Hold", "Breathe out", "Hold"];
  const bounds = [breathing.inhale, breathing.inhale + breathing.holdIn, breathing.inhale + breathing.holdIn + breathing.exhale, cycleSecs];
  const secsLeft = bounds[phase]! - within;
  const scale = !running ? 0.55 : phase <= 1 ? 1 : 0.55;
  const remain = Math.max(0, total - elapsed);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative flex h-40 w-40 items-center justify-center" aria-hidden="true">
        <div className="absolute inset-0 rounded-full border-2 border-line" />
        <div className="absolute inset-2 rounded-full bg-mint/80" style={{ transform: `scale(${scale})`, transition: running ? `transform ${phase === 0 ? breathing.inhale : phase === 2 ? breathing.exhale : 0.3}s ease-in-out` : "transform .3s ease" }} />
        <span className="relative font-display text-display-m">{running ? secsLeft : "3m"}</span>
      </div>
      <p aria-live="polite" className="text-body font-extrabold">
        {done ? "Done — three calm minutes. Back to the next easy question." : running ? `${labels[phase]} · cycle ${Math.floor(elapsed / cycleSecs) + 1}/${breathing.cycles}` : "Box breathing · 4-4-4-4 · 11 cycles ≈ 3 minutes"}
      </p>
      {running ? (
        <div className="flex items-center gap-3">
          <span className="text-caption text-muted">{Math.floor(remain / 60)}:{String(remain % 60).padStart(2, "0")} left</span>
          <button className="btn-ghost" onClick={() => { setRunning(false); setElapsed(0); }}>Stop</button>
        </div>
      ) : (
        <button className="btn-primary" onClick={() => { setDone(false); setElapsed(0); setRunning(true); }}>{done ? "Breathe again" : "Start breathing"}</button>
      )}
    </div>
  );
}

/** Printable exam-day kit (#104) + Final Ascent mode, last-7 review plan and anxiety toolkit (#112). */
export function FinalClient({ data }: { data: V }) {
  const { toast } = useFeedback();
  const [v, setV] = useState(data);
  useEffect(() => {
    setV(data);
  }, [data]);
  const [busy, setBusy] = useState<string | null>(null);

  async function tick(key: string, done: boolean) {
    setBusy(key);
    setV((old) => ({ ...old, checklist: { ...old.checklist, [key]: done } }));
    try {
      await apiFetch("/api/final", { body: { action: "tick", key, done } });
    } catch (e) {
      toast((e as Error).message, "warn");
      setV(data);
    } finally {
      setBusy(null);
    }
  }

  async function breathDone(cycles: number, seconds: number) {
    try {
      const r = await apiFetch<{ breathsDone: number }>("/api/final", { body: { action: "breath", cycles, seconds } });
      setV((old) => ({ ...old, ascent: { ...old.ascent, breathsDone: r.breathsDone } }));
      toast("Breathing run logged — calm is a skill you just trained.", "ok");
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Exam day" value={formatJalali(v.examDate)} hint={`${v.examDate} · Jalali ${v.examDateJalali}`} />
        <StatTile label="Days left" value={v.daysLeft} tone="purple" hint="The campaign reads the meter — today is just one more rep" />
        <StatTile label="Final-week sleep goal" value={v.sleepPlan.goalHours} unit="h/night" tone="mint" hint={`Program shifts frozen · wake stays ${v.sleepPlan.examDayWake}`} />
      </div>

      {v.ascent.active ? (
        <Card tone="mint" className="print-block flex flex-col gap-2">
          <Eyebrow>Final Ascent · active — review only</Eyebrow>
          <p className="text-body font-bold">The last mile is for storage, not input. Nothing new enters the system now.</p>
          <ul className="grid gap-1 text-body-s">
            {v.ascent.rules.map((r) => (
              <li key={r} className="flex items-start gap-2"><span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />{r}</li>
            ))}
          </ul>
        </Card>
      ) : (
        <p className="no-print text-caption text-muted">Final Ascent mode (review-only, simplified UI) activates automatically in the last 7 days before the exam. The plan below is already derived from your weak points.</p>
      )}

      <Card className="print-block flex flex-col gap-2">
        <Eyebrow>Last-7-days review plan · no new material</Eyebrow>
        <p className="text-caption text-muted">Derived from your weakest chapters and pending review rounds. Overdue rounds land on day 1; the exam eve is pack-and-rest only.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-body-s">
            <thead>
              <tr className="text-caption font-extrabold uppercase tracking-wider text-muted">
                <th className="py-1 pe-3 text-start">Day</th>
                <th className="py-1 pe-3 text-start">Morning</th>
                <th className="py-1 pe-3 text-start">Afternoon</th>
                <th className="py-1 text-start">Evening</th>
              </tr>
            </thead>
            <tbody>
              {v.ascent.reviewPlan.map((d) => (
                <tr key={d.date} className={cx("border-t border-line align-top", d.examEve && "bg-yellow/10")}>
                  <td className="py-1.5 pe-3 whitespace-nowrap font-extrabold">{d.date}{d.examEve ? " · eve" : ""}</td>
                  <td className="py-1.5 pe-3">{d.morning}</td>
                  <td className="py-1.5 pe-3">{d.afternoon}</td>
                  <td className="py-1.5">{d.evening}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="no-print flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={() => window.print()}>Print the playbook</button>
        <p className="text-caption text-muted">Prints clean: navigation and buttons are hidden, sections never split across pages.</p>
      </div>
      <Card className="print-block flex flex-col gap-2">
        <Eyebrow>Last 7 nights · synced with your Sleep Program (week {v.programWeek.week} targets)</Eyebrow>
        <p className="text-caption text-muted">
          No new shifts in the final week. If the program interval is under {v.sleepPlan.goalHours} h, bedtime walks 15 min earlier per night until the goal, then holds. On exam day wake at {v.sleepPlan.examDayWake} — adjust to ~3 h before your official start if the hall demands it.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-body-s">
            <thead>
              <tr className="text-start text-caption font-extrabold uppercase tracking-wider text-muted">
                <th className="py-1 pe-3 text-start">Night</th>
                <th className="py-1 pe-3 text-start">Date</th>
                <th className="py-1 pe-3 text-start">Bed</th>
                <th className="py-1 pe-3 text-start">Wake</th>
                <th className="py-1 pe-3 text-start">Hours</th>
                <th className="py-1 text-start">Note</th>
              </tr>
            </thead>
            <tbody>
              {v.sleepPlan.nights.map((n, i) => (
                <tr key={n.date} className={cx("border-t border-line", i === v.sleepPlan.nights.length - 1 && "bg-yellow/10 font-extrabold")}>
                  <td className="py-1.5 pe-3">−{v.sleepPlan.nights.length - i}</td>
                  <td className="py-1.5 pe-3">{n.date}</td>
                  <td className="py-1.5 pe-3 font-display">{n.bed}</td>
                  <td className="py-1.5 pe-3 font-display">{n.wake}</td>
                  <td className="py-1.5 pe-3">{n.hours}</td>
                  <td className="py-1.5 text-caption">{n.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {v.playbook.map((s) => (
          <Card key={s.key} className="print-block flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Eyebrow>{s.title}</Eyebrow>
              <Chip tone="surface" className="no-print">
                {s.items.filter((_, i) => v.checklist[`${s.key}:${i}`]).length}/{s.items.length}
              </Chip>
            </div>
            <ul className="grid gap-1">
              {s.items.map((item, i) => {
                const key = `${s.key}:${i}`;
                return (
                  <li key={key}>
                    <label className={cx("flex cursor-pointer items-start gap-2 rounded-xl px-3 py-1.5 text-body-s", v.checklist[key] ? "bg-lime/15" : "bg-surface-2")}>
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-purple))]" checked={!!v.checklist[key]} disabled={busy === key} onChange={(e) => tick(key, e.target.checked)} />
                      <span dir="auto">{item}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
      <Card className="no-print flex flex-col gap-4" aria-label="Anxiety toolkit">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Anxiety toolkit · calm in 3 minutes</Eyebrow>
          <Chip tone="surface">{v.ascent.breathsDone} breathing runs logged</Chip>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <BreathingCoach breathing={v.ascent.breathing} onDone={breathDone} />
          <div className="flex flex-col gap-2">
            <p className="text-body-s font-extrabold">5-4-3-2-1 grounding — when the mind races</p>
            <ol className="grid gap-1 text-body-s">
              {v.ascent.grounding.map((g) => (
                <li key={g.sense} className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-1.5">
                  <span className="font-display text-body font-extrabold text-purple-ink">{g.count}</span>
                  <span>{g.prompt}</span>
                </li>
              ))}
            </ol>
            <p className="text-caption text-muted">Then: feet on the floor, one slow breath, the next easy question. Panic is a wave — it passes in minutes.</p>
          </div>
        </div>
      </Card>
      <p className="text-caption text-muted">Not medical advice. The playbook is strategy and ritual — your Sleep Program and Rest Day rules stay in charge of recovery.</p>
    </div>
  );
}