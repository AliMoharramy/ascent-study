import type { ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "./icons";

/** Color-Block presentational components (doc 12 §5). Server-safe (no hooks). */

export type Tone = "yellow" | "mint" | "coral" | "purple" | "lime" | "surface";

const toneBg: Record<Tone, string> = {
  yellow: "bg-yellow text-on-color",
  mint: "bg-mint text-on-color",
  coral: "bg-coral text-on-color",
  purple: "bg-purple text-white",
  lime: "bg-lime text-on-color",
  surface: "bg-surface-1 text-ink",
};

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ tone = "surface", className, children, as: As = "section", ...rest }: { tone?: Tone; className?: string; children: ReactNode; as?: "section" | "div" | "article"; "aria-label"?: string }) {
  return (
    <As className={cx("rounded-card p-5 shadow-card", toneBg[tone], className)} {...rest}>
      {children}
    </As>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-caption font-extrabold uppercase tracking-[0.14em]", className)}>{children}</p>;
}

export function Chip({ tone = "surface", icon, children, className }: { tone?: Tone | "dark"; icon?: IconName; children: ReactNode; className?: string }) {
  const cls = tone === "dark" ? "bg-on-color/90 text-white" : tone === "surface" ? "bg-surface-2 text-ink border border-line" : toneBg[tone];
  return (
    <span className={cx("chip", cls, className)}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

export function ProgressBar({ value, tone = "lime", track = "default", label, className }: { value: number; tone?: Tone; track?: "default" | "dark"; label?: string; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={cx("h-3 w-full overflow-hidden rounded-pill", track === "dark" ? "bg-on-color/15" : "bg-surface-2", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "progress"}>
      <div className={cx("h-full rounded-pill transition-[width] duration-700", toneBg[tone].split(" ")[0])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ProgressRing({ value, size = 64, stroke = 8, tone = "lime", children, label }: { value: number; size?: number; stroke?: number; tone?: Tone; children?: ReactNode; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const color = { yellow: "--c-yellow", mint: "--c-mint", coral: "--c-coral", purple: "--c-purple", lime: "--c-lime", surface: "--text" }[tone];
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(v * 100)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke="rgb(var(--border))" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={`rgb(var(${color}))`} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-caption font-extrabold">{children}</div>
    </div>
  );
}

export function StatTile({ label, value, unit, tone = "surface", hint }: { label: string; value: ReactNode; unit?: string; tone?: Tone; hint?: string }) {
  return (
    <div className={cx("rounded-3xl p-4", tone === "surface" ? "bg-surface-2 text-ink" : toneBg[tone])}>
      <p className="text-caption font-extrabold uppercase tracking-wider">{label}</p>
      <p className="mt-1 font-display text-display-m leading-none">
        {value}
        {unit && <span className="ms-1 font-body text-body-s font-extrabold">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-caption">{hint}</p>}
    </div>
  );
}

export function ModuleCard({ tone, eyebrow, title, children, chips, className }: { tone: Tone; eyebrow: string; title: ReactNode; children?: ReactNode; chips?: ReactNode; className?: string }) {
  return (
    <Card tone={tone} className={cx("flex flex-col gap-3", className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h3 className="font-display text-display-m uppercase leading-none">{title}</h3>
      {chips && <div className="flex flex-wrap gap-2">{chips}</div>}
      {children}
    </Card>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="font-display text-title-l uppercase tracking-wide">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon = "sparkle", title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 rounded-3xl border border-dashed border-line p-8 text-center text-muted">
      <Icon name={icon} size={28} />
      <p className="font-extrabold text-ink">{title}</p>
      {children}
    </div>
  );
}

// ── R1 Color-Block library additions (doc 12 §5) ─────────────

export function DueChip({ children, urgent }: { children: ReactNode; urgent?: boolean }) {
  return (
    <span className={cx("chip", urgent ? "bg-coral text-on-color" : "bg-on-color/90 text-white")}>
      <Icon name="clock" size={13} />
      {children}
    </span>
  );
}

export function TimeChip({ minutes, label = "min" }: { minutes: number; label?: string }) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return <span className="chip border border-line bg-surface-2 text-ink">{h ? `${h}h ${m}m` : `${m} ${label}`}</span>;
}

export function LevelBadge({ level, title, size = 44 }: { level: number; title?: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <span className="grid place-items-center rounded-full bg-purple font-display text-white shadow-[0_6px_18px_rgb(var(--c-purple)/.4)]" style={{ width: size, height: size, fontSize: size * 0.48 }} aria-label={`Level ${level}`}>
        {level}
      </span>
      {title && <span className="text-body-s font-extrabold">{title}</span>}
    </span>
  );
}

const MEDAL_TONE = { bronze: "from-[#E0A06A] to-[#A8643A]", silver: "from-[#E8E8EE] to-[#9A9AAA]", gold: "from-[#FFE08A] to-[#E5A92B]" } as const;

/** MedalBadge (doc 12 §5): round medal + name + condition; locked ones are greyed, with progress. */
export function MedalBadge({ name, description, tier, unlocked, progress }: { name: string; description: string; tier: keyof typeof MEDAL_TONE; unlocked: boolean; progress?: [number, number] }) {
  return (
    <div className={cx("flex flex-col items-center gap-2 rounded-3xl p-4 text-center", unlocked ? "bg-surface-2" : "bg-surface-2/50")}>
      <div className={cx("relative grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br shadow-card", unlocked ? MEDAL_TONE[tier] : "from-line to-line grayscale")} aria-hidden="true">
        <Icon name={unlocked ? "sparkle" : "target"} size={26} className={unlocked ? "text-on-color" : "text-muted"} />
        <span className={cx("absolute -bottom-1 h-4 w-8 rounded-b-md", unlocked ? "bg-coral" : "bg-line")} />
      </div>
      <p className={cx("text-body-s font-extrabold", !unlocked && "text-muted")}>{name}</p>
      <p className="text-caption text-muted">{description}</p>
      {!unlocked && progress && <ProgressBar value={progress[0] / Math.max(1, progress[1])} tone="purple" label={`${progress[0]} of ${progress[1]}`} className="h-1.5" />}
      <span className="sr-only">{unlocked ? "Unlocked" : "Locked"}</span>
    </div>
  );
}

/** Boss HP bar: 100 % HP at 0 net, empty at the threshold. */
export function BossBar({ hp, label }: { hp: number; label?: string }) {
  return (
    <div>
      <div className="flex justify-between text-caption font-extrabold">
        <span>{label ?? "Boss HP"}</span>
        <span>{Math.round(hp)}%</span>
      </div>
      <ProgressBar value={hp / 100} tone="coral" label="Boss HP" />
    </div>
  );
}

/** Shadow gap: you vs the Shadow (mastery points) with sign and colour + icon (never colour alone). */
export function ShadowGap({ you, shadow }: { you: number; shadow: number }) {
  const gap = Math.round((you - shadow) * 10) / 10;
  const max = Math.max(1, you, shadow);
  return (
    <div className="flex flex-col gap-2">
      {[
        ["You", you, "lime"],
        ["Shadow", shadow, "purple"],
      ].map(([l, v, t]) => (
        <div key={l as string} className="grid grid-cols-[64px_1fr_40px] items-center gap-2 text-body-s font-extrabold">
          <span>{l}</span>
          <ProgressBar value={(v as number) / max} tone={t as Tone} label={`${l} mastery points`} />
          <span className="text-end">{Math.round(v as number)}</span>
        </div>
      ))}
      <p className={cx("text-body-s font-extrabold", gap >= 0 ? "text-lime-ink" : "text-coral-ink")}>
        <Icon name={gap >= 0 ? "arrow" : "undo"} size={14} className="inline" /> Gap {gap >= 0 ? "+" : ""}
        {gap}
      </p>
    </div>
  );
}

/** Big number result card (BigNumberResultCard). */
export function BigNumber({ value, unit, label, tone = "coral" }: { value: ReactNode; unit?: string; label: string; tone?: Tone }) {
  return (
    <Card tone={tone} className="flex flex-col gap-1">
      <Eyebrow>{label}</Eyebrow>
      <p className="font-display text-display-xl leading-none">
        {value}
        {unit && <span className="text-display-m">{unit}</span>}
      </p>
    </Card>
  );
}

/** Big number result card (BigNumberResultCard, doc 12 §5) — giant % + optional celebration character. */
export function BigNumberResultCard({ pct, label, detail, tone = "coral", mascot }: { pct: number; label: string; detail?: ReactNode; tone?: Tone; mascot?: ReactNode }) {
  return (
    <Card tone={tone} className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <Eyebrow>{label}</Eyebrow>
        <p className="font-display text-display-xl leading-none">{Math.round(pct)}%</p>
        {detail && <p className="mt-1 text-body-s font-bold opacity-90">{detail}</p>}
      </div>
      {mascot}
    </Card>
  );
}

/** SectionPerformance (doc 12 §5): one bar per section, colour-coded by strength (never colour alone — % is shown). */
export function SectionPerformance({ items, label = "Section performance" }: { items: { name: string; pct: number; detail?: string }[]; label?: string }) {
  return (
    <Card className="flex flex-col gap-3">
      <Eyebrow>{label}</Eyebrow>
      {items.map((s) => (
        <div key={s.name}>
          <div className="flex justify-between gap-2 text-caption font-extrabold">
            <span>{s.name}</span>
            <span className="text-muted">
              {s.detail ? `${s.detail} · ` : ""}
              {Math.round(s.pct)}%
            </span>
          </div>
          <ProgressBar className="mt-1" value={s.pct / 100} tone={s.pct >= 75 ? "lime" : s.pct >= 50 ? "yellow" : "coral"} label={`${s.name} ${Math.round(s.pct)}%`} />
        </div>
      ))}
    </Card>
  );
}

/** InsightCard (doc 12 §5): mint next-step card with an action. */
export function InsightCard({ eyebrow = "Next step", title, children, href, cta = "Review mistakes" }: { eyebrow?: string; title: string; children?: ReactNode; href: string; cta?: string }) {
  return (
    <Card tone="mint" className="flex flex-col gap-2">
      <Eyebrow>{eyebrow}</Eyebrow>
      <p className="text-title-m font-extrabold leading-tight">{title}</p>
      {children && <p className="text-body-s opacity-80">{children}</p>}
      <Link href={href} className="btn-primary mt-1 w-fit">
        {cta} <Icon name="arrow" size={15} />
      </Link>
    </Card>
  );
}

/** StreakCard (doc 12 §5): flame + days + whether today kept it. */
export function StreakCard({ days, kept, hint }: { days: number; kept: boolean; hint?: string }) {
  return (
    <Card tone="yellow" className="flex items-center gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-on-color/10 text-on-color">
        <Icon name="flame" size={22} />
      </span>
      <div className="min-w-0">
        <Eyebrow>{kept ? "Flame kept" : "Flame at risk"}</Eyebrow>
        <p className="font-display text-display-m leading-none">{days} days</p>
        {hint && <p className="text-caption font-bold opacity-80">{hint}</p>}
      </div>
    </Card>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="font-display text-display-m uppercase leading-none md:text-display-l">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
