"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { answeredCount, applyMark, clock, examCounts, examNet, suspectCount, type ExamMark, type ExamMode } from "@/domain/exam";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";

export type ExamMock = {
  no: number;
  dateJalali: string;
  questions: number;
  minutes: number;
  budget: Record<string, { questions: number }>;
  results: { id: string; netPct: number; netPctNoSkip: number; gameDay: string }[];
};
type Subject = { id: string; name: string; skipped: boolean };

const MODES: { key: ExamMode; label: string; hint: string }[] = [
  { key: "correct", label: "✓ Correct", hint: "click a cell to mark it correct" },
  { key: "wrong", label: "✗ Wrong", hint: "click a cell to mark it wrong" },
  { key: "suspect", label: "? Suspect", hint: "flag a question to revisit — never changes the score" },
  { key: "clear", label: "Clear", hint: "clear the answer and the suspect flag" },
];

/**
 * Exam simulator (#66, F-LRN-01): a real-exam clock, a per-subject answer sheet and an exact negative-marking
 * score. Only counts leave the browser — the app never stores a question (C18).
 */
export function ExamSimulator({ mocks, subjects }: { mocks: ExamMock[]; subjects: Subject[] }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const first = mocks.find((m) => m.results.length === 0) ?? mocks[0];
  const [mockNo, setMockNo] = useState<number | null>(first?.no ?? null);
  const [phase, setPhase] = useState<"setup" | "running" | "finished">("setup");
  const [remaining, setRemaining] = useState((first?.minutes ?? 0) * 60);
  const [marks, setMarks] = useState<Record<string, ExamMark>>({});
  const [suspects, setSuspects] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<ExamMode>("correct");
  const [busy, setBusy] = useState(false);
  const deadline = useRef<number | null>(null);
  const mock = mocks.find((m) => m.no === mockNo) ?? null;
  const skip = useMemo(() => new Set(subjects.filter((s) => s.skipped).map((s) => s.id)), [subjects]);
  const rows = useMemo(() => (mock ? Object.entries(mock.budget).filter(([id, b]) => b.questions > 0 && !skip.has(id)) : []), [mock, skip]);
  const totalQuestions = rows.reduce((n, [, b]) => n + b.questions, 0);

  useEffect(() => {
    if (phase !== "running") return;
    const tick = () => {
      const left = Math.max(0, Math.round(((deadline.current ?? 0) - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setPhase("finished");
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "running") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input,select,textarea")) return;
      const next = ({ "1": "correct", "2": "wrong", "3": "suspect", "0": "clear" } as const)[e.key as "1"];
      if (next) {
        e.preventDefault();
        setMode(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  const allMarks = useMemo(() => rows.flatMap(([id, b]) => Array.from({ length: b.questions }, (_, i) => marks[`${id}:${i}`] ?? "blank")), [rows, marks]);
  const allSuspects = useMemo(() => rows.flatMap(([id, b]) => Array.from({ length: b.questions }, (_, i) => !!suspects[`${id}:${i}`])), [rows, suspects]);
  const counts = examCounts(allMarks);
  const net = examNet(allMarks);
  const answered = answeredCount(allMarks);
  const flagged = suspectCount(allSuspects);

  function start() {
    if (!mock) return;
    setMarks({});
    setSuspects({});
    setMode("correct");
    setRemaining(mock.minutes * 60);
    deadline.current = Date.now() + mock.minutes * 60_000;
    setPhase("running");
    void navigator.vibrate?.(15);
  }

  function markCell(key: string) {
    const m = applyMark(marks[key] ?? "blank", !!suspects[key], mode);
    setMarks((x) => ({ ...x, [key]: m.mark }));
    setSuspects((x) => ({ ...x, [key]: m.suspect }));
  }

  async function submit() {
    if (!mock || busy) return;
    if (phase === "running" && counts.blank > 0 && !confirm(`${counts.blank} question(s) are still blank. Submit the exam?`)) return;
    setBusy(true);
    try {
      const perSubject = Object.fromEntries(
        rows.map(([id, b]) => {
          const cells = Array.from({ length: b.questions }, (_, i) => marks[`${id}:${i}`] ?? "blank");
          return [id, examCounts(cells)];
        }),
      );
      const r = await apiFetch<{ result: { netPct: number; netPctNoSkip: number; beatShadow: boolean; suspects: number } }>("/api/arena", {
        body: { action: "mock", mockNo: mock.no, perSubject, suspects: flagged, elapsedSec: mock.minutes * 60 - remaining, mode: "exam" },
      });
      setPhase("finished");
      toast(`Mock ${mock.no} saved: ${r.result.netPctNoSkip}% net without linear algebra${r.result.beatShadow ? " — you beat the Shadow!" : ""}`);
      router.push("/arena");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }

  if (!mock) {
    return (
      <Card className="text-body-s text-muted">
        No mock exams found. Import the reference data first (<code>npm run db:seed</code>).
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className="label">Mock exam</span>
            <select className="field min-w-52" value={mockNo ?? ""} onChange={(e) => setMockNo(Number(e.target.value))} disabled={phase === "running"}>
              {mocks.map((m) => (
                <option key={m.no} value={m.no}>
                  Mock {m.no} · {m.dateJalali} · {m.questions} Q / {m.minutes} min
                  {m.results.length ? " · logged" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 pb-1">
            <Chip tone="surface">{totalQuestions} questions</Chip>
            <Chip tone="surface">{mock.minutes} minutes</Chip>
            {rows.some(([id]) => skip.has(id)) && <Chip tone="yellow">Linear algebra is an intentional skip</Chip>}
          </div>
        </div>
        {phase === "setup" ? (
          <button className="btn-accent" onClick={start} disabled={totalQuestions === 0}>
            <Icon name="play" size={18} /> Start timed exam
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <div className={cx("rounded-2xl px-4 py-2 text-center font-mono text-title-m font-black tabular-nums", remaining === 0 ? "bg-coral text-on-color" : "bg-on-color text-white")} role="timer" aria-live="off">
              {clock(remaining)}
            </div>
            <button className="btn-primary" onClick={submit} disabled={busy || phase === "finished"}>
              <Icon name="check" size={18} /> {busy ? "Saving…" : "Finish & save"}
            </button>
          </div>
        )}
      </Card>

      {phase === "setup" && (
        <Card className="flex flex-col gap-2 text-body-s">
          <Eyebrow>Exam protocol</Eyebrow>
          <p>
            Mark every question as you answer: <b>✓ correct</b>, <b>✗ wrong</b> or leave it blank. Use <b>? suspect</b> for questions to revisit — suspect marks are recorded separately and never change your net score.
          </p>
          <p className="text-muted">The clock starts only when you press Start. The score uses negative marking: correct − wrong ÷ 3, over every question in the exam. Keyboard: 1 correct · 2 wrong · 3 suspect · 0 clear.</p>
          <p className="text-muted">{mock.results.length ? `This mock already has ${mock.results.length} saved result(s); saving again adds another attempt.` : "No result saved for this mock yet."}</p>
        </Card>
      )}

      <Card className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Eyebrow>Marking mode</Eyebrow>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Marking mode">
          {MODES.map((m) => (
            <button key={m.key} className={cx("btn border-2 px-3 py-1.5 text-body-s", mode === m.key ? "border-purple bg-purple text-white" : "border-line text-ink")} aria-pressed={mode === m.key} onClick={() => setMode(m.key)} disabled={phase === "finished"} title={m.hint}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="ms-auto flex flex-wrap gap-2 text-body-s font-extrabold">
          <span>{answered}/{totalQuestions} answered</span>
          <span className="text-lime-ink">{counts.correct}✓</span>
          <span className="text-coral-ink">{counts.wrong}✗</span>
          <span className="text-muted">{counts.blank}–</span>
          <span className="text-yellow-ink">{flagged}?</span>
          <span className={cx("rounded-full px-3 py-0.5", net < 0 ? "bg-coral text-on-color" : "bg-on-color text-white")}>net {net.toFixed(2)}%</span>
        </div>
      </Card>

      <div className="grid gap-4">
        {Object.entries(mock.budget)
          .filter(([, b]) => b.questions > 0)
          .map(([id, b]) => {
            const name = subjects.find((s) => s.id === id)?.name ?? id;
            const isSkip = skip.has(id);
            return (
              <Card key={id} className={cx("flex flex-col gap-2", isSkip && "opacity-60")}>
                <div className="flex items-center justify-between gap-2">
                  <Eyebrow>
                    {name} · {b.questions} questions
                  </Eyebrow>
                  {isSkip && <Chip tone="yellow">Intentional skip · counted blank</Chip>}
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${name} answer sheet`}>
                  {Array.from({ length: b.questions }, (_, i) => {
                    const key = `${id}:${i}`;
                    const m = marks[key] ?? "blank";
                    const flagged = !!suspects[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={phase !== "running" || isSkip}
                        onClick={() => markCell(key)}
                        aria-pressed={m !== "blank"}
                        aria-label={`${name} question ${i + 1}: ${m}${flagged ? ", suspect" : ""}`}
                        className={cx(
                          "relative grid h-9 w-9 place-items-center rounded-lg border-2 text-caption font-black transition-colors",
                          m === "correct" ? "border-lime bg-lime text-on-color" : m === "wrong" ? "border-coral bg-coral text-on-color" : "border-line bg-surface-2 text-muted",
                          flagged && "ring-2 ring-yellow ring-offset-1 ring-offset-[rgb(var(--surface-1))]",
                          phase === "running" && !isSkip && "hover:border-purple",
                        )}
                      >
                        {m === "correct" ? "✓" : m === "wrong" ? "✗" : i + 1}
                        {flagged && (
                          <span className="absolute -end-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-yellow text-[9px] font-black text-on-color" aria-hidden="true">
                            ?
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </Card>
            );
          })}
      </div>

      {phase === "finished" && !busy && (
        <Card className="flex flex-wrap items-center justify-between gap-3" tone="coral">
          <div>
            <Eyebrow>{remaining === 0 ? "Time is up" : "Exam finished"}</Eyebrow>
            <p className="font-display text-display-m leading-none">
              {net.toFixed(2)}% net · {counts.correct}✓ {counts.wrong}✗ {counts.blank}– · {flagged} suspect
            </p>
          </div>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            <Icon name="check" size={18} /> Save result
          </button>
        </Card>
      )}

      <Card className="text-caption text-muted">
        Exact net = (correct − wrong ÷ (choices − 1)) ÷ all questions × 100. Choices come from the exam reference (4). Linear algebra is dropped by design: shown here as an intentional skip, saved separately as “net without LA”.
      </Card>
    </div>
  );
}
