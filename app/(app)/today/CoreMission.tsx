import type { CoreQuest } from "./TimerCard";
import { Card, Eyebrow, ProgressBar, cx } from "@/ui/components";
import { Icon } from "@/ui/icons";

const TIERS = ["seed", "standard", "stretch"] as const;
const LABELS = { seed: "Seed", standard: "Standard", stretch: "Stretch" } as const;

export function CoreMission({ core }: { core: CoreQuest | null }) {
  if (!core) {
    return (
      <Card className="flex flex-col gap-2" aria-label="Core mission">
        <Eyebrow>Core mission</Eyebrow>
        <h2 className="font-display text-title-l uppercase">No Core mission today</h2>
        <p className="text-body-s text-muted">A focus session is still ready whenever you want to study.</p>
      </Card>
    );
  }

  const reached = (tier: (typeof TIERS)[number]) => core.tierDone !== null && TIERS.indexOf(core.tierDone) >= TIERS.indexOf(tier);
  const metric = core.target.metric === "minutes" ? "min" : core.target.metric === "tests" ? "tests" : core.target.metric === "count" ? "actions" : "checks";
  const progress = Math.min(1, core.progress / Math.max(1, core.target.standard));

  return (
    <Card tone="yellow" className="flex flex-col gap-3" aria-label="Core mission">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Core mission</Eyebrow>
          <h2 className="mt-1 break-words font-display text-title-l uppercase leading-tight" dir="auto">{core.title}</h2>
        </div>
        <span className="chip shrink-0 bg-on-color/10 text-on-color">
          {core.tierDone ? `${LABELS[core.tierDone]} reached` : "In progress"}
        </span>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-body-s font-extrabold">
          <span>Core progress</span>
          <span>{Math.round(core.progress)} / {core.target.standard} {metric} · Standard threshold</span>
        </div>
        <ProgressBar value={progress} tone="surface" track="dark" label={`Core progress, Standard threshold ${core.target.standard} ${metric}`} className="[&>div]:bg-on-color" />
      </div>

      <ol className="grid gap-1.5" aria-label="Core mission tiers">
        {TIERS.map((tier) => (
          <li key={tier} className={cx("flex min-w-0 items-start gap-2 rounded-2xl px-3 py-2", reached(tier) ? "bg-on-color text-white" : "bg-on-color/10")}>
            <span className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", reached(tier) ? "border-lime bg-lime text-on-color" : "border-on-color/60")} aria-hidden="true">
              {reached(tier) && <Icon name="check" size={12} />}
            </span>
            <span className="w-20 shrink-0 text-caption font-extrabold uppercase tracking-wider">{LABELS[tier]}</span>
            <span className="min-w-0 break-words text-body-s font-bold" dir="auto">{core.tiers[tier]}</span>
          </li>
        ))}
      </ol>

      <p className="text-caption font-bold opacity-75">Seed keeps the day counted · Standard keeps your Flame · Stretch is an extra challenge.</p>
    </Card>
  );
}
