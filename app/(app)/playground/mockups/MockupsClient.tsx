"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { apiFetch } from "@/ui/client";
import { Art } from "@/ui/Art";
import { Chip, Eyebrow, ProgressBar } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";
import { MascotSlot } from "@/ui/Mascot";

type Theme = "night" | "cream";
type Approval = { approvedAt: string; reference: string; screens: string[]; themes: string[]; note?: string } | null;

const REALMS = [
  { name: "Library Citadel", art: "/art/realms/realm-1.webp", subject: "Physics" },
  { name: "The Forge", art: "/art/realms/realm-2.webp", subject: "Math" },
  { name: "Circuit Tower", art: "/art/realms/realm-3.webp", subject: "Chemistry" },
  { name: "Deep Cave", art: "/art/realms/realm-4.webp", subject: "Biology" },
];

function Frame({ theme, label, children }: { theme: Theme; label: string; children: ReactNode }) {
  return (
    <div data-theme={theme} className="rounded-[30px] border border-line bg-bg p-4 text-ink shadow-card">
      <div className="mb-3 flex items-center justify-between text-caption font-extrabold uppercase tracking-[0.14em] text-muted">
        <span>{label}</span>
        <span className="flex items-center gap-1">
          <Icon name={theme === "night" ? "moon" : "sun"} size={12} />
          {theme}
        </span>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function TodayMock() {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <Eyebrow>Week 7 · Day 3</Eyebrow>
          <p className="font-display text-[32px] uppercase leading-none">Ready, Ali?</p>
        </div>
        <MascotSlot character="hero" state="happy" size="sm" />
      </div>
      <div className="rounded-3xl bg-yellow p-4 text-on-color">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-caption font-extrabold uppercase tracking-wider opacity-80">Today&apos;s focus</p>
            <p className="font-display text-[44px] leading-none">
              96<span className="ms-1 font-body text-body-s font-extrabold opacity-70">/ 120 min</span>
            </p>
          </div>
          <span className="flex items-center gap-1 rounded-pill bg-on-color/10 px-2 py-1 text-caption font-extrabold">
            <Icon name="flame" size={13} /> 12
          </span>
        </div>
        <Link href="/today" className="btn-primary mt-3 w-full justify-center">
          <Icon name="play" size={14} /> Start focus
        </Link>
      </div>
      {[
        ["Sheikh Baha'i — set 3", "Math · 25 min", true],
        ["Physics ch.5 — problems", "25 min", false],
        ["Sleep on time", "Pillar · 22:45", false],
      ].map(([title, meta, done]) => (
        <div key={String(title)} className="flex items-center gap-3 rounded-2xl bg-surface-1 p-3 shadow-card">
          <span className={done ? "grid h-7 w-7 place-items-center rounded-full bg-lime text-on-color" : "grid h-7 w-7 place-items-center rounded-full border-2 border-line text-muted"}>
            {done ? <Icon name="check" size={14} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-s font-extrabold">{title}</p>
            <p className="text-caption text-muted">{meta}</p>
          </div>
          {done && <Chip tone="mint">+12 XP</Chip>}
        </div>
      ))}
    </>
  );
}

function MapMock() {
  const [realm, setRealm] = useState(0);
  const r = REALMS[realm] ?? REALMS[0]!;
  return (
    <>
      <div>
        <Eyebrow>World map · Ch.3</Eyebrow>
        <p className="font-display text-[28px] uppercase leading-none">The Realm Road</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {REALMS.map((x, i) => (
          <button key={x.name} onClick={() => setRealm(i)} className={i === realm ? "chip bg-purple text-white" : "chip border border-line bg-surface-2 text-ink"}>
            {i + 1}
          </button>
        ))}
      </div>
      <div className="relative overflow-hidden rounded-3xl border border-line">
        <Art src="/art/map/world-map.webp" alt="" width={2400} height={1600} className="h-36 w-full object-cover" fallback={<div className="h-36 bg-surface-2" />} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <div className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
          <div className="text-white">
            <p className="text-caption font-extrabold uppercase tracking-wider opacity-80">Region {realm + 1} · {r.subject}</p>
            <p className="font-display text-title-l uppercase leading-none">{r.name}</p>
          </div>
          <MascotSlot character="shade" state="smug" size="xs" />
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl bg-surface-1 p-2 shadow-card">
        <Art src={r.art} alt="" width={1600} height={900} className="h-14 w-20 rounded-xl object-cover" fallback={<div className="h-14 w-20 rounded-xl bg-surface-2" />} />
        <div className="min-w-0 flex-1">
          <p className="text-body-s font-extrabold">{r.name}</p>
          <ProgressBar className="mt-1" value={0.64} tone="mint" label="Region cleared" />
        </div>
        <Chip tone="coral">Fog</Chip>
      </div>
    </>
  );
}

function ResultMock() {
  const sections = [
    ["Math", 0.83, "10/12"],
    ["Physics", 0.66, "4/6"],
    ["Chemistry", 0.8, "4/5"],
  ] as const;
  return (
    <>
      <div className="rounded-3xl bg-coral p-5 text-on-color">
        <p className="text-caption font-extrabold uppercase tracking-[0.14em] opacity-80">Mini-run · 12 min</p>
        <p className="font-display text-[76px] leading-none">78%</p>
        <p className="text-body-s font-bold opacity-90">18 / 23 correct · +36 XP · Shadow beaten</p>
      </div>
      <div className="flex flex-col gap-2 rounded-3xl bg-surface-1 p-3 shadow-card">
        <Eyebrow>Section performance</Eyebrow>
        {sections.map(([name, value, score]) => (
          <div key={name}>
            <div className="flex justify-between text-caption font-extrabold">
              <span>{name}</span>
              <span className="text-muted">{score}</span>
            </div>
            <ProgressBar className="mt-1" value={value} tone={value >= 0.75 ? "lime" : "yellow"} label={`${name} score`} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 rounded-2xl bg-surface-1 p-3 shadow-card">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-yellow text-on-color">
          <Icon name="flame" size={17} />
        </span>
        <div className="flex-1">
          <p className="text-body-s font-extrabold">Flame 12 kept</p>
          <p className="text-caption text-muted">One honest session was enough.</p>
        </div>
        <MascotSlot character="archie" state="cheering" size="xs" />
      </div>
      <Link href="/forge" className="btn-accent w-full justify-center">
        <Icon name="hammer" size={14} /> Review mistakes
      </Link>
    </>
  );
}

function ProfileMock() {
  return (
    <>
      <div className="flex items-center gap-3">
        <MascotSlot character="hero" state="happy" size="md" />
        <div className="min-w-0 flex-1">
          <Eyebrow>Level 12 · Scholar</Eyebrow>
          <p className="font-display text-[30px] uppercase leading-none">Ali</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Chip tone="purple">2,480 XP</Chip>
            <Chip tone="mint">Flame 12</Chip>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          ["Chapters", "14"],
          ["Bosses", "6"],
          ["Shields", "2"],
          ["Accuracy", "68%"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-surface-2 p-3">
            <p className="text-caption font-extrabold uppercase tracking-wider opacity-70">{label}</p>
            <p className="font-display text-[28px] leading-none">{value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-3xl bg-surface-1 p-3 shadow-card">
        <Eyebrow>Companions</Eyebrow>
        <div className="mt-2 flex items-end justify-around">
          <div className="text-center">
            <MascotSlot character="archie" state="reading" size="xs" />
            <p className="mt-1 text-caption font-bold text-muted">Archie</p>
          </div>
          <div className="text-center">
            <MascotSlot character="shade" state="defeated" size="xs" />
            <p className="mt-1 text-caption font-bold text-muted">The Shade</p>
          </div>
          <div className="text-center">
            <MascotSlot character="hero" state="thinking" size="xs" />
            <p className="mt-1 text-caption font-bold text-muted">You</p>
          </div>
        </div>
      </div>
    </>
  );
}

const SCREENS = [
  ["Today", TodayMock],
  ["Map", MapMock],
  ["Result", ResultMock],
  ["Profile", ProfileMock],
] as const;

function Pair({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-title-l uppercase">{title}</h2>
        <span className="text-caption font-extrabold uppercase tracking-wider text-muted">Night · Cream</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Frame theme="night" label={title}>{children}</Frame>
        <Frame theme="cream" label={title}>{children}</Frame>
      </div>
    </section>
  );
}

export function MockupsClient({ approval }: { approval: Approval }) {
  const { toast } = useFeedback();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      await apiFetch("/api/design", { body: { action: "approve", reference: "docs/12-ui-style-analysis.md", screens: SCREENS.map(([s]) => s.toLowerCase()), themes: ["night", "cream"], ...(note ? { note } : {}) } });
      toast("Design approved and recorded");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface-1 p-4 shadow-card">
        <div>
          <Eyebrow>Sign-off (T-R2-13)</Eyebrow>
          {approval ? (
            <p className="mt-1 text-body-s font-bold">
              Approved {approval.approvedAt.slice(0, 16).replace("T", " ")} · {approval.screens.join(" · ")} · {approval.themes.join(" + ")}
              {approval.note ? <span className="block text-caption font-normal text-muted">“{approval.note}”</span> : null}
            </p>
          ) : (
            <p className="mt-1 text-body-s text-muted">4 screens × 2 themes. Review, then record your approval (stored with an event).</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className="field w-56" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Approval note" />
          <button className="btn-accent" disabled={busy} onClick={approve}>
            {approval ? "Re-record approval" : "Approve this design"}
          </button>
          <Link className="btn-ghost" href="/playground">
            Style playground
          </Link>
        </div>
      </div>

      {SCREENS.map(([title, Mock]) => (
        <Pair key={title} title={title}>
          <Mock />
        </Pair>
      ))}
    </div>
  );
}
