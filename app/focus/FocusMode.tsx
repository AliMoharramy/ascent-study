"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusView } from "@/server/focus";
import { formatClock } from "@/domain/timer";
import { FOCUS_KIND_OPTIONS, focusKindLabel, type FocusKind } from "@/domain/focus";
import { apiFetch, requestId } from "@/ui/client";
import { ProgressBar } from "@/ui/components";
import { Icon } from "@/ui/icons";

const QUOTES = ["One step. Then the next.", "The fog only moves when you do.", "Seed counts. Start.", "Depth beats breadth today."];

export function FocusMode({ initial, today, coreId, coreTitle, chapterId, target, doneToday }: { initial: FocusView | null; today: string; coreId: string | null; coreTitle: string; chapterId: string | null; target: number; doneToday: number }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [kind, setKind] = useState<FocusKind>(initial?.kind ?? "video");
  const [minutesToday, setMinutesToday] = useState(doneToday);
  const [now, setNow] = useState(Date.now());
  const [idleAsk, setIdleAsk] = useState<number | null>(null);
  const lastActive = useRef(Date.now());
  const anchor = useRef(initial ? { c: Date.now(), e: initial.elapsedMs } : null);
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]!);
  const apply = useCallback((v: FocusView | null) => {
    setS(v);
    if (v) setKind(v.kind);
    anchor.current = v ? { c: Date.now(), e: v.elapsedMs } : null;
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    document.documentElement.requestFullscreen?.().catch(() => null);
    return () => {
      clearInterval(t);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => null);
    };
  }, []);
  const syncFocus = useCallback(async () => {
    const r = await apiFetch<{ session: FocusView | null; todayMinutes: number }>("/api/focus").catch(() => null);
    if (r) {
      apply(r.session);
      setMinutesToday(r.todayMinutes);
    }
  }, [apply]);
  useEffect(() => {
    void syncFocus();
    const poll = setInterval(() => void syncFocus(), 30_000);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void syncFocus(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [syncFocus]);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    const r = await apiFetch<{ session: FocusView | null }>("/api/focus", { body: { action, ...extra } });
    if (action === "stop") {
      router.push("/today");
      return;
    }
    apply(r.session);
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push("/today");
      if (e.code === "Space") {
        e.preventDefault();
        if (!s) void act("start", startPayload());
        else void act(s.status === "running" ? "pause" : "resume");
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  useEffect(() => {
    if (s?.status !== "running") {
      setIdleAsk(null);
      lastActive.current = Date.now();
      return;
    }
    const mark = () => {
      lastActive.current = Date.now();
    };
    const events = ["mousemove", "keydown", "pointerdown", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, mark, { passive: true }));
    const timer = setInterval(async () => {
      const idleFor = Date.now() - lastActive.current;
      if (idleAsk === null && idleFor > 5 * 60_000) setIdleAsk(Date.now());
      if (idleAsk !== null && Date.now() - idleAsk > 60_000) {
        setIdleAsk(null);
        const response = await apiFetch<{ session: FocusView | null }>("/api/focus", { body: { action: "idle" } }).catch(() => null);
        if (response) apply(response.session);
      }
    }, 5000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, mark));
      clearInterval(timer);
    };
  }, [s?.status, idleAsk, apply]);
  const elapsed = s && anchor.current ? anchor.current.e + (s.status === "running" ? now - anchor.current.c : 0) : 0;
  const sessionCountsToday = s?.gameDay === today;
  const completedToday = Math.max(0, minutesToday - (sessionCountsToday ? Math.floor(s!.elapsedMs / 60_000) : 0));
  const mins = completedToday + (sessionCountsToday ? Math.floor(elapsed / 60_000) : 0);
  function startPayload() {
    return {
      kind,
      chapterId,
      subjectId: chapterId?.replace(/-\d+$/, "") ?? null,
      taskSource: coreId ? "Today" : null,
      taskId: coreId,
      taskTitle: coreId ? coreTitle : null,
      clientRequestId: requestId(),
    };
  }
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-bg p-6">
      <div className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
        <p className="text-body font-extrabold text-muted" dir="auto">
          {coreTitle}
        </p>
        {s?.taskTitle && <p className="text-body font-bold" dir="auto">Working on: {s.taskTitle}</p>}
        {s && (
          <div className="flex flex-wrap justify-center gap-2">
            <span className="chip">{focusKindLabel(s.kind)}</span>
            <span className="chip">{s.status === "running" ? "Live" : "Paused"}</span>
          </div>
        )}
        <p className="font-display text-[clamp(96px,22vw,200px)] leading-none tracking-wide" aria-label={`Elapsed ${formatClock(elapsed)}`}>
          {formatClock(elapsed)}
        </p>
        <div className="w-full">
          <ProgressBar value={mins / Math.max(1, target)} tone="yellow" label="Standard goal" />
          <p className="mt-2 text-body-s font-bold text-muted">
            {mins} / {target} min Standard goal {s?.surge && "· Surge ×1.2"}
          </p>
        </div>
        {idleAsk !== null && s?.status === "running" && (
          <div role="alertdialog" aria-label="Still there?" className="flex flex-wrap items-center justify-center gap-3 rounded-2xl bg-on-color px-4 py-3 text-white">
            <span className="text-body-s font-bold">Still studying? The timer pauses in a minute without an answer.</span>
            <button className="btn bg-yellow px-4 py-1.5 text-on-color" onClick={() => { lastActive.current = Date.now(); setIdleAsk(null); }}>
              I&apos;m here
            </button>
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          {!s && (
            <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Session type">
              {FOCUS_KIND_OPTIONS.map((option) => (
                <button key={option.id} type="button" onClick={() => setKind(option.id)} aria-pressed={kind === option.id} className={`chip border-2 border-on-color/80 py-1.5 text-body-s ${kind === option.id ? "bg-on-color text-white" : "bg-transparent text-on-color hover:bg-on-color/10"}`}>
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {!s && (
            <button className="btn-primary px-8 py-4 text-body" onClick={() => act("start", startPayload())} autoFocus>
              <Icon name="play" size={18} /> Start
            </button>
          )}
          {s && (
            <button className="btn-primary px-8 py-4 text-body" onClick={() => act(s.status === "running" ? "pause" : "resume")}>
              <Icon name={s.status === "running" ? "pause" : "play"} size={18} /> {s.status === "running" ? "Pause" : "Resume"}
            </button>
          )}
          {s && (
            <button className="btn-ghost px-8 py-4 text-body" onClick={() => act("stop")}>
              <Icon name="stop" size={16} /> Finish
            </button>
          )}
        </div>
        <p className="text-body-s italic text-muted">{quote}</p>
        <button className="text-caption text-muted underline" onClick={() => router.push("/today")}>
          Exit focus mode (Esc)
        </button>
      </div>
    </main>
  );
}
