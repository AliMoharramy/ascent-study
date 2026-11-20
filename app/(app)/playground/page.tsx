import { BigNumber, BossBar, Card, Chip, DueChip, Eyebrow, LevelBadge, MedalBadge, ModuleCard, ProgressBar, ProgressRing, SectionTitle, ShadowGap, StatTile, TimeChip } from "@/ui/components";
import Link from "next/link";
import { LayeredProgress } from "@/ui/LayeredProgress";
import { Icon } from "@/ui/icons";
import { ThemeToggle } from "./ThemeToggle";

export const metadata = { title: "Style playground" };

const swatches = [
  ["--bg", "Background"],
  ["--surface-1", "Surface 1"],
  ["--surface-2", "Surface 2"],
  ["--border", "Border"],
  ["--text", "Text"],
  ["--text-muted", "Text muted"],
  ["--c-yellow", "Yellow · Core/XP"],
  ["--c-mint", "Mint · next/insight"],
  ["--c-coral", "Coral · result/Fog"],
  ["--c-purple", "Purple · interaction/Shade"],
  ["--c-lime", "Lime · success"],
] as const;

/** Design tokens v0.2 playground (Night/Cream) — visual QA surface for every component. */
export default function Playground() {
  return (
    <div className="grid gap-8">
      <SectionTitle action={<div className="flex items-center gap-2"><Link href="/playground/mockups" className="btn-ghost">Mockups</Link><ThemeToggle /></div>}>Tokens v0.2 · Playful Color-Block</SectionTitle>

      <section>
        <Eyebrow className="mb-3">Colors</Eyebrow>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {swatches.map(([v, label]) => (
            <div key={v} className="overflow-hidden rounded-3xl border border-line">
              <div className="h-16" style={{ background: `rgb(var(${v}))` }} />
              <div className="bg-surface-1 p-2 text-caption">
                <p className="font-extrabold">{label}</p>
                <code className="text-muted">{v}</code>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-2">
        <Eyebrow>Typography</Eyebrow>
        <p className="font-display text-display-xl uppercase">Display 72 · Level 12</p>
        <p className="font-display text-display-l uppercase">Display 56 · 86%</p>
        <p className="font-display text-display-m uppercase">Display 40 · Weekly boss</p>
        <p className="text-title-l font-extrabold">Title 28 — Nunito</p>
        <p className="text-title-m font-bold">Title 20 — Nunito</p>
        <p className="text-body">Body 16 — the quick brown fox jumps over 1234567890.</p>
        <p className="fa text-title-m font-bold" lang="fa" dir="rtl">
          وزیرمتن — هوش مصنوعی، فصل ۳: حل مسئله با جست‌وجو
        </p>
        <p className="fa font-display text-display-m" lang="fa" dir="rtl">
          صعود
        </p>
      </section>

      <section>
        <Eyebrow className="mb-3">Cards</Eyebrow>
        <div className="grid gap-4 md:grid-cols-3">
          <ModuleCard tone="yellow" eyebrow="Today's core quest" title="AI · Ch. 3" chips={<Chip tone="dark" icon="clock">Due tonight</Chip>}>
            <ProgressBar value={0.68} tone="surface" track="dark" className="[&>div]:bg-on-color" />
            <button className="btn-primary w-fit">
              Continue <Icon name="arrow" size={16} />
            </button>
          </ModuleCard>
          <ModuleCard tone="mint" eyebrow="Next chapter" title="DSA · Trees" chips={<Chip tone="dark">24 min left</Chip>} />
          <ModuleCard tone="coral" eyebrow="Boss" title="Friday" chips={<Chip tone="dark">3d 4h</Chip>} />
          <ModuleCard tone="purple" eyebrow="Shade gap" title="−28 MP" />
          <ModuleCard tone="lime" eyebrow="Streak" title="12 days" chips={<Chip tone="dark" icon="flame">Flame</Chip>} />
          <Card className="flex items-center gap-4">
            <ProgressRing value={4 / 7} tone="lime">4/7</ProgressRing>
            <div>
              <Eyebrow>Week glance</Eyebrow>
              <p className="font-display text-display-m leading-none">6 lessons</p>
            </div>
          </Card>
        </div>
      </section>

      <section>
        <Eyebrow className="mb-3">Stat tiles, chips, buttons</Eyebrow>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Correct" value={42} />
          <StatTile label="Time" value={38} unit="min" />
          <StatTile label="Net" value={63} unit="%" tone="mint" />
          <StatTile label="XP" value="1,240" tone="yellow" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip tone="yellow">yellow</Chip>
          <Chip tone="mint">mint</Chip>
          <Chip tone="coral" icon="clock">Due tonight</Chip>
          <Chip tone="purple">purple</Chip>
          <Chip tone="lime" icon="check">done</Chip>
          <Chip>neutral</Chip>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary">Primary</button>
          <button className="btn-accent">Accent</button>
          <button className="btn-ghost">Ghost</button>
          <button className="btn-accent" disabled>
            Disabled
          </button>
        </div>
      </section>

      <section className="grid gap-4">
        <Eyebrow>R1 library · HeroFocusCard lives on Today · RTL: open with dir=rtl to check mirroring</Eyebrow>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <DueChip>Due tonight</DueChip>
              <DueChip urgent>Boss in 2h</DueChip>
              <TimeChip minutes={24} />
              <TimeChip minutes={135} />
            </div>
            <LevelBadge level={12} title="Scholar" />
            <BossBar hp={62} label="Weekly Boss · threshold 45%" />
          </Card>
          <Card tone="purple">
            <ShadowGap you={14} shadow={17.5} />
          </Card>
          <BigNumber value={63} unit="%" label="Weekly boss net" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MedalBadge name="First Light" description="Clear your first chapter" tier="bronze" unlocked />
          <MedalBadge name="Seven Suns" description="7 Standard days" tier="silver" unlocked />
          <MedalBadge name="Dawn Walker" description="Wake ≤ 06:30 × 7" tier="gold" unlocked />
          <MedalBadge name="Shadow Slayer" description="Win 3 duels in a row" tier="gold" unlocked={false} progress={[1, 3]} />
        </div>
        <LayeredProgress
          layers={[
            { key: "day", label: "Day", value: 0.62, caption: "75 / 120 min", tone: "lime" },
            { key: "week", label: "Week", value: 0.4, caption: "12h of 30h", tone: "yellow" },
            { key: "realm", label: "Realm I", value: 0.25, caption: "5 of 20 chapters", tone: "mint" },
            { key: "campaign", label: "Campaign", value: 0.08, caption: "Day 14 of 175", tone: "purple" },
          ]}
          countdowns={[{ label: "Exam", value: "161 days" }, { label: "Weekly Boss", value: "3 days" }]}
        />
        <div dir="rtl" className="grid gap-3 md:grid-cols-2">
          <ModuleCard tone="mint" eyebrow="فصل بعدی" title={<span className="fa">داده‌ساختار · درخت</span>} chips={<DueChip>امشب</DueChip>}>
            <ProgressBar value={0.4} tone="purple" label="پیشرفت" />
          </ModuleCard>
          <StatTile label="تست امروز" value={42} unit="عدد" tone="yellow" />
        </div>
      </section>
    </div>
  );
}
