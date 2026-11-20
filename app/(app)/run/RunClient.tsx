"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/ui/client";
import { BigNumberResultCard, Card, Chip, Eyebrow, InsightCard, ProgressBar, SectionPerformance, StreakCard } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { MascotSlot } from "@/ui/Mascot";

type Subject = { id: string; name: string };
type Draft = { correct: string; wrong: string; blank: string };
type Logged = { subjectId: string; correct: number; wrong: number; blank: number; netPct: number };

const EMPTY: Draft = { correct: "0", wrong: "0", blank: "0" };

/** F-DUO-11/12: 10–15 minute mini-run, one log per section, then the reference-style result screen. */
export function RunClient({ subjects, flame, todayXpAtStart, mascots }: { subjects: Subject[]; flame: number; todayXpAtStart: number; mascots: boolean }) {
  const { toast, celebrate } = useFeedback();
  const [phase, setPhase] = useState<"setup" | "active" | "result">("setup");
  // pinned on mount: the global XP refresh re-renders this page with a new starting prop mid-run
  const [xpAtStart] = useState(todayXpAtStart);
  const [picked, setPicked] = useState<string[]>(subjects.slice(0, 3).map((s) => s.id));  const [minutes, setMinutes] = useState(12);
  const [runId, setRunId] = useState("");
  const [left, setLeft] = useState(0);
  const [paused, setPaused] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [logs, setLogs] = useState<Logged[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [xpNow, setXpNow] = useState<number | null>(null);
  const celebrated = useRef(false);

  const finish = useCallback(() => {
    if (!logs.length) {
      toast("Log at least one section before finishing", "warn");
      setPaused(true);
      setLeft(60);
      return;
    }
    setPhase("result");
  }, [logs, toast]);

  useEffect(() => {
    if (phase !== "active" || paused) return;
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, [phase, paused]);

  useEffect(() => {
    if (phase === "active" && left === 0) finish();
  }, [phase, left, finish]);

  useEffect(() => {
    if (phase === "result" && !celebrated.current) {
      celebrated.current = true;
      celebrate(logs.some((l) => l.netPct >= 60) ? "Mini-run complete — strong session!" : "Mini-run complete — every honest log counts");
    }
  }, [phase, logs, celebrate]);

  function start() {
    if (!picked.length) {
      toast("Pick at least one subject", "warn");
      return;
    }
    setRunId(crypto.randomUUID());
    setLeft(minutes * 60);
    setPaused(false);
    setLogs([]);
    setDrafts({});
    setXpNow(null);
    celebrated.current = false;
    setPhase("active");
  }

  function setDraft(id: string, key: keyof Draft, value: string) {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? EMPTY), [key]: value.replace(/\D/g, "") } }));
  }

  async function logSection(s: Subject) {
    const d = drafts[s.id] ?? EMPTY;
    const correct = Number(d.correct || 0);
    const wrong = Number(d.wrong || 0);
    const blank = Number(d.blank || 0);
    if (correct + wrong + blank === 0) {
      toast("Enter at least one answer", "warn");
      return;
    }
    setSaving(s.id);
    try {
      const r = await apiFetch<{ log: { netPct: number }; xp: { todayXp: number } }>("/api/tests", {
        body: { subjectId: s.id, correct, wrong, blank, note: "Mini-run", clientRequestId: `run-${runId}-${s.id}` },
      });
      setLogs((l) => [...l, { subjectId: s.id, correct, wrong, blank, netPct: r.log.netPct }]);
      setXpNow(r.xp.todayXp);
      toast(`${s.name} logged · ${Math.round(r.log.netPct)}% net`);
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setSaving(null);
    }
  }

  const totalQ = logs.reduce((n, l) => n + l.correct + l.wrong + l.blank, 0);
  const correct = logs.reduce((n, l) => n + l.correct, 0);
  const overall = totalQ ? logs.reduce((n, l) => n + l.netPct * (l.correct + l.wrong + l.blank), 0) / totalQ : 0;
  const sessionXp = Math.max(0, Math.round(((xpNow ?? xpAtStart) - xpAtStart) * 10) / 10);
  const weakest = [...logs].sort((a, b) => a.netPct - b.netPct)[0];
  const weakestSubject = subjects.find((s) => s.id === weakest?.subjectId);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  if (phase === "setup") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Card tone="mint" className="flex flex-col gap-3">
          <Eyebrow>Mini-run (F-DUO-11)</Eyebrow>
          <h2 className="font-display text-display-m uppercase leading-none">12 honest minutes</h2>
          <p className="text-body-s opacity-80">A short mixed set: log each section when you finish it, then see the result screen. Counts only — no questions are stored.</p>
          <div className="flex flex-wrap gap-2">
            {[10, 12, 15].map((m) => (
              <button key={m} onClick={() => setMinutes(m)} className={m === minutes ? "chip bg-on-color text-white" : "chip border border-line bg-surface-2 text-ink"}>
                {m} min
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {subjects.map((s) => {
              const on = picked.includes(s.id);
              return (
                <button key={s.id} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))} className={on ? "chip bg-purple text-white" : "chip border border-line bg-surface-2 text-ink"}>
                  {s.name}
                </button>
              );
            })}
          </div>
          <button className="btn-accent w-fit" onClick={start}>
            Start run
          </button>
        </Card>
        <Card className="flex items-center justify-between gap-4">
          <div>
            <Eyebrow>Before you start</Eyebrow>
            <ul className="mt-2 grid gap-1 text-body-s">
              <li>• Phone away, one subject at a time.</li>
              <li>• Wrong answers are data, not failure.</li>
              <li>• Finish a section, log it, move on.</li>
            </ul>
          </div>
          <MascotSlot character="hero" state="thinking" size="md" enabled={mascots} />
        </Card>
      </div>
    );
  }

  if (phase === "active") {
    const pctLeft = left / Math.max(1, minutes * 60);
    return (
      <div className="flex flex-col gap-4">
        <Card tone="yellow" className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Eyebrow>Mini-run · {minutes} min</Eyebrow>
            <p className="font-display text-display-l leading-none tabular-nums" aria-live="off">
              {mm}:{ss}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn bg-white text-on-color" onClick={() => setPaused((p) => !p)}>
              {paused ? "Resume" : "Pause"}
            </button>
            <button className="btn-primary" onClick={finish} disabled={!logs.length}>
              Finish run
            </button>
          </div>
          <ProgressBar className="mt-1 basis-full [&>div]:bg-on-color" value={1 - pctLeft} tone="surface" label="Run progress" />
        </Card>

        <div className="grid gap-3 md:grid-cols-2">
          {subjects
            .filter((s) => picked.includes(s.id))
            .map((s) => {
              const logged = logs.find((l) => l.subjectId === s.id);
              const d = drafts[s.id] ?? EMPTY;
              return (
                <Card key={s.id} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-title-m font-extrabold">{s.name}</p>
                    {logged ? <Chip tone="lime">{Math.round(logged.netPct)}% net</Chip> : <Chip>not logged</Chip>}
                  </div>
                  {logged ? (
                    <p className="text-body-s text-muted">
                      {logged.correct} correct · {logged.wrong} wrong · {logged.blank} blank
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        {(["correct", "wrong", "blank"] as const).map((k) => (
                          <label key={k} className="flex flex-col gap-1">
                            <span className="label capitalize">{k}</span>
                            <input className="field tabular-nums" inputMode="numeric" value={d[k]} onChange={(e) => setDraft(s.id, k, e.target.value)} />
                          </label>
                        ))}
                      </div>
                      <button className="btn-ghost w-fit" disabled={saving === s.id} onClick={() => logSection(s)}>
                        {saving === s.id ? "Saving…" : "Log section"}
                      </button>
                    </>
                  )}
                </Card>
              );
            })}
        </div>
        {paused && <p className="text-body-s font-bold text-muted">Paused — the timer is stopped.</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-2">
        <BigNumberResultCard
          pct={overall}
          label={`Mini-run · ${minutes} min`}
          detail={`${correct} / ${totalQ} correct · +${sessionXp} XP${weakest && weakest.netPct < 60 ? " · mistakes worth reviewing" : ""}`}
          mascot={<MascotSlot character="archie" state="cheering" size="md" enabled={mascots} />}
        />
      </div>
      <StreakCard days={flame} kept hint="Today's session logged — the day counts." />
      <SectionPerformance items={logs.map((l) => ({ name: subjects.find((s) => s.id === l.subjectId)?.name ?? l.subjectId, pct: l.netPct, detail: `${l.correct}/${l.correct + l.wrong + l.blank}` }))} />
      <InsightCard
        title={weakestSubject ? `10 minutes in the Forge on ${weakestSubject.name}` : "Keep the next run short"}
        href={weakestSubject ? `/forge?subject=${weakestSubject.id}` : "/forge"}
      >
        {weakestSubject ? `Weakest section: ${Math.round(weakest?.netPct ?? 0)}% net. Log the causes while they are fresh.` : "Log a section next time to unlock a targeted insight."}
      </InsightCard>
      <div className="flex flex-col gap-2">
        <button
          className="btn-ghost"
          onClick={() => {
            setPhase("setup");
            setLogs([]);
            setDrafts({});
            setXpNow(null);
          }}
        >
          Run again
        </button>
        <Link href="/today" className="btn-ghost text-center">
          Back to Today
        </Link>
      </div>
    </div>
  );
}
