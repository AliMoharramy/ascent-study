"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow, StatTile } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import type { interleaveView, masteryView } from "@/server/learning";

type Mastery = Awaited<ReturnType<typeof masteryView>>;
type Interleave = Awaited<ReturnType<typeof interleaveView>>;
const LEVELS = ["Seen", "Familiar", "Practiced", "Strong", "Legendary"];

/** Learning science panel (#89): 5 mastery levels, pretest effect, weekly interleaved mix. */
export function LearningClient({ mastery, interleave }: { mastery: Mastery; interleave: Interleave }) {
  const { toast } = useFeedback();
  const [rows, setRows] = useState(mastery);
  const [chapterId, setChapterId] = useState("");
  const [correct, setCorrect] = useState("");
  const [total, setTotal] = useState("5");
  const [busy, setBusy] = useState(false);
  const counts = LEVELS.map((_, i) => rows.filter((r) => r.level === i).length);
  async function pretest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await apiFetch<{ pretest: { chapterId: string; a0: number }; mastery: Mastery }>("/api/learn", { body: { action: "pretest", pretest: { chapterId, correct: Number(correct || 0), total: Number(total || 5) } } });
      setRows(r.mastery);
      toast(`Pretest logged — chapter baseline a0 set to ${Math.round(r.pretest.a0 * 100)}%`);
      setCorrect("");
    } catch (err) {
      toast((err as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="flex flex-col gap-3 lg:col-span-2">
        <Eyebrow>Mastery ladder · every chapter</Eyebrow>
        <div className="grid grid-cols-5 gap-2">
          {LEVELS.map((l, i) => (
            <StatTile key={l} label={l} value={counts[i] ?? 0} tone={i === 4 ? "purple" : i === 3 ? "yellow" : i === 2 ? "mint" : "surface"} />
          ))}
        </div>
        <p className="text-caption text-muted">Seen → Familiar (studied) → Practiced (passing session or pretest) → Strong (cleared) → Legendary (cleared + third review round). Round 2/3 dates re-schedule automatically from each round-1 completion.</p>
        <details className="text-body-s">
          <summary className="cursor-pointer font-extrabold">All chapters ({rows.length})</summary>
          <ul className="mt-2 grid max-h-72 gap-1 overflow-y-auto">
            {rows.map((r) => (
              <li key={r.chapterId} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-1.5">
                <span className="fa min-w-0 truncate" dir="auto">
                  {r.subject} {r.no} · {r.title}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {r.pretested && <Chip tone="mint">pretested</Chip>}
                  <span className="flex gap-0.5" aria-label={`${LEVELS[r.level]} (level ${r.level + 1} of 5)`}>
                    {LEVELS.map((_, i) => (
                      <span key={i} className={cx("h-2 w-2 rounded-full", i <= r.level ? "bg-purple" : "bg-surface-1 border border-line")} />
                    ))}
                  </span>
                  <b className="w-20 text-end text-caption">{LEVELS[r.level]}</b>
                </span>
              </li>
            ))}
          </ul>
        </details>
      </Card>
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-2">
          <Eyebrow>Pretest effect · guess before studying</Eyebrow>
          <form onSubmit={pretest} className="flex flex-col gap-2">
            <select className="field" aria-label="Chapter to pretest" value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
              <option value="">Pick a chapter…</option>
              {rows.map((r) => (
                <option key={r.chapterId} value={r.chapterId}>
                  {r.subject} {r.no} · {r.title}
                  {r.pretested ? " (re-test)" : ""}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="label">Correct guesses</span>
                <input className="field" inputMode="numeric" value={correct} onChange={(e) => setCorrect(e.target.value.replace(/\D/g, ""))} placeholder="0" />
              </label>
              <label>
                <span className="label">Questions (≤10)</span>
                <input className="field" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value.replace(/\D/g, ""))} placeholder="5" />
              </label>
            </div>
            <button className="btn-accent self-start" disabled={busy || !chapterId}>
              Log pretest
            </button>
          </form>
          <p className="text-caption text-muted">Even wrong guesses prime memory. The score sets the chapter&apos;s baseline a0 (weighted), so later growth is measured honestly.</p>
        </Card>
        <Card tone="mint" className="flex flex-col gap-2">
          <Eyebrow>This week&apos;s interleaved mix</Eyebrow>
          {interleave.enabled ? (
            <>
              <ul className="grid gap-1 text-body-s">
                {interleave.chapters.map((c) => (
                  <li key={c.chapterId} className="flex items-center justify-between rounded-xl bg-on-color/10 px-3 py-1.5">
                    <span className="fa truncate font-bold" dir="auto">
                      {c.subject} · {c.title}
                    </span>
                    <b>{c.netPct != null ? `${Math.round(c.netPct)}%` : "—"}</b>
                  </li>
                ))}
                {interleave.chapters.length === 0 && <li className="opacity-80">No in-progress chapters yet — the mix appears once you start testing.</li>}
              </ul>
              <p className="text-caption opacity-80">Mix these subjects in one test session and tick “Interleaved” on the log form: +{Math.round(interleave.xpBonus * 100)}% XP, still inside the daily cap. The mix rotates weekly.</p>
            </>
          ) : (
            <p className="text-body-s opacity-90">Interleaving is off in Settings → Learning.</p>
          )}
        </Card>
      </div>
    </div>
  );
}