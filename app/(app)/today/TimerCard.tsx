"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusView } from "@/server/focus";
import { formatClock } from "@/domain/timer";
import { apiFetch, requestId } from "@/ui/client";
import { MascotSlot, type HeroMascotState } from "@/ui/Mascot";
import { Chip, cx, Eyebrow, ProgressBar } from "@/ui/components";
import { Icon } from "@/ui/icons";

type Subject = { id: string; nameEn: string; nameFa: string };
const KINDS = [
  { id: "video", label: "Video" },
  { id: "tests", label: "Tests" },
  { id: "review", label: "Review" },
  { id: "analysis", label: "Error analysis" },
  { id: "other", label: "Other" },
] as const;

export type CoreQuest = { id: string; title: string; tiers: Record<"seed" | "standard" | "stretch", string>; target: { seed: number; standard: number; stretch: number }; chapterId: string | null; subjectId: string | null; tierDone: "seed" | "standard" | "stretch" | null; progress: number };
const TIER_LABEL = { seed: "Seed", standard: "Standard", stretch: "Stretch" } as const;

/**
 * HeroFocusCard + focus timer (F-LOG-01). Time comes from the server: we store the offset between server and
 * client clocks and render elapsed = server elapsed + local delta. Refresh/closing the tab loses nothing.
 */
