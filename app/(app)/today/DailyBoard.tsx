"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { boardView, lootView } from "@/server/life";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";

type Board = Awaited<ReturnType<typeof boardView>>;
type Loot = Awaited<ReturnType<typeof lootView>>;

const LOOT: Record<string, { label: string; text: string }> = {
  codex: { label: "Codex entry", text: "A new read-only entry for the Codex." },
  cosmetic: { label: "Cosmetic", text: "A small cosmetic in the shop window — free to claim." },
  shield: { label: "Shield", text: "One Shield added to the safety net." },
  none: { label: "Empty chest", text: "Nothing this time. The pity timer moved one step closer." },
};

/** Quest Board (#84) + Loot chest with pity timer and a calm reveal animation (#79). */
export function DailyBoard({ board, loot }: { board: Board; loot: Loot }) {
  const { toast, celebrate } = useFeedback();
  const router = useRouter();
  const [claiming, setClaiming] = useState(false);
  const [opening, setOpening] = useState(false);
  const [revealed, setRevealed] = useState(false);

  async function claim() {
    setClaiming(true);
    try {
      const r = await apiFetch<{ gold: number; loot: string }>("/api/life", { body: { action: "board" } });
      celebrate(`Board cleared · +${r.gold} Gold · ${LOOT[r.loot]?.label ?? r.loot}`);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setClaiming(false);
    }
  }

  function open() {
    if (!loot.today) return;
    setOpening(true);
    window.setTimeout(() => setRevealed(true), 650);
  }

  const result = loot.today ? LOOT[loot.today.result] ?? { label: loot.today.result, text: "" } : null;

  return (
    <>
      <Card tone="mint" className="flex flex-col gap-3" aria-label="Quest board">
        <div className="flex items-start justify-between gap-2">
          <div>
            <Eyebrow>Quest Board · three, never five</Eyebrow>
            <p className="mt-1 font-display text-display-m leading-none">{board.allDone ? "Cleared" : `${board.items.filter((i) => i.done).length}/3`}</p>
          </div>
          <Chip tone={board.claimed ? "purple" : board.allDone ? "lime" : "surface"}>{board.claimed ? "Claimed" : `${board.gold} Gold`}</Chip>
        </div>
        <ul className="flex flex-col gap-1.5">
          {board.items.map((m) => (
            <li key={m.key} className={cx("rounded-xl px-3 py-2 text-body-s", m.done ? "bg-on-color/10" : "bg-on-color/5")}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 font-bold">
                  <span className={cx("grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", m.done ? "border-on-color bg-on-color/20" : "border-on-color/40")}>{m.done && <Icon name="check" size={11} />}</span>
                  <span dir="auto">{m.title}</span>
                </span>
                <b className="shrink-0 text-caption">
                  {m.value}/{m.target}
                </b>
              </div>
              <div className="ms-7 mt-1 h-1.5 overflow-hidden rounded-pill bg-on-color/20">
                <div className="h-full rounded-pill bg-on-color/70 transition-[width] duration-500" style={{ width: `${Math.round(m.pct * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {board.claimed ? (
            <p className="text-caption font-bold">Claimed today · {board.claimed.gold} Gold · {LOOT[board.claimed.loot]?.label ?? board.claimed.loot}</p>
          ) : (
            <button className="btn-primary" disabled={!board.allDone || claiming} onClick={claim}>
              {claiming ? "Claiming…" : board.allDone ? "Claim the board" : "Finish all three first"}
            </button>
          )}
          <p className="text-caption opacity-70">The Board never pays halfway. Pillar quests stay a separate five-per-day cap.</p>
        </div>
      </Card>

      <Card tone="purple" className="flex flex-col gap-3" aria-label="Loot chest">
        <div className="flex items-start justify-between gap-2">
          <Eyebrow>Vault chest</Eyebrow>
          <Chip tone="surface">{loot.today ? "Ready" : "After close"}</Chip>
        </div>
        <div className="flex items-center justify-center py-2">
          <div
            className={cx("grid h-24 w-24 place-items-center rounded-3xl bg-white/10 transition-all duration-700", opening && !revealed ? "scale-110 rotate-3" : "", revealed ? "scale-100" : "hover:scale-105")}
            style={{ transform: revealed ? "rotateY(180deg)" : undefined, transformStyle: "preserve-3d" }}
            aria-hidden="true"
          >
            <Icon name={revealed ? "sparkle" : "gift"} size={44} className={revealed ? "text-yellow" : "text-white"} />
          </div>
        </div>
        {!loot.today && <p className="text-body-s font-bold">The chest opens after tonight&apos;s close on a Standard day. Pity {loot.pity}/7 — a dry streak cannot last forever.</p>}
        {loot.today && !revealed && (
          <>
            <p className="text-body-s font-bold">Tonight&apos;s chest is sealed. Click once; the result was already rolled honestly at the day close.</p>
            <button className="btn bg-white text-on-color self-start" onClick={open} disabled={opening}>
              {opening ? "Opening…" : "Open the chest"} <Icon name="gift" size={16} />
            </button>
          </>
        )}
        {revealed && result && (
          <div className="animate-pop rounded-2xl bg-white/10 p-3">
            <p className="font-display text-title-m uppercase leading-none">{result.label}</p>
            <p className="text-body-s font-bold">{result.text}</p>
            <p className="mt-1 text-caption opacity-70">Pity counter now {loot.pity}/7 · roll #{loot.rolls.length} in the vault.</p>
          </div>
        )}
        {loot.rolls.length > 0 && (
          <p className="mt-auto text-caption opacity-70">Recent: {loot.rolls.slice(0, 5).map((r) => LOOT[r.result]?.label ?? r.result).join(" · ")}</p>
        )}
      </Card>
    </>
  );
}
