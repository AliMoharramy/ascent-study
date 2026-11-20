"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FocusView } from "@/server/focus";
import { formatClock } from "@/domain/timer";
import { apiFetch, requestId } from "@/ui/client";
import { ProgressBar } from "@/ui/components";
import { Icon } from "@/ui/icons";

const QUOTES = ["One step. Then the next.", "The fog only moves when you do.", "Seed counts. Start.", "Depth beats breadth today."];

export function FocusMode({ initial, coreTitle, chapterId, target, doneToday }: { initial: FocusView | null; coreTitle: string; chapterId: string | null; target: number; doneToday: number }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [now, setNow] = useState(Date.now());
  const anchor = useRef(initial ? { c: Date.now(), e: initial.elapsedMs } : null);
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]!);
  const apply = (v: FocusView | null) => {
    setS(v);
    anchor.current = v ? { c: Date.now(), e: v.elapsedMs } : null;
  };
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    document.documentElement.requestFullscreen?.().catch(() => null);
    return () => {
      clearInterval(t);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => null);
    };
  }, []);
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
        if (!s) void act("start", { kind: "video", chapterId, subjectId: chapterId?.replace(/-\d+$/, "") ?? null, clientRequestId: requestId() });
        else void act(s.status === "running" ? "pause" : "resume");
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const elapsed = s && anchor.current ? anchor.current.e + (s.status === "running" ? now - anchor.current.c : 0) : 0;
  const mins = doneToday + Math.floor(elapsed / 60000);
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-bg p-6">
      <div className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
        <p className="text-body font-extrabold text-muted" dir="auto">
          {coreTitle}
        </p>
        <p className="font-display text-[clamp(96px,22vw,200px)] leading-none tracking-wide" aria-label={`Elapsed ${formatClock(elapsed)}`}>
          {formatClock(elapsed)}
        </p>
        <div className="w-full">
          <ProgressBar value={mins / Math.max(1, target)} tone="yellow" label="Standard goal" />
          <p className="mt-2 text-body-s font-bold text-muted">
            {mins} / {target} min Standard goal {s?.surge && "· Surge ×1.2"}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {!s && (
            <button className="btn-primary px-8 py-4 text-body" onClick={() => act("start", { kind: "video", chapterId, subjectId: chapterId?.replace(/-\d+$/, "") ?? null, clientRequestId: requestId() })} autoFocus>
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