export function TimerCard({ className, subjects, initial, initialMinutesToday, core, heroState = "idle", mascots = true }: { className?: string; subjects: Subject[]; initial: FocusView | null; initialMinutesToday: number; tz: string; rollover: number; core?: CoreQuest | null; heroState?: HeroMascotState; mascots?: boolean }) {
  const DAILY_TARGET_MIN = core?.target.standard ?? 240;
  const [session, setSession] = useState<FocusView | null>(initial);
  const [minutesToday, setMinutesToday] = useState(initialMinutesToday);
  const [subjectId, setSubjectId] = useState<string>(initial?.subjectId ?? core?.subjectId ?? subjects[0]?.id ?? "");
  const [kind, setKind] = useState<string>(initial?.kind ?? "video");
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchor = useRef<{ client: number; elapsed: number } | null>(initial ? { client: Date.now(), elapsed: initial.elapsedMs } : null);

  const apply = useCallback((v: FocusView | null) => {
    setSession(v);
    anchor.current = v ? { client: Date.now(), elapsed: v.elapsedMs } : null;
  }, []);

  useEffect(() => {
    if (session?.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [session?.status]);

  // re-sync when the tab becomes visible again (laptop sleep etc.)
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await apiFetch<{ session: FocusView | null; todayMinutes: number }>("/api/focus").catch(() => null);
      if (r) {
        apply(r.session);
        setMinutesToday(r.todayMinutes);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [apply]);

  const elapsed = session && anchor.current ? anchor.current.elapsed + (session.status === "running" ? now - anchor.current.client : 0) : 0;

  async function act(action: "start" | "pause" | "resume" | "stop" | "discard", extra: { surge?: boolean } = {}) {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ session: FocusView | null }>("/api/focus", { body: action === "start" ? { action, subjectId: subjectId || null, chapterId: core && core.subjectId === subjectId ? core.chapterId : null, kind, surge: !!extra.surge, clientRequestId: requestId() } : { action } });
      if (action === "stop") {
        setMinutesToday((m) => m + (r.session?.minutes ?? 0));
        apply(null);
      } else apply(r.session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // idle detection (F-LOG-07): no interaction for 5 min → "Still there?"; no answer in 60 s → paused (idle)
  const [idleAsk, setIdleAsk] = useState<number | null>(null);
  const lastActive = useRef(Date.now());
  useEffect(() => {
    if (session?.status !== "running") return;
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
  const liveMinutes = minutesToday + (session ? Math.floor(elapsed / 60_000) : 0);

  return (
    <section className={cx("card-color relative flex min-h-[340px] flex-col overflow-hidden bg-yellow", className)} aria-label="Today's focus">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Today&apos;s focus</Eyebrow>
          <h1 className="mt-2 font-display text-display-m uppercase leading-[0.92] md:text-display-l" dir="auto">
            {core && (!session || session.chapterId === core.chapterId) ? core.title : subj ? subj.nameEn : "Free focus"}
          </h1>
          {subj && !(core && (!session || session.chapterId === core.chapterId)) && (
            <p className="fa mt-1 text-title-m font-bold opacity-80" lang="fa" dir="rtl">
              {subj.nameFa}
            </p>
          )}
        </div>
        {session && (
          <Chip tone="dark" icon={running ? "bolt" : "pause"}>
            <span className={running ? "animate-pulse-dot" : ""}>{running ? "Live" : "Paused"}</span>
          </Chip>
        )}
      </div>

      {core && (
        <ol className="mt-4 grid gap-1.5 text-body-s font-bold" aria-label="Core quest tiers">
          {(["seed", "standard", "stretch"] as const).map((t) => {
            const reached = core.tierDone && ["seed", "standard", "stretch"].indexOf(core.tierDone) >= ["seed", "standard", "stretch"].indexOf(t);
            return (
              <li key={t} className={cx("flex items-center gap-2 rounded-2xl px-3 py-1.5", reached ? "bg-on-color text-white" : "bg-on-color/10")}>
                <span className={cx("grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", reached ? "border-lime bg-lime text-on-color" : "border-on-color/60")}>{reached && <Icon name="check" size={12} />}</span>
                <span className="w-20 shrink-0 font-extrabold uppercase tracking-wider">{TIER_LABEL[t]}</span>
                <span dir="auto">{core.tiers[t]}</span>
              </li>
            );
          })}
        </ol>
      )}

      {!session && (
        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Session type">
          {KINDS.map((k) => (
            <button key={k.id} type="button" onClick={() => setKind(k.id)} aria-pressed={kind === k.id} className={cx("chip border-2 border-on-color/80 py-1.5 text-body-s", kind === k.id ? "bg-on-color text-white" : "bg-transparent text-on-color hover:bg-on-color/10")}>
              {k.label}
            </button>
          ))}
          <select aria-label="Subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="chip cursor-pointer border-2 border-on-color/80 bg-transparent py-1.5 text-body-s text-on-color">
            <option value="">No subject</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameEn}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-auto pt-6">
        <p className="font-display text-[88px] leading-none tracking-wide md:text-[112px]" aria-live="off" aria-label={`Elapsed ${formatClock(elapsed)}`}>
          {formatClock(elapsed)}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <ProgressBar value={liveMinutes / DAILY_TARGET_MIN} tone="surface" track="dark" label="Focus minutes today vs Core standard" className="[&>div]:bg-on-color" />
          <span className="shrink-0 text-body-s font-extrabold">{liveMinutes} / {DAILY_TARGET_MIN} min</span>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {!session && (
            <button className="btn-primary px-6 py-3 text-body" onClick={() => act("start")} disabled={busy}>
              <Icon name="play" size={18} /> Start <kbd className="ms-1 rounded bg-white/15 px-1.5 text-caption">Space</kbd>
            </button>
          )}
          {!session && (
            <button className="btn border-2 border-on-color px-5 py-3 text-body text-on-color hover:bg-on-color/10" onClick={() => act("start", { surge: true })} disabled={busy} title="Surge: ×1.2 focus XP for the first 90 minutes">
              <Icon name="bolt" size={16} /> Surge <kbd className="rounded bg-on-color/10 px-1.5 text-caption">S</kbd>
            </button>
          )}
          {!session && core && !core.tierDone && (
            <button className="btn px-4 py-3 text-body-s text-on-color underline-offset-4 hover:underline" onClick={() => act("start")} disabled={busy} title="Bad day? Just start — 2 minutes counts (Seed)">
              Bad day? Just start · Seed 2 min
            </button>
          )}
          {!session && (
            <a href="/focus" className="btn px-3 py-3 text-on-color/80 hover:text-on-color" title="Fullscreen focus mode (F)">
              <Icon name="expand" size={18} />
              <span className="sr-only">Focus mode</span>
            </a>
          )}
          {session?.surge && <Chip tone="dark" icon="bolt">Surge ×1.2</Chip>}
          {session && running && (
            <button className="btn-primary px-6 py-3 text-body" onClick={() => act("pause")} disabled={busy}>
              <Icon name="pause" size={18} /> Pause
            </button>
          )}
          {session && !running && (
            <button className="btn-primary px-6 py-3 text-body" onClick={() => act("resume")} disabled={busy}>
              <Icon name="play" size={18} /> Resume
            </button>
          )}
          {session && (
            <>
              <button className="btn border-2 border-on-color px-6 py-3 text-body text-on-color hover:bg-on-color/10" onClick={() => act("stop")} disabled={busy}>
                <Icon name="stop" size={16} /> Finish
              </button>
              <button className="btn px-3 py-3 text-on-color/70 hover:text-on-color" onClick={() => confirm("Discard this session? Nothing will be recorded.") && act("discard")} disabled={busy} title="Discard session">
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
      </div>

      <MascotSlot
        character="hero"
        state={heroState}
        size="md"
        enabled={mascots}
        className="pointer-events-none absolute bottom-32 right-6 hidden xl:flex"
      />
    </section>
  );
}
