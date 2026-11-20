"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorLogDialog, type ChapterOpt } from "@/ui/ErrorLog";
import { netPct } from "@/domain/tests";
import { comboAfter, isCleanLog, isComboMilestone } from "@/domain/combo";
import { apiFetch, requestId } from "@/ui/client";
import { cx, Eyebrow } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";

type Subject = { id: string; nameEn: string };
type Day = { count: number; netPct: number; totals: { correct: number; wrong: number; blank: number } };
type Row = { id: string; correct: number; wrong: number; blank: number; netPct: number; subjectId: string | null; chapterId?: string | null };

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const haptic = (ms: number) => {
  if (typeof navigator !== "undefined" && navigator.vibrate && !reducedMotion()) navigator.vibrate(ms);
};

/** Quick test log (F-LOG-03): keyboard-first — type numbers, Tab between fields, Enter saves. */
export function TestLogCard({ className, subjects, initialDay, recent, initialCombo = 0, chapters = [], defaultChapter }: { className?: string; subjects: Subject[]; initialDay: Day; recent: Row[]; initialCombo?: number; chapters?: ChapterOpt[]; defaultChapter?: string | null }) {
  const { celebrate } = useFeedback();
  const [subjectId, setSubjectId] = useState(subjects.find((s) => s.id === "foundations")?.id ?? subjects[0]?.id ?? "");
  const [c, setC] = useState("");
  const [w, setW] = useState("");
  const [b, setB] = useState("");
  const [day, setDay] = useState(initialDay);
  const [rows, setRows] = useState(recent);
  const [combo, setCombo] = useState(initialCombo);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const [chapterId, setChapterId] = useState(defaultChapter ?? "");
  const [secs, setSecs] = useState("");
  const [inter, setInter] = useState(false);
  const [analyse, setAnalyse] = useState<{ id: string; count: number; chapterId: string | null } | null>(null);
  useEffect(() => {
    const f = () => first.current?.focus();
    window.addEventListener("ascent:focus-tests", f);
    if (location.hash === "#tests") setTimeout(f, 50);
    return () => window.removeEventListener("ascent:focus-tests", f);
  }, []);
  const subjectChapters = chapters.filter((ch) => !subjectId || ch.id.startsWith(`${subjectId}-`));

  const n = (v: string) => (v.trim() === "" ? 0 : Number(v));
  const live = useMemo(() => {
    const t = { correct: n(c), wrong: n(w), blank: n(b) };
    return t.correct + t.wrong + t.blank > 0 ? netPct(t) : null;
  }, [c, w, b]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ log: Row; day: Day }>("/api/tests", { body: { subjectId: subjectId || null, chapterId: chapterId || null, correct: n(c), wrong: n(w), blank: n(b), seconds: secs.trim() === "" ? null : Number(secs), interleaved: inter, clientRequestId: requestId() } });
      setDay(r.day);
      setRows((x) => [r.log, ...x].slice(0, 4));
      const next = comboAfter(combo, r.log);
      setCombo(next);
      if (next !== combo && isComboMilestone(next)) {
        celebrate(`Combo ×${next} — ${next} clean logs in a row!`);
        haptic(30);
      }
      setMsg({ kind: "ok", text: `Logged ${r.log.correct + r.log.wrong + r.log.blank} tests · net ${r.log.netPct}% · combo ×${next}` });
      if (r.log.wrong > 0) setAnalyse({ id: r.log.id, count: r.log.wrong, chapterId: chapterId || null });
      setC("");
      setW("");
      setB("");
      setSecs("");
      setInter(false);
      first.current?.focus();
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function undo(id: string) {
    const row = rows.find((r) => r.id === id);
    await apiFetch(`/api/tests/${id}`, { method: "DELETE" }).catch(() => null);
    const r = await apiFetch<Day>("/api/tests");
    setDay(r);
    setRows((x) => x.filter((y) => y.id !== id));
    if (row && isCleanLog(row) && combo > 0 && rows[0]?.id === id) setCombo((n) => n - 1);
  }

  const name = (id: string | null) => subjects.find((s) => s.id === id)?.nameEn ?? "—";

  return (
    <section id="tests" className={cx("card-color flex flex-col gap-3 bg-mint", className)} aria-label="Log tests">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>Log tests</Eyebrow>
          <p className="mt-1 font-display text-display-m leading-none">
            {day.count} <span className="font-body text-body-s font-extrabold opacity-70">today · net {day.count ? `${day.netPct}%` : "—"}</span>
          </p>
        </div>
        <span className="grid h-14 w-14 place-items-center rounded-full bg-on-color font-display text-title-m text-white" aria-live="polite" title="Net % of this entry">
          {live === null ? "—" : `${Math.round(live)}%`}
        </span>
      </div>
      <div className="rounded-2xl bg-on-color/10 px-3 py-2" aria-label={`Combo ${combo}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-body-s font-extrabold">
            <span key={combo} className={cx("inline-flex", combo > 0 && "animate-pop text-coral-ink")}>
              <Icon name="flame" size={18} />
            </span>
            Combo <b className="font-display text-title-s leading-none">×{combo}</b>
          </span>
          <span className="text-caption font-bold opacity-70">{combo > 0 ? "clean logs in a row" : "first clean log starts it"}</span>
        </div>
        <div className="mt-1.5 flex gap-1" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={cx("h-1.5 flex-1 rounded-full", combo > 0 && (i < combo % 5 || combo % 5 === 0) ? "bg-yellow" : "bg-on-color/20")} />
          ))}
        </div>
        <p className="mt-1 text-caption opacity-70">Clean = at least one correct and zero wrong. Cosmetic only — no extra XP; a wrong answer resets it.</p>
      </div>
      <form onSubmit={save} className="grid grid-cols-3 gap-2">
        <select aria-label="Subject" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setChapterId(""); }} className="col-span-3 rounded-2xl border-2 border-on-color/70 bg-transparent px-3 py-2 font-extrabold">
          <option value="">No subject</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nameEn}
            </option>
          ))}
        </select>
        <select aria-label="Chapter" value={chapterId} onChange={(e) => setChapterId(e.target.value)} className="col-span-3 truncate rounded-2xl border-2 border-on-color/70 bg-transparent px-3 py-2 text-body-s font-bold">
          <option value="">Chapter (optional — counts toward Clear)</option>
          {subjectChapters.map((ch) => (
            <option key={ch.id} value={ch.id}>
              {ch.label}
            </option>
          ))}
        </select>
        {(
          [
            ["Correct", c, setC, first],
            ["Wrong", w, setW, null],
            ["Blank", b, setB, null],
          ] as const
        ).map(([label, val, set, ref]) => (
          <label key={label} className="flex flex-col rounded-2xl bg-on-color/90 px-3 py-2 text-white">
            <span className="text-caption font-extrabold uppercase tracking-wider opacity-70">{label}</span>
            <input ref={ref ?? undefined} inputMode="numeric" pattern="[0-9]*" value={val} onChange={(e) => set(e.target.value.replace(/[^\d۰-۹]/g, "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))))} className="w-full bg-transparent font-display text-display-m leading-none outline-none placeholder:text-white/30" placeholder="0" aria-label={`${label} answers`} />
          </label>
        ))}
        <label className="col-span-2 flex flex-col rounded-2xl bg-on-color/90 px-3 py-2 text-white">
          <span className="text-caption font-extrabold uppercase tracking-wider opacity-70">Seconds spent (optional)</span>
          <input inputMode="numeric" value={secs} onChange={(e) => setSecs(e.target.value.replace(/\D/g, ""))} className="w-full bg-transparent font-display text-title-m leading-none outline-none placeholder:text-white/30" placeholder="—" aria-label="Seconds spent on this session" />
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-2xl bg-on-color/10 px-3 py-2 text-body-s font-extrabold">
          <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-yellow))]" checked={inter} onChange={(e) => setInter(e.target.checked)} />
          Interleaved
        </label>
        <p className="col-span-3 text-caption opacity-70">Interleaved = mixed subjects in one session (+XP bonus inside the daily cap). Seconds feed the time-per-question coach in Forge.</p>
        <button className="btn-primary col-span-3 py-3" disabled={busy || live === null}>
          <Icon name="check" size={18} /> Save <kbd className="ms-1 rounded bg-white/15 px-1.5 text-caption">Enter</kbd>
        </button>
      </form>
      {analyse && (
        <button type="button" className="btn-primary self-start" onClick={() => setAnalyse({ ...analyse })}>
          Analyse {analyse.count} wrong answer(s) · +1 XP each
        </button>
      )}
      {analyse && <ErrorLogDialog open={!!analyse} onClose={() => setAnalyse(null)} chapters={chapters} defaultChapter={analyse.chapterId} testLogId={analyse.id} count={Math.min(analyse.count, 10)} />}
      {msg && (
        <p role="status" className={cx("rounded-2xl px-3 py-2 text-body-s font-bold", msg.kind === "ok" ? "bg-on-color/10" : "bg-coral text-on-color")}>
          {msg.text}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="grid gap-1 text-body-s font-semibold">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-xl bg-on-color/10 px-3 py-1.5">
              <span>
                {name(r.subjectId)} · {r.correct}✓ {r.wrong}✗ {r.blank}– · <b>{r.netPct}%</b>
              </span>
              <button type="button" onClick={() => undo(r.id)} className="rounded-full p-1 hover:bg-on-color/15" title="Delete this entry">
                <Icon name="undo" size={16} />
                <span className="sr-only">Delete entry</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
