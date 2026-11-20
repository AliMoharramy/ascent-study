"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow, ProgressBar } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";

type CardData = { enabled: boolean; week: number; drawn: boolean; card: { id: string; text: string; metric: string; target: number; gold: number; gems: number }; progress: number; weekNet: number; status: string; done: boolean };
type RushData = { available: boolean; week: number; threshold: number; stages: readonly { realm: number; name: string }[]; finished: { results: { realm: number; netPct: number; defeated: boolean }[]; finishedAt: string } | null };

/** Weekly challenge card (#91, F-GM-02): deterministic draw, live progress, Gold + Gems claim. */
export function ChallengeCardPanel({ data }: { data: CardData }) {
  const { toast, celebrate } = useFeedback();
  const [card, setCard] = useState(data);
  const [busy, setBusy] = useState(false);
  async function act(action: "card_draw" | "card_claim") {
    setBusy(true);
    try {
      const r = await apiFetch<{ card: CardData }>("/api/extras", { body: { action } });
      setCard(r.card);
      if (action === "card_claim") celebrate(`Card claimed: +${r.card.card.gold} Gold, +${r.card.card.gems} Gems`);
      else toast("This week's card is drawn — good luck!");
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }
  if (!card.enabled) return <Card className="text-body-s text-muted">Challenge cards are off in Settings → Feature flags.</Card>;
  return (
    <Card tone="lime" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>Challenge card · week {card.week}</Eyebrow>
        <Chip tone={card.status === "claimed" ? "lime" : card.done ? "yellow" : "surface"}>{card.status === "claimed" ? "Claimed" : card.done ? "Done — claim!" : card.drawn ? "In progress" : "Undrawn"}</Chip>
      </div>
      {card.drawn ? (
        <>
          <p className="font-display text-display-m leading-tight">{card.card.text}</p>
          <ProgressBar value={Math.min(1, card.progress / card.card.target)} tone="lime" label="Card progress" />
          <p className="text-caption font-extrabold">
            {card.progress} / {card.card.target}
            {card.card.metric === "tests" ? ` · week net ${card.weekNet}% (needs ≥ 50%)` : ""}
          </p>
          <p className="text-caption font-bold opacity-80">
            Reward: +{card.card.gold} Gold · +{card.card.gems} Gems. One card per week, drawn deterministically — no rerolls.
          </p>
          {card.status !== "claimed" && (
            <button className="btn-accent self-start" disabled={!card.done || busy} onClick={() => act("card_claim")}>
              Claim reward
            </button>
          )}
        </>
      ) : (
        <>
          <div className="grid h-28 place-items-center rounded-2xl border-2 border-dashed border-on-color/40 bg-on-color/10">
            <Icon name="gift" size={34} />
          </div>
          <p className="text-body-s opacity-90">A face-down card hides this week&apos;s side quest. Draw it to reveal the goal and its Gold + Gems reward.</p>
          <button className="btn-accent self-start" disabled={busy} onClick={() => act("card_draw")}>
            Draw this week&apos;s card
          </button>
        </>
      )}
    </Card>
  );
}

/** Boss Rush (#91, F-GM-01): five realm gates in the final week; 5/5 pays the boss Gem. */
export function BossRushPanel({ data }: { data: RushData }) {
  const { toast, celebrate } = useFeedback();
  const [rush, setRush] = useState(data);
  const [vals, setVals] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const results = rush.stages.map((s) => ({ realm: s.realm, netPct: Number(vals[s.realm] ?? "") }));
      const r = await apiFetch<{ rush: RushData }>("/api/extras", { body: { action: "rush_finish", results } });
      setRush(r.rush);
      const down = r.rush.finished?.results.filter((x) => x.defeated).length ?? 0;
      if (down === 5) celebrate("Boss Rush cleared 5/5 — the Summit gate is open!");
      else toast(`Rush finished: ${down}/5 gates defeated`, down >= 3 ? "ok" : "warn");
    } catch (err) {
      toast((err as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card tone="coral" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>Boss Rush · five gates</Eyebrow>
        <Chip tone={rush.available ? "coral" : "surface"}>{rush.available ? (rush.finished ? "Finished" : "Open now") : "Final week only"}</Chip>
      </div>
      {!rush.available ? (
        <p className="text-body-s opacity-90">The Rush opens in week 25 or the last 7 days before the exam: one net-% score per realm gate, win at ≥ {rush.threshold}% each. 10 Gold per gate, the boss Gem for a clean 5/5.</p>
      ) : rush.finished ? (
        <ul className="grid gap-1.5">
          {rush.finished.results.map((r) => (
            <li key={r.realm} className="flex items-center justify-between rounded-xl bg-on-color/10 px-3 py-1.5 text-body-s">
              <span className="font-bold">{rush.stages.find((s) => s.realm === r.realm)?.name}</span>
              <span className={cx("font-extrabold", r.defeated ? "text-lime-ink" : "text-coral-ink")}>
                {r.netPct}% {r.defeated ? "· down ✔" : "· held ✗"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <p className="text-body-s opacity-90">Run your own gate mocks, then log one net % per realm. Each gate falls at ≥ {rush.threshold}%.</p>
          {rush.stages.map((s) => (
            <label key={s.realm} className="grid grid-cols-[1fr_90px] items-center gap-2">
              <span className="text-body-s font-bold">
                {s.realm}. {s.name}
              </span>
              <input className="field px-2 py-1 text-center" inputMode="decimal" placeholder="net %" aria-label={`Net percent for ${s.name}`} value={vals[s.realm] ?? ""} onChange={(e) => setVals({ ...vals, [s.realm]: e.target.value.replace(/[^\d.-]/g, "") })} />
            </label>
          ))}
          <button className="btn-accent self-start" disabled={busy}>
            Finish the Rush
          </button>
        </form>
      )}
    </Card>
  );
}