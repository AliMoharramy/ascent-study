"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/ui/components";
import { Icon, type IconName } from "@/ui/icons";

export type MapNode = { id: string; subjectId: string; no: number; title: string; tier: "M" | "S" | "C" | null; optional: boolean; state: "cleared" | "progress" | "fog" | "unseen"; net: number | null; plannedWeek: number | null; fogPct: number; fogWeeks: number; weight: number | null; special: "checkpoint" | "legendary" | null };
export type MapSubject = { id: string; nameEn: string; nameFa: string };
export type CapsuleInfo = { sealed: boolean; opensOn: string; daysLeft: number; open: boolean; text?: string; error?: string };

/**
 * World Map (#50, F-MAP-01, S03): 4 realms + Basecamp, one node per chapter. SVG (≈ 100 nodes stay smooth),
 * wheel/pinch zoom + drag pan, keyboard-focusable nodes, click → chapter page. States use colour + shape.
 */
const REALMS = [
  { key: "I", name: "Citadel of Minds", subs: ["ai", "discrete"], x: 640, y: 420, color: "--c-yellow" },
  { key: "II", name: "Forge of Structures", subs: ["dsa", "logic"], x: 40, y: 420, color: "--c-mint" },
  { key: "III", name: "Machine Spire", subs: ["arch", "toc"], x: 640, y: 40, color: "--c-coral" },
  { key: "IV", name: "Deep Systems", subs: ["os", "stats"], x: 40, y: 40, color: "--c-purple" },
  { key: "◇", name: "Basecamp (daily)", subs: ["foundations", "english"], x: 340, y: 840, color: "--c-lime" },
];
const W = 520;

