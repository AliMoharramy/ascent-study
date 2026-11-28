"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusView } from "@/server/focus";
import { formatClock } from "@/domain/timer";
import { FOCUS_KIND_OPTIONS, focusKindLabel, type FocusKind } from "@/domain/focus";
import { apiFetch, requestId } from "@/ui/client";
import { MascotSlot, type HeroMascotState } from "@/ui/Mascot";
import { Chip, cx, Eyebrow } from "@/ui/components";
import { Icon } from "@/ui/icons";
import { useFocusBlockCompletion, type FocusBlockResult } from "@/ui/useFocusBlockCompletion";

type Subject = { id: string; nameEn: string; nameFa: string };

export type CoreQuest = { id: string; title: string; tiers: Record<"seed" | "standard" | "stretch", string>; target: { metric: string; seed: number; standard: number; stretch: number }; chapterId: string | null; subjectId: string | null; tierDone: "seed" | "standard" | "stretch" | null; progress: number };

/**
 * HeroFocusCard + focus timer (F-LOG-01). Time comes from the server: we store the offset between server and
 * client clocks and render elapsed = server elapsed + local delta. Refresh/closing the tab loses nothing.
 */
export function TimerCard({ className, subjects, initial, core, heroState = "idle", mascots = true }: { className?: string; subjects: Subject[]; initial: FocusView | null; core?: CoreQuest | null; heroState?: HeroMascotState; mascots?: boolean }) {
  const [session, setSession] = useState<FocusView | null>(initial);
  const [subjectId, setSubjectId] = useState<string>(initial?.subjectId ?? core?.subjectId ?? subjects[0]?.id ?? "");
  const [kind, setKind] = useState<FocusKind>(initial?.kind ?? "video");
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockSuccess, setBlockSuccess] = useState<string | null>(null);
  const completedBlockIds = useRef(new Set<string>());
  const successTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const anchor = useRef<{ client: number; elapsed: number } | null>(initial ? { client: Date.now(), elapsed: initial.elapsedMs } : null);

  const apply = useCallback((v: FocusView | null) => {
    setSession(v);
    if (v) setKind(v.kind);
    anchor.current = v ? { client: Date.now(), elapsed: v.elapsedMs } : null;
  }, []);

  useEffect(() => {
    if (session?.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [session?.status]);

  // Keep the website and native widget on the same server-owned session.
  const syncFocus = useCallback(async () => {
    const r = await apiFetch<{ session: FocusView | null }>("/api/focus").catch(() => null);
    if (r) apply(r.session);
  }, [apply]);

  useEffect(() => {
    const poll = setInterval(() => void syncFocus(), 30_000);
    const onVis = () => { if (document.visibilityState === "visible") void syncFocus(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [syncFocus]);

  const elapsed = session && anchor.current ? anchor.current.elapsed + (session.status === "running" ? now - anchor.current.client : 0) : 0;

  const showBlockSuccess = useCallback((result: FocusBlockResult) => {
    const id = result.session?.id;
    if (id && completedBlockIds.current.has(id)) return;
    if (id) completedBlockIds.current.add(id);
    apply(null);
    setBlockSuccess(result.taskAutoCompleted ? "25-minute focus block complete · task completed" : "25-minute focus block complete");
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setBlockSuccess(null), 4_500);
  }, [apply]);

  const syncEndedBlock = useCallback(() => { void syncFocus(); }, [syncFocus]);
  const blockCompletion = useFocusBlockCompletion(session, elapsed, showBlockSuccess, syncEndedBlock);

  async function act(action: "start" | "pause" | "resume" | "stop" | "discard", extra: { surge?: boolean } = {}) {
    setBusy(true);
    setError(null);
    setBlockSuccess(null);
    try {
      const selectedCore = core && (!core.subjectId || core.subjectId === subjectId) ? core : null;
      const r = await apiFetch<{ session: FocusView | null; blockCompleted?: boolean; taskAutoCompleted?: boolean }>("/api/focus", { body: action === "start" ? {
        action,
        subjectId: subjectId || null,
        chapterId: selectedCore?.chapterId ?? null,
        taskSource: selectedCore ? "Today" : null,
        taskId: selectedCore?.id ?? null,
        taskTitle: selectedCore?.title ?? null,
        kind,
        surge: !!extra.surge,
        clientRequestId: requestId(),
      } : { action } });
      if (r.blockCompleted && r.session) {
        showBlockSuccess({ ...r, blockCompleted: true, taskAutoCompleted: !!r.taskAutoCompleted });
        return;
      }
      if (action === "stop" || action === "discard") {
        apply(null);
      } else apply(r.session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => () => { if (successTimer.current) clearTimeout(successTimer.current); }, []);

  // idle detection (F-LOG-07): no interaction for 5 min → "Still there?"; no answer in 60 s → paused (idle)
  const [idleAsk, setIdleAsk] = useState<number | null>(null);
  const lastActive = useRef(Date.now());
  useEffect(() => {
    if (session?.status !== "running") {
      setIdleAsk(null);
      lastActive.current = Date.now();
      return;
    }
    const mark = () => {
      lastActive.current = Date.now();
    };
    const evs = ["mousemove", "keydown", "pointerdown", "scroll", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const t = setInterval(async () => {
      const idleFor = Date.now() - lastActive.current;
      if (idleAsk === null && idleFor > 5 * 60_000) setIdleAsk(Date.now());
      if (idleAsk !== null && Date.now() - idleAsk > 60_000) {
        setIdleAsk(null);
        const r = await apiFetch<{ session: FocusView | null }>("/api/focus", { body: { action: "idle" } }).catch(() => null);
        if (r) apply(r.session);
      }
    }, 5000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, mark));
      clearInterval(t);
    };
  }, [session?.status, idleAsk, apply]);

  // keyboard: Space = start/pause/resume (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code !== "Space" || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag)) return;
      e.preventDefault();
      if (!session) void act("start");
      else if (session.status === "running") void act("pause");
      else void act("resume");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const running = session?.status === "running";
  const subj = subjects.find((s) => s.id === (session?.subjectId ?? subjectId));
  return (
    <section className={cx("card relative flex min-h-[280px] flex-col gap-4 overflow-hidden border-s-4 border-yellow", className)} aria-label="Focus session">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Focus session</Eyebrow>
          <h2 className="mt-1 font-display text-title-l uppercase leading-tight">{session ? "Session in progress" : "Ready when you are"}</h2>
          {session?.taskTitle && <p className="mt-1 break-words text-body-s font-bold text-muted" dir="auto">Working on: {session.taskTitle}</p>}
          {subj && <p className="mt-1 break-words text-body-s text-muted" dir="auto">{subj.nameEn} · <span lang="fa">{subj.nameFa}</span></p>}
          {!session?.taskTitle && !subj && <p className="mt-1 text-body-s text-muted">Independent session</p>}
        </div>
        {session && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Chip tone="surface">{focusKindLabel(session.kind)}</Chip>
            <Chip tone="surface" icon={running ? "bolt" : "pause"}>
              {running ? "Running" : "Paused"}
            </Chip>
          </div>
        )}
      </div>

      {!session && (
        <details className="rounded-2xl border border-line bg-surface-2 px-3 py-2.5">
          <summary className="min-h-8 cursor-pointer content-center font-extrabold">Session options · {focusKindLabel(kind)}</summary>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Session type">
              {FOCUS_KIND_OPTIONS.map((option) => (
                <button key={option.id} type="button" onClick={() => setKind(option.id)} aria-pressed={kind === option.id} className={cx("chip border border-line py-2 text-body-s", kind === option.id ? "bg-on-color text-white" : "bg-surface-1 text-ink hover:bg-surface-2")}>
                  {option.label}
                </button>
              ))}
            </div>
            <label className="text-body-s font-bold">
              <span className="label">Subject</span>
              <select aria-label="Subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="field">
                <option value="">No subject</option>
                {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.nameEn}</option>)}
              </select>
            </label>
            <button className="btn-ghost min-h-11 self-start" type="button" onClick={() => act("start", { surge: true })} disabled={busy} title="Surge: ×1.2 focus XP for the first 90 minutes">
              <Icon name="bolt" size={16} /> Start with Surge <kbd className="rounded bg-surface-2 px-1.5 text-caption">S</kbd>
            </button>
          </div>
        </details>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <p className="text-caption font-extrabold uppercase tracking-wider text-muted">Live elapsed time</p>
        <p className="font-display text-[72px] leading-none tracking-wide md:text-[96px]" aria-live="off" aria-label={`Live elapsed time ${formatClock(elapsed)}`}>
          {formatClock(elapsed)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!session && (
            <button className="btn-primary min-h-12 px-6 py-3 text-body" onClick={() => act("start")} disabled={busy}>
              <Icon name="play" size={18} /> Start <kbd className="ms-1 rounded bg-white/15 px-1.5 text-caption">Space</kbd>
            </button>
          )}
          {!session && (
            <a href="/focus" className="btn-ghost min-h-12 px-4" title="Fullscreen focus mode (F)">
              <Icon name="expand" size={18} />
              <span>Focus mode</span>
            </a>
          )}
          {session?.surge && <Chip tone="dark" icon="bolt">Surge ×1.2</Chip>}
          {session && running && (
            <button className="btn-primary min-h-12 px-6 py-3 text-body" onClick={() => act("pause")} disabled={busy}>
              <Icon name="pause" size={18} /> Pause
            </button>
          )}
          {session && !running && (
            <button className="btn-primary min-h-12 px-6 py-3 text-body" onClick={() => act("resume")} disabled={busy}>
              <Icon name="play" size={18} /> Resume
            </button>
          )}
          {session && (
            <>
              <button className="btn-ghost min-h-12 px-6 py-3 text-body" onClick={() => act("stop")} disabled={busy}>
                <Icon name="stop" size={16} /> Finish
              </button>
              <button className="btn-ghost min-h-12 px-4" onClick={() => confirm("Discard this session? Nothing will be recorded.") && act("discard")} disabled={busy} title="Discard session">
                <Icon name="trash" size={18} />
                <span className="sr-only">Discard</span>
              </button>
            </>
          )}
        </div>
        {idleAsk !== null && session?.status === "running" && (
          <div role="alertdialog" aria-label="Still there?" className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-on-color px-4 py-3 text-white">
            <span className="text-body-s font-bold">Still studying? The timer pauses in a minute without an answer.</span>
            <button className="btn bg-yellow px-4 py-1.5 text-on-color" onClick={() => { lastActive.current = Date.now(); setIdleAsk(null); }}>
              I&apos;m here
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-2xl bg-on-color px-4 py-2 text-body-s font-semibold text-white">
            {error}
          </p>
        )}
        {(blockSuccess || blockCompletion.error) && (
          <p role={blockSuccess ? "status" : "alert"} aria-live="polite" className={`mt-3 rounded-2xl px-4 py-2 text-body-s font-semibold text-white ${blockSuccess ? "animate-spring bg-emerald-800" : "bg-on-color"}`}>
            {blockSuccess ?? `Retrying focus sync: ${blockCompletion.error}`}
          </p>
        )}
      </div>

      <MascotSlot
        character="hero"
        state={heroState}
        size="md"
        enabled={mascots}
        className="pointer-events-none absolute bottom-4 right-4 hidden xl:flex"
      />
    </section>
  );
}
