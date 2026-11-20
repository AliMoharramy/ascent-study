import { requireUser } from "@/server/context";
import { baselineReport } from "@/server/reviews";
import { Card, Chip, Eyebrow, PageHeader, StatTile } from "@/ui/components";
import { ConfirmBaseline } from "./ConfirmBaseline";

export const metadata = { title: "Baseline Report" };
const DAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

/** Baseline Report (S21, #43): the 8 outputs of week 1; confirming activates the rules (end of Ch.1). */
export default async function BaselinePage() {
  const { db, userId, today, tz } = await requireUser();
  const r = (await baselineReport(db, userId, today, tz));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Ch.1 · The Awakening" title="Baseline Report">
        {r.confirmed ? <Chip tone="lime">Confirmed {r.confirmed.on}</Chip> : <Chip tone="yellow">{r.weekOver ? "Week 1 is over — ready to confirm" : "Week 1 in progress"}</Chip>}
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <Eyebrow>1 · Real capacity</Eyebrow>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Focus" value={r.capacity.focusHours} unit="h" hint={`${r.capacity.days} active days`} />
            <StatTile label="Raw windows" value={r.capacity.rawHours} unit="h" />
            <StatTile label="Focus factor" value={r.capacity.factor || "—"} hint="real ÷ raw" />
          </div>
          <p className="text-caption text-muted">Scenarios: {r.capacity.scenarios.map((s) => `${s.key} ${s.hours}h`).join(" · ")}</p>
        </Card>
        <Card className="flex flex-col gap-2">
          <Eyebrow>2 · Best 3 time blocks</Eyebrow>
          {r.blocks.length === 0 && <p className="text-body-s text-muted">Use the timer this week — blocks appear here.</p>}
          {r.blocks.map((b, i) => (
            <p key={i} className="text-body font-bold">
              {DAYS[b.weekday]} {String(b.from).padStart(2, "0")}:00–{String(b.to).padStart(2, "0")}:00 · {b.minutes} min
            </p>
          ))}
        </Card>
        <Card className="flex flex-col gap-2">
          <Eyebrow>3 · Suggested anchors</Eyebrow>
          {r.anchors.map((a) => (
            <p key={a} className="text-body-s font-bold">
              {a}
            </p>
          ))}
        </Card>
        <Card className="flex flex-col gap-2">
          <Eyebrow>4 · Top frictions + fixes</Eyebrow>
          {r.frictions.length === 0 && <p className="text-body-s text-muted">Fill “biggest blocker” in the daily check-in.</p>}
          {r.frictions.map((f) => (
            <p key={f.text} className="text-body-s" dir="auto">
              <b>
                {f.text} ×{f.count}
              </b>{" "}
              → {f.fix}
            </p>
          ))}
        </Card>
        <Card className="flex flex-col gap-2">
          <Eyebrow>5 · Detour Ledger</Eyebrow>
          <p className="font-display text-display-m leading-none">{r.ledger.totalMinutes} min</p>
          <p className="text-body-s">{r.ledger.topKinds.map((k) => `${k.kind} ${k.minutes}m`).join(" · ") || "No escapes logged."}</p>
        </Card>
        <Card className="flex flex-col gap-2">
          <Eyebrow>6 · Scouting a0 → initial triage</Eyebrow>
          <p className="text-body-s">
            {r.scouted.length} chapters scouted (≥ 2 tests each). Tiers now: M {r.tierCount.M} · S {r.tierCount.S} · C {r.tierCount.C}
          </p>
          <ul className="grid max-h-48 gap-1 overflow-y-auto text-caption">
            {r.scouted.map((c) => (
              <li key={c.id} className="fa flex justify-between rounded-lg bg-surface-2 px-2 py-1" dir="auto">
                <span>
                  {c.subjectId} {c.no} · {c.title}
                </span>
                <b>{Math.round(c.a0 * 100)}%</b>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-2 md:col-span-2">
          <Eyebrow>7 · 25-week plan proposal · 8 · Your confirmation</Eyebrow>
          <p className="text-body-s">Confirming stores a0 for every scouted chapter, re-runs Triage, rebuilds the 25-week plan with Load Ratio and switches the rules on: penalties, the Shadow Rival and bosses start next week.</p>
          <ConfirmBaseline confirmed={!!r.confirmed} />
        </Card>
      </div>
    </div>
  );
}