export function WorldMap({ nodes, subjects, fogEnabled, capsule }: { nodes: MapNode[]; subjects: MapSubject[]; fogEnabled: boolean; capsule: CapsuleInfo }) {
  const router = useRouter();
  const [vb, setVb] = useState({ x: 0, y: 0, w: 1200, h: 1260 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<MapNode | null>(null);
  const [localFog, setLocalFog] = useState<boolean | null>(null);
  const [showWeights, setShowWeights] = useState(false);
  const [view, setView] = useState<"map" | "path">("map");
  const [summit, setSummit] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("ascent:fog");
    if (saved) setLocalFog(saved === "on");
    setShowWeights(localStorage.getItem("ascent:weights") === "on");
    const v = localStorage.getItem("ascent:mapview");
    if (v === "map" || v === "path") setView(v);
    else if (window.matchMedia("(max-width: 767px)").matches) setView("path");
  }, []);
  const switchView = (v: "map" | "path") => {
    setView(v);
    localStorage.setItem("ascent:mapview", v);
  };
  const showFog = fogEnabled && (localFog ?? true);
  const toggleFog = () => {
    const next = !showFog;
    setLocalFog(next);
    localStorage.setItem("ascent:fog", next ? "on" : "off");
  };
  const toggleWeights = () => {
    const next = !showWeights;
    setShowWeights(next);
    localStorage.setItem("ascent:weights", next ? "on" : "off");
  };

  const placed = useMemo(() => {
    const out: (MapNode & { cx: number; cy: number; realm: string })[] = [];
    for (const r of REALMS)
      r.subs.forEach((sid, row) => {
        const list = nodes.filter((n) => n.subjectId === sid);
        const step = Math.min(70, (W - 40) / Math.max(1, list.length - 1 || 1));
        list.forEach((n, i) => out.push({ ...n, realm: r.key, cx: r.x + 40 + i * step, cy: r.y + 140 + row * 160 + (i % 2 ? 22 : -8) }));
      });
    return out;
  }, [nodes]);

  const zoom = (f: number, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) => {
    const w = Math.min(2400, Math.max(300, vb.w * f));
    const h = (w / vb.w) * vb.h;
    setVb({ x: cx - ((cx - vb.x) * w) / vb.w, y: cy - ((cy - vb.y) * h) / vb.h, w, h });
  };

  return (
    <div className="card relative overflow-hidden p-0">
      <div className="absolute end-3 top-3 z-10 flex flex-wrap justify-end gap-1.5">
        <div className="flex rounded-xl bg-surface-1 p-0.5 shadow-card" role="group" aria-label="Map view mode">
          <button className={cx("rounded-lg px-3 py-1.5 text-caption font-extrabold", view === "map" ? "bg-purple text-white" : "text-muted")} onClick={() => switchView("map")} aria-pressed={view === "map"}>
            Map
          </button>
          <button className={cx("rounded-lg px-3 py-1.5 text-caption font-extrabold", view === "path" ? "bg-purple text-white" : "text-muted")} onClick={() => switchView("path")} aria-pressed={view === "path"}>
            Path
          </button>
        </div>
        {view === "map" && (
          <>
            <button className="btn-ghost bg-surface-1 px-3 py-1.5" onClick={() => zoom(0.8)} aria-label="Zoom in">
              <Icon name="plus" size={16} />
            </button>
            <button className="btn-ghost bg-surface-1 px-3 py-1.5" onClick={() => zoom(1.25)} aria-label="Zoom out">
              –
            </button>
            <button className="btn-ghost bg-surface-1 px-3 py-1.5" onClick={() => setVb({ x: 0, y: 0, w: 1200, h: 1260 })}>
              Reset
            </button>
          </>
        )}
        <button
          className={cx("btn-ghost bg-surface-1 px-3 py-1.5", showFog && "ring-2 ring-coral")}
          onClick={toggleFog}
          disabled={!fogEnabled}
          aria-pressed={showFog}
          title={fogEnabled ? "Territory Fog — a display layer only; nodes stay clickable" : "Territory Fog is switched off in Settings → Feature flags"}
        >
          Fog {showFog ? "on" : "off"}
        </button>
        <button className={cx("btn-ghost bg-surface-1 px-3 py-1.5", showWeights && "ring-2 ring-purple")} onClick={toggleWeights} aria-pressed={showWeights} title="Show every chapter's share of its subject's expected exam questions (T-DATA-07)">
          Weights {showWeights ? "on" : "off"}
        </button>
      </div>
      {view === "map" && (
      <svg
        ref={svg}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="h-[72vh] w-full touch-none select-none bg-[radial-gradient(circle_at_50%_40%,rgb(var(--surface-2)),rgb(var(--bg)))]"
        role="group"
        aria-label="World map of chapters"
        onWheel={(e) => {
          const r = svg.current!.getBoundingClientRect();
          zoom(e.deltaY > 0 ? 1.1 : 0.9, vb.x + ((e.clientX - r.left) / r.width) * vb.w, vb.y + ((e.clientY - r.top) / r.height) * vb.h);
        }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[data-node]")) return;
          drag.current = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const r = svg.current!.getBoundingClientRect();
          setVb((v) => ({ ...v, x: drag.current!.vx - ((e.clientX - drag.current!.x) / r.width) * v.w, y: drag.current!.vy - ((e.clientY - drag.current!.y) / r.height) * v.h }));
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern id="fog" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="10" stroke="rgb(var(--text-muted))" strokeWidth="3" opacity="0.5" />
          </pattern>
          <radialGradient id="fogGrad">
            <stop offset="0%" stopColor="rgb(var(--text-muted))" stopOpacity="0.5" />
            <stop offset="65%" stopColor="rgb(var(--text-muted))" stopOpacity="0.26" />
            <stop offset="100%" stopColor="rgb(var(--text-muted))" stopOpacity="0" />
          </radialGradient>
          <filter id="fogSoft" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <path d="M600 860 L600 560 M600 560 L340 520 M600 560 L860 520 M340 380 L340 200 M860 380 L860 200 M340 200 L600 120 L860 200" stroke="rgb(var(--border))" strokeWidth="6" strokeDasharray="4 14" strokeLinecap="round" fill="none" />
        <g
          aria-label={`SUMMIT ${capsule.open ? "✉ letter open" : capsule.sealed ? `✉ sealed · ${capsule.daysLeft}d` : "✉ no letter yet"} — time capsule`}
          role="button"
          tabIndex={0}
          className="cursor-pointer outline-none focus-visible:[&>path]:stroke-[rgb(var(--focus-ring))]"
          onClick={() => setSummit(true)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSummit(true)}
        >
          <path d="M560 110 L600 40 L640 110 Z" fill="rgb(var(--c-yellow))" strokeWidth="2.5" />
          <text x="600" y="140" textAnchor="middle" className="fill-[rgb(var(--text))] font-display text-[22px]">
            SUMMIT
          </text>
          <text x="600" y="162" textAnchor="middle" className="fill-[rgb(var(--text-muted))] text-[13px] font-bold">
            {capsule.open ? "✉ letter open" : capsule.sealed ? `✉ sealed · ${capsule.daysLeft}d` : "✉ no letter yet"}
          </text>
        </g>
        {REALMS.map((r) => (
          <g key={r.key}>
            <rect x={r.x} y={r.y + 30} width={W} height={r.key === "◇" ? 340 : 360} rx="36" fill={`rgb(var(${r.color}) / 0.08)`} stroke={`rgb(var(${r.color}) / 0.5)`} strokeWidth="2" />
            <text x={r.x + 24} y={r.y + 66} className="fill-[rgb(var(--text))] font-display text-[26px] uppercase">
              {r.key !== "◇" ? `Realm ${r.key} · ` : ""}
              {r.name}
            </text>
            {r.subs.map((sid, row) => (
              <text key={sid} x={r.x + 24} y={r.y + 100 + row * 160} className="fill-[rgb(var(--text-muted))] text-[15px] font-bold">
                {subjects.find((s) => s.id === sid)?.nameEn}
              </text>
            ))}
            {r.key !== "◇" && (
              <g aria-label={`Gatekeeper of realm ${r.key}`}>
                <circle cx={r.x + W - 30} cy={r.y + 60} r="18" fill="rgb(var(--c-coral))" />
                <text x={r.x + W - 30} y={r.y + 66} textAnchor="middle" className="fill-[rgb(17_17_20)] text-[16px] font-black">
                  ☠
                </text>
              </g>
            )}
          </g>
        ))}
        {placed.map((n, i) => {
          const prev = placed[i - 1];
          return prev && prev.subjectId === n.subjectId ? <line key={`l${n.id}`} x1={prev.cx} y1={prev.cy} x2={n.cx} y2={n.cy} stroke="rgb(var(--border))" strokeWidth="3" /> : null;
        })}
        {placed.map((n) => {
          const r = n.optional ? 13 : n.tier === "M" ? 22 : n.tier === "S" ? 18 : 15;
          const fill = n.state === "cleared" ? "rgb(var(--c-yellow))" : n.state === "progress" ? "rgb(var(--c-mint))" : "rgb(var(--surface-1))";
          return (
            <g
              key={n.id}
              data-node
              tabIndex={0}
              role="link"
              aria-label={`${n.subjectId} chapter ${n.no}: ${n.title} — ${n.state}${n.tier ? `, tier ${n.tier}` : ""}${n.weight != null ? `, exam weight ${(n.weight * 100).toFixed(1)}%` : ""}${n.special ? `, ${n.special} node` : ""}`}
              className="cursor-pointer outline-none focus-visible:[&>circle]:stroke-[rgb(var(--focus-ring))]"
              onClick={() => router.push(`/map/${n.id}`)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && router.push(`/map/${n.id}`)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(n)}
            >
              <circle cx={n.cx} cy={n.cy} r={r} fill={fill} stroke={n.state === "cleared" ? "rgb(var(--c-yellow))" : n.state === "fog" ? "rgb(var(--c-coral))" : "rgb(var(--text-muted))"} strokeWidth="2.5" filter={n.state === "cleared" ? "url(#glow)" : undefined} opacity={n.optional ? 0.6 : 1} className={n.state === "cleared" ? "node-light" : ""} />
              {n.special === "legendary" && (
                <g className="pointer-events-none" aria-hidden="true">
                  <circle cx={n.cx} cy={n.cy} r={r + 8} fill="none" stroke="rgb(var(--c-purple))" strokeWidth="2.5" strokeDasharray="3 4" />
                  <text x={n.cx} y={n.cy - r - 7} textAnchor="middle" className="fill-[rgb(var(--c-purple))] text-[13px] font-black">
                    ✦
                  </text>
                </g>
              )}
              {n.special === "checkpoint" && (
                <g className="pointer-events-none" aria-hidden="true">
                  <path d={`M${n.cx + r * 0.7} ${n.cy - r * 1.5} v${-r * 0.85} h${r * 0.75}`} fill="none" stroke="rgb(var(--c-mint))" strokeWidth="2" />
                  <text x={n.cx + r * 0.7 + r * 0.8} y={n.cy - r * 2 + 3} className="fill-[rgb(var(--c-mint))] text-[11px] font-black">
                    ⚑
                  </text>
                </g>
              )}
              {showFog && n.fogPct > 0 && (
                <g className="pointer-events-none" opacity={n.fogPct} aria-hidden="true">
                  <circle cx={n.cx} cy={n.cy} r={r + 15} fill="url(#fogGrad)" filter="url(#fogSoft)" />
                  <circle cx={n.cx - r * 0.8} cy={n.cy - r * 0.55} r={r * 0.7} fill="rgb(var(--text-muted))" opacity="0.16" filter="url(#fogSoft)" />
                  <circle cx={n.cx + r * 0.7} cy={n.cy + r * 0.45} r={r * 0.55} fill="rgb(var(--text-muted))" opacity="0.12" filter="url(#fogSoft)" />
                </g>
              )}
              <text x={n.cx} y={n.cy + 5} textAnchor="middle" className="pointer-events-none fill-[rgb(17_17_20)] text-[13px] font-black" style={{ fill: n.state === "unseen" || n.state === "fog" ? "rgb(var(--text))" : undefined }}>
                {n.state === "cleared" ? "★" : n.no}
              </text>
              {showWeights && n.weight != null && (
                <text x={n.cx} y={n.cy + r + 13} textAnchor="middle" className="pointer-events-none fill-[rgb(var(--c-coral))] text-[10px] font-black">
                  {n.weight * 100 < 1 ? (n.weight * 100).toFixed(1) : Math.round(n.weight * 100)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
      )}
      {view === "path" && <PathView nodes={nodes} subjects={subjects} showWeights={showWeights} capsule={capsule} />}
      {summit && view === "map" && (
        <div className="absolute inset-x-3 top-16 z-20 mx-auto max-w-md">
          <CapsulePanel capsule={capsule} onClose={() => setSummit(false)} />
        </div>
      )}
      {hover && view === "map" && (
        <div className="pointer-events-none absolute bottom-3 start-3 max-w-sm rounded-2xl bg-surface-1 p-3 shadow-card" role="status">
          <p className="text-caption font-extrabold uppercase text-muted">
            {hover.subjectId} · Ch.{hover.no} {hover.tier && `· Tier ${hover.tier}`} {hover.optional && "· optional"} {hover.weight != null && `· Eq ${(hover.weight * 100).toFixed(1)}%`}
          </p>
          <p className="fa font-bold" dir="rtl">
            {hover.title}
          </p>
          <p className="text-caption">
            {hover.state === "cleared" ? "Cleared ★ — fog lifted" : hover.state === "progress" ? `In progress${hover.net != null ? ` · net ${Math.round(hover.net)}%` : ""}${hover.fogPct > 0 ? ` · light haze (${hover.fogWeeks} week(s) behind)` : ""}` : hover.state === "fog" ? `Fog — ${hover.fogWeeks} week(s) behind plan${showFog ? "" : " · fog hidden"}` : hover.plannedWeek ? `Planned week ${hover.plannedWeek}` : "Not planned"}
            {hover.special === "legendary" ? " · ✦ Legendary node (third review round or a hard boss)" : hover.special === "checkpoint" ? " · ⚑ Checkpoint node" : ""}
          </p>
          {hover.fogPct > 0 && showFog && <p className="text-caption text-muted">Fog thins with a settled Comeback and disappears when you clear the chapter. Click still works.</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-3 border-t border-line px-4 py-3 text-caption font-bold">
        {(view === "map"
          ? [
              ["bg-yellow", "★ Cleared"],
              ["bg-mint", "In progress"],
              ["bg-surface-2 border border-line", "Unseen"],
              ["bg-[repeating-linear-gradient(45deg,rgb(var(--text-muted)),rgb(var(--text-muted))_2px,transparent_2px,transparent_6px)]", "Fog (behind plan)"],
              ["bg-coral", "☠ Gatekeeper"],
              ["bg-mint", "⚑ Checkpoint"],
              ["bg-purple", "✦ Legendary"],
            ]
          : [
              ["bg-yellow", "Completed"],
              ["bg-mint", "Continue"],
              ["bg-surface-2 border border-line", "Locked"],
            ]
        ).map(([c, l]) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span className={cx("h-3.5 w-3.5 rounded-full", c)} aria-hidden="true" />
            {l}
          </span>
        ))}
        <span className="text-muted">
          {view === "map" ? "Bigger node = higher tier (M > S > C). Drag to pan, wheel to zoom. Click the Summit for your time capsule." : "Completed / Continue / Locked mirrors the map: cleared ★, in progress, not started or behind plan. Locked chapters stay openable — fog is display-only."}
        </span>
        <span className="text-muted">Fog is display-only: it lifts with Comeback and clears with a cleared chapter; switch it off above or in Settings.</span>
      </div>
    </div>
  );
}

const PATH_STATUS: Record<MapNode["state"], { label: string; icon: IconName; dot: string; chip: string }> = {
  cleared: { label: "Completed", icon: "check", dot: "bg-yellow text-on-color", chip: "bg-yellow text-on-color" },
  progress: { label: "Continue", icon: "play", dot: "bg-mint text-on-color", chip: "bg-mint text-on-color" },
  fog: { label: "Locked", icon: "lock", dot: "border border-line bg-surface-1 text-muted", chip: "bg-surface-1 text-muted" },
  unseen: { label: "Locked", icon: "lock", dot: "border border-line bg-surface-1 text-muted", chip: "bg-surface-1 text-muted" },
};

/** Vertical Path view (#86, F-DUO-09): Lesson-Overview style list, same node states as the SVG map. */
function PathView({ nodes, subjects, showWeights, capsule }: { nodes: MapNode[]; subjects: MapSubject[]; showWeights: boolean; capsule: CapsuleInfo }) {
  const router = useRouter();
  return (
    <div className="max-h-[72vh] overflow-y-auto px-3 py-4">
      <CapsulePanel capsule={capsule} />
      {REALMS.map((r) => (
        <section key={r.key} className="mb-5">
          <h3 className="mb-2 font-display text-body-s uppercase" style={{ color: `rgb(var(${r.color}))` }}>
            {r.key !== "◇" ? `Realm ${r.key} · ` : ""}
            {r.name}
          </h3>
          {r.subs.map((sid) => {
            const list = nodes.filter((n) => n.subjectId === sid);
            if (!list.length) return null;
            return (
              <div key={sid} className="mb-3">
                <p className="mb-1 text-caption font-extrabold text-muted">{subjects.find((s) => s.id === sid)?.nameEn}</p>
                <ol className="ms-2 flex flex-col gap-1.5 border-s-2 border-line ps-4">
                  {list.map((n) => {
                    const st = PATH_STATUS[n.state];
                    return (
                      <li key={n.id}>
                        <button type="button" onClick={() => router.push(`/map/${n.id}`)} className="flex w-full items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-start hover:bg-surface-1">
                          <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full", st.dot)}>
                            <Icon name={st.icon} size={15} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="fa block truncate font-bold" dir="auto">
                              Ch.{n.no} · {n.title}
                            </span>
                            <span className="block text-caption text-muted">
                              {n.tier ? `Tier ${n.tier}` : "Core"}
                              {n.optional ? " · optional" : ""}
                              {n.net != null ? ` · net ${Math.round(n.net)}%` : ""}
                              {showWeights && n.weight != null ? ` · Eq ${(n.weight * 100).toFixed(1)}%` : ""}
                              {n.state === "fog" ? ` · ${n.fogWeeks}w behind plan` : ""}
                              {n.special ? ` · ${n.special}` : ""}
                            </span>
                          </span>
                          <span className={cx("chip shrink-0", st.chip)}>{st.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** Summit time capsule (#90, F-STY-02): sealed countdown, or the decrypted letter on exam day. */
function CapsulePanel({ capsule, onClose }: { capsule: CapsuleInfo; onClose?: () => void }) {
  return (
    <div className="mb-3 rounded-2xl border border-line bg-surface-1 p-3 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-caption font-extrabold uppercase text-muted">
          <Icon name="mail" size={14} /> Summit · time capsule
        </p>
        {onClose && (
          <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Close capsule">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      {capsule.open ? (
        <p className="fa mt-2 whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-body-s" dir="auto">
          {capsule.text}
        </p>
      ) : capsule.error ? (
        <p className="mt-2 text-body-s text-coral-ink">{capsule.error}</p>
      ) : capsule.sealed ? (
        <p className="mt-2 text-body-s">
          Sealed until {capsule.opensOn} · <b className="text-yellow-ink">{capsule.daysLeft} days</b> to the exam morning.
        </p>
      ) : (
        <p className="mt-2 text-body-s text-muted">
          No letter yet — <Link href="/character" className="font-extrabold text-purple-ink underline">seal one at Me → Time capsule</Link> ({capsule.daysLeft} days left).
        </p>
      )}
    </div>
  );
}
