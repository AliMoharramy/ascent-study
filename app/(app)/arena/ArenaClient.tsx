"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/ui/client";
import { BossBar, Card, Chip, cx, Eyebrow } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Modal } from "@/ui/Modal";
import { BossShareDialog } from "@/ui/ShareCard";

type Round = { key: string; label: string; you: number; shadow: number; winner: "user" | "shadow" | "draw" };

export function DuelTable({ duels }: { duels: { weekNo: number; winner: string; goldAwarded: number; rounds: Round[] }[] }) {
  const last = duels[duels.length - 1];
  if (!last) return <Card className="text-body-s text-muted">The first duel is settled at the end of week 2 (Friday night, after the Weekly Boss).</Card>;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Eyebrow>Weekly duel · week {last.weekNo} · best of 5</Eyebrow>
        <Chip tone={last.winner === "user" ? "lime" : last.winner === "shadow" ? "coral" : "surface"}>{last.winner === "user" ? `Won · +${last.goldAwarded} Gold` : last.winner === "shadow" ? "Lost" : "Draw"}</Chip>
      </div>
      <table className="w-full text-body-s">
        <thead>
          <tr className="text-start text-caption uppercase text-muted">
            <th className="py-1 text-start">Round</th>
            <th className="text-end">You</th>
            <th className="text-end">Shadow</th>
            <th className="text-end">Result</th>
          </tr>
        </thead>
        <tbody>
          {last.rounds.map((r) => (
            <tr key={r.key} className="border-t border-line">
              <td className="py-1.5 font-bold">{r.label}</td>
              <td className="text-end">{r.you}</td>
              <td className="text-end">{r.shadow}</td>
              <td className={cx("text-end font-extrabold", r.winner === "user" ? "text-lime-ink" : r.winner === "shadow" ? "text-coral-ink" : "text-muted")}>{r.winner === "user" ? "✔ you" : r.winner === "shadow" ? "✗ shadow" : "="}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {last.winner !== "user" && <p className="text-caption text-muted">To win next week: take the rounds marked ✗ — usually one more cleared chapter or a few more analysed errors flips it.</p>}
      {duels.length > 1 && <p className="text-caption text-muted">History: {duels.map((d) => (d.winner === "user" ? "W" : d.winner === "shadow" ? "L" : "D")).join(" · ")}</p>}
    </Card>
  );
}

type Boss = { id: string; kind: string; weekNo: number; scheduledFor: string; status: string; thresholdPct: number | null; resultPct: number | null; defeated: boolean | null; spec: { title: string; questions: number; minutes: number; chapters: { chapterId: string; questions: number }[] } };

export function BossPanel({ bosses, titles, nextId, today }: { bosses: Boss[]; titles: Record<string, string>; nextId: string | null; today: string }) {
  const { toast, celebrate } = useFeedback();
  const [open, setOpen] = useState<Boss | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const closeShare = useCallback(() => setShareId(null), []);
  const [vals, setVals] = useState<Record<string, { correct: string; wrong: string; blank: string }>>({});
  const upcoming = bosses.filter((b) => b.status === "scheduled");
  const past = bosses.filter((b) => b.status !== "scheduled").slice(-6).reverse();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!open) return;
    const results = open.spec.chapters.map((c) => ({ chapterId: c.chapterId, correct: Number(vals[c.chapterId]?.correct || 0), wrong: Number(vals[c.chapterId]?.wrong || 0), blank: Number(vals[c.chapterId]?.blank || 0) }));
    try {
      const r = await apiFetch<{ result: { netPct: number; defeated: boolean | null; hpLeft: number } }>("/api/arena", { body: { action: "boss_result", bossId: open.id, results } });
      if (r.result.defeated) celebrate(`${open.spec.title} defeated at ${r.result.netPct}%!`);
      else toast(`${open.spec.title}: ${r.result.netPct}% — boss HP ${r.result.hpLeft}%`, r.result.defeated === false ? "warn" : "ok");
      setShareId(open.id);
      setOpen(null);
      setVals({});
    } catch (err) {
      toast((err as Error).message, "warn");
    }
  }
  async function skip(b: Boss) {
    if (!confirm(b.kind === "weekly" ? "Skip the Weekly Boss? (−40 SS)" : "Skip this boss?")) return;
    await apiFetch("/api/arena", { body: { action: "boss_skip", bossId: b.id } }).catch((e) => toast((e as Error).message, "warn"));
  }
  return (
    <section className="grid gap-4 md:grid-cols-2">
      {upcoming.slice(0, 4).map((b) => (
        <Card key={b.id} tone={b.id === nextId ? "coral" : "surface"} className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Eyebrow>
              {b.spec.title} · week {b.weekNo}
            </Eyebrow>
            <Chip tone="dark">{b.scheduledFor <= today ? "Today / due" : b.scheduledFor}</Chip>
          </div>
          <p className="font-display text-display-m leading-none">
            {b.spec.questions} tests · {b.spec.minutes} min
          </p>
          {b.thresholdPct != null && <BossBar hp={100} label={`Win at ≥ ${b.thresholdPct}% net`} />}
          <details className="text-body-s">
            <summary className="cursor-pointer font-extrabold">Spec (chapters & counts — pick questions from your own test bank)</summary>
            <ul className="mt-2 grid gap-1">
              {b.spec.chapters.map((c) => (
                <li key={c.chapterId} className="flex justify-between gap-2 rounded-lg bg-on-color/10 px-2 py-1">
                  <span className="fa truncate" dir="auto">
                    {titles[c.chapterId] ?? c.chapterId}
                  </span>
                  <b>{c.questions}</b>
                </li>
              ))}
            </ul>
          </details>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => setOpen(b)}>
              Log result
            </button>
            <button className={b.id === nextId ? "btn-ghost-on-color" : "btn-ghost"} onClick={() => skip(b)}>
              Skip
            </button>
          </div>
        </Card>
      ))}
      {upcoming.length === 0 && <Card className="text-body-s text-muted">No bosses scheduled this week (bosses run in weeks 2–19 once the plan exists).</Card>}
      {past.length > 0 && (
        <Card className="flex flex-col gap-2 md:col-span-2">
          <Eyebrow>Boss history</Eyebrow>
          {past.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-body-s">
              <span className="font-bold">
                {b.spec.title} · week {b.weekNo}
              </span>
              <span className="flex items-center gap-2">
                {b.status === "skipped" ? "Skipped" : `${b.resultPct}% ${b.defeated ? "· defeated ✔" : b.defeated === false ? "· survived ✗" : ""}`}
                {b.status === "done" && (
                  <button className="btn-ghost px-3 py-1 text-caption" onClick={() => setShareId(b.id)}>
                    Share card
                  </button>
                )}
              </span>
            </div>
          ))}
        </Card>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.spec.title} result` : "Result"} wide>
        {open && (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <p className="text-body-s text-muted">Enter correct / wrong / blank per chapter. Negative marking: each wrong costs ⅓.</p>
            <div className="max-h-[50vh] overflow-y-auto">
              {open.spec.chapters.map((c) => (
                <div key={c.chapterId} className="grid grid-cols-[1fr_repeat(3,64px)] items-center gap-2 border-b border-line py-1.5">
                  <span className="fa truncate text-body-s" dir="auto">
                    {titles[c.chapterId] ?? c.chapterId} <span className="text-muted">({c.questions})</span>
                  </span>
                  {(["correct", "wrong", "blank"] as const).map((k) => (
                    <input key={k} aria-label={`${k} for ${c.chapterId}`} inputMode="numeric" className="field px-2 py-1 text-center" placeholder={k[0]!.toUpperCase()} value={vals[c.chapterId]?.[k] ?? ""} onChange={(e) => setVals({ ...vals, [c.chapterId]: { correct: "", wrong: "", blank: "", ...vals[c.chapterId], [k]: e.target.value.replace(/\D/g, "") } })} />
                  ))}
                </div>
              ))}
            </div>
            <button className="btn-accent self-start">Hit the boss</button>
          </form>
        )}
      </Modal>
      <BossShareDialog bossId={shareId} onClose={closeShare} />
    </section>
  );
}

type Mock = { no: number; dateJalali: string; date: string | null; questions: number; minutes: number; budget: Record<string, { questions: number }>; results: { id: string; netPct: number; netPctNoSkip: number; rankInSite: number | null; gameDay: string; perSubject: Record<string, { netPct: number; skipped: boolean; correct: number; wrong: number; blank: number }> }[] };

export function MockPanel({ mocks, subjects }: { mocks: Mock[]; subjects: { id: string; name: string; skipped: boolean }[] }) {
  const { toast } = useFeedback();
  const [open, setOpen] = useState<Mock | null>(null);
  const [vals, setVals] = useState<Record<string, { correct: string; wrong: string; blank: string }>>({});
  const [rank, setRank] = useState("");
  const name = (id: string) => subjects.find((s) => s.id === id)?.name ?? id;
  const skipped = new Set(subjects.filter((s) => s.skipped).map((s) => s.id));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!open) return;
    const perSubject = Object.fromEntries(
      Object.entries(open.budget)
        .filter(([k, v]) => v.questions > 0 && !skipped.has(k))
        .map(([k]) => [k, { correct: Number(vals[k]?.correct || 0), wrong: Number(vals[k]?.wrong || 0), blank: Number(vals[k]?.blank || 0) }]),
    );
    try {
      const r = await apiFetch<{ result: { netPct: number; netPctNoSkip: number; beatShadow: boolean } }>("/api/arena", { body: { action: "mock", mockNo: open.no, perSubject, rank: rank ? Number(rank) : null } });
      toast(`Mock ${open.no}: ${r.result.netPctNoSkip}% net without linear algebra (${r.result.netPct}% with it)${r.result.beatShadow ? " — you beat the Shadow!" : ""}`);
      setOpen(null);
      setVals({});
    } catch (err) {
      toast((err as Error).message, "warn");
    }
  }
  return (
    <Card className="flex flex-col gap-3">
      <Eyebrow>cshub mock exams · 13 stages</Eyebrow>
      <p className="text-caption text-muted">Linear algebra is an intentional skip: shown separately, never counted as weakness. Net % is reported with and without it.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-body-s">
          <thead>
            <tr className="text-caption uppercase text-muted">
              <th className="py-1 text-start">#</th>
              <th className="text-start">Date</th>
              <th className="text-end">Q</th>
              <th className="text-end">Min</th>
              <th className="text-end">Net (no LA)</th>
              <th className="text-end">Net (all)</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {mocks.map((m) => {
              const r = m.results[m.results.length - 1];
              return (
                <tr key={m.no} className="border-t border-line">
                  <td className="py-1.5 font-extrabold">{m.no}</td>
                  <td>{m.dateJalali}</td>
                  <td className="text-end">{m.questions}</td>
                  <td className="text-end">{m.minutes}</td>
                  <td className="text-end font-bold">{r ? `${r.netPctNoSkip}%` : "—"}</td>
                  <td className="text-end text-muted">{r ? `${r.netPct}%` : "—"}</td>
                  <td className="text-end">
                    <button className="btn-ghost px-3 py-1" onClick={() => setOpen(m)}>
                      {r ? "Re-log" : "Log"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Mock ${open.no} result` : "Mock"} wide>
        {open && (
          <form onSubmit={submit} className="flex flex-col gap-3">
            {Object.entries(open.budget)
              .filter(([, v]) => v.questions > 0)
              .map(([k, v]) => (
                <div key={k} className="grid grid-cols-[1fr_repeat(3,64px)] items-center gap-2">
                  <span className="text-body-s font-bold">
                    {name(k)} <span className="text-muted">({v.questions})</span>
                  </span>
                  {skipped.has(k) ? (
                    <span className="col-span-3 text-caption font-bold text-muted">Intentional skip — counted as blank</span>
                  ) : (
                    (["correct", "wrong", "blank"] as const).map((f) => <input key={f} aria-label={`${f} ${k}`} inputMode="numeric" className="field px-2 py-1 text-center" placeholder={f[0]!.toUpperCase()} value={vals[k]?.[f] ?? ""} onChange={(e) => setVals({ ...vals, [k]: { correct: "", wrong: "", blank: "", ...vals[k], [f]: e.target.value.replace(/\D/g, "") } })} />)
                  )}
                </div>
              ))}
            <label className="max-w-48">
              <span className="label">Rank on cshub (optional)</span>
              <input className="field" inputMode="numeric" value={rank} onChange={(e) => setRank(e.target.value.replace(/\D/g, ""))} />
            </label>
            <button className="btn-accent self-start">Save result</button>
          </form>
        )}
      </Modal>
    </Card>
  );
}
