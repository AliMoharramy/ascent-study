"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { XpSummary } from "@/events/projections";
import { cx, ProgressBar } from "./components";
import { Icon } from "./icons";
import { playSound, type SoundKind } from "./sound";

/**
 * Feedback layer (#44, F-UXD-10): XP Pop (≤ 500 ms after a log), full-screen Level Up (dismissable), light
 * confetti, live header stats. Listens to the `ascent:mutated` bus emitted by apiFetch; every mutation also
 * refreshes server components so the whole page stays true. Honours prefers-reduced-motion.
 * Sounds (#106): pop = XP, chime = Level, drum = Boss — default OFF, volume from Settings, silenced in calm mode.
 */

type Ctx = { summary: XpSummary; celebrate: (msg: string) => void; toast: (msg: string, tone?: "ok" | "warn") => void };
const FeedbackCtx = createContext<Ctx | null>(null);
export const useFeedback = () => useContext(FeedbackCtx)!;

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function Confetti({ burst, calm }: { burst: number; calm: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!burst || reduced() || calm) return;
    const c = ref.current!;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    const colors = ["#F2C24E", "#8FD9D0", "#E8553F", "#7C6CF2", "#9BD24E"];
    const parts = Array.from({ length: 90 }, () => ({ x: c.width / 2, y: c.height / 3, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 12 - 4, r: Math.random() * 6 + 3, c: colors[Math.floor(Math.random() * colors.length)]!, a: Math.random() * 6 }));
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of parts) {
        p.vy += 0.35;
        p.x += p.vx;
        p.y += p.vy;
        p.a += 0.2;
        ctx.fillStyle = p.c;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
        ctx.restore();
      }
      if (t - t0 < 1500) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, c.width, c.height);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [burst, calm]);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true" />;
}

export function FeedbackProvider({ initial, sound = { enabled: false, volume: 0.5 }, calm = false, children }: { initial: XpSummary; sound?: { enabled: boolean; volume: number }; calm?: boolean; children: ReactNode }) {
  const router = useRouter();
  const [summary, setSummary] = useState(initial);
  const [pops, setPops] = useState<{ id: number; text: string }[]>([]);
  const [levelUp, setLevelUp] = useState<{ level: number; title: string } | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string; tone: "ok" | "warn" }[]>([]);
  const [burst, setBurst] = useState(0);
  const prev = useRef(initial);
  const refreshT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fx = useRef({ sound, calm });
  fx.current = { sound, calm };

  useEffect(() => {
    document.documentElement.dataset.calm = calm ? "on" : "off";
  }, [calm]);

  const sfx = useCallback((kind: SoundKind) => {
    const { sound: s, calm: c } = fx.current;
    if (s.enabled && !c) playSound(kind, s.volume);
  }, []);

  const toast = useCallback((text: string, tone: "ok" | "warn" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  const celebrate = useCallback(
    (text: string) => {
      setBurst((b) => b + 1);
      toast(text);
    },
    [toast],
  );

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { xp?: XpSummary; cleared?: boolean; achievements?: string[]; bossDefeated?: boolean } | undefined;
      if (d?.xp) {
        const gained = Math.round((d.xp.rawXp - prev.current.rawXp) * 10) / 10;
        if (gained > 0) {
          sfx("pop");
          const id = Date.now() + Math.random();
          setPops((p) => [...p, { id, text: `+${gained} XP` }]);
          setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1100);
        }
        if (d.xp.level > prev.current.level) {
          sfx("chime");
          setLevelUp({ level: d.xp.level, title: d.xp.title });
          setBurst((b) => b + 1);
        }
        prev.current = d.xp;
        setSummary(d.xp);
      }
      if (d?.bossDefeated) sfx("drum");
      if (d?.cleared) celebrate("Chapter cleared — a tower lights up on the map!");
      for (const a of d?.achievements ?? []) celebrate(`Achievement unlocked: ${a.replace(/_/g, " ")}`);
      if (refreshT.current) clearTimeout(refreshT.current);
      refreshT.current = setTimeout(() => router.refresh(), 60);
    };
    window.addEventListener("ascent:mutated", on);
    return () => window.removeEventListener("ascent:mutated", on);
  }, [router, celebrate, sfx]);

  useEffect(() => {
    if (!levelUp) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setLevelUp(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [levelUp]);

  return (
    <FeedbackCtx.Provider value={{ summary, celebrate, toast }}>
      {children}
      <Confetti burst={burst} calm={calm} />
      <div className="pointer-events-none fixed inset-x-0 top-20 z-[55] flex flex-col items-center gap-2" aria-live="polite">
        {pops.map((p) => (
          <span key={p.id} className="xp-pop rounded-pill bg-yellow px-4 py-1.5 font-display text-title-l text-on-color shadow-card">
            {p.text}
          </span>
        ))}
      </div>
      <div className="fixed bottom-24 end-4 z-[55] flex flex-col gap-2 md:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={cx("animate-pop max-w-sm rounded-2xl px-4 py-3 text-body-s font-extrabold shadow-card", t.tone === "ok" ? "bg-lime text-on-color" : "bg-coral text-on-color")}>
            {t.text}
          </div>
        ))}
      </div>
      {levelUp && (
        <div role="dialog" aria-modal="true" aria-label="Level up" className="fixed inset-0 z-[58] grid place-items-center bg-black/70 p-6" onClick={() => setLevelUp(null)}>
          <div className="animate-spring flex flex-col items-center gap-3 rounded-card bg-purple px-10 py-10 text-center text-white shadow-card">
            <p className="text-caption font-extrabold uppercase tracking-[0.3em]">Level up</p>
            <p className="font-display text-[120px] leading-none">{levelUp.level}</p>
            <p className="font-display text-title-l uppercase">{levelUp.title}</p>
            <button className="btn-primary mt-2" autoFocus onClick={() => setLevelUp(null)}>
              Continue <Icon name="arrow" size={16} />
            </button>
          </div>
        </div>
      )}
    </FeedbackCtx.Provider>
  );
}

/** Header strip: level, XP bar, Gold, daily goal (F-DUO-03) — live. */
export function HeaderStats({ goal }: { goal: { minutes: number; focus: number } }) {
  const { summary } = useFeedback();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="inline-flex items-center gap-2" title={`${summary.title} — ${summary.xpIntoLevel}/${summary.xpForNext} XP`}>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-purple font-display text-lg text-white">{summary.level}</span>
        <span className="hidden flex-col sm:flex">
          <span className="text-caption font-extrabold">{summary.title}</span>
          <ProgressBar value={summary.progress} tone="yellow" label="Level progress" className="h-1.5 w-28" />
        </span>
      </span>
      <span className="chip bg-yellow text-on-color" title="Gold">
        <Icon name="star" size={13} /> {Math.round(summary.gold)}
      </span>
      <span className="chip border border-line bg-surface-1 text-ink" title="Season Score this week">
        SS {Math.round(summary.weekSs)}
      </span>
      <span className="inline-flex items-center gap-2" title={`Daily goal ${goal.focus}/${goal.minutes} min`}>
        <Icon name="target" size={16} className={goal.focus >= goal.minutes ? "text-lime" : "text-muted"} />
        <ProgressBar value={goal.focus / Math.max(1, goal.minutes)} tone="lime" label="Daily goal" className="h-2 w-20" />
      </span>
    </div>
  );
}
