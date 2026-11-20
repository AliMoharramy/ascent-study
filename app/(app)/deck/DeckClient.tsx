"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, EmptyState } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";

type DeckCard = { id: string; front: string; back: string; dueOn: string; reps: number; step: number; why: "due" | "recent_error" | "again" };

const DECK_SECONDS = 5 * 60;

function clock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Five-minute deck (F-LRN-16, #70): countdown, reveal, again/hard/good; "again" requeues within the session. */
export function DeckClient({ deck, reviewXpLeft }: { deck: DeckCard[]; reviewXpLeft: number }) {
  const { toast } = useFeedback();
  const [queue, setQueue] = useState<DeckCard[]>(deck);
  const [i, setI] = useState(0);
  const [show, setShow] = useState(false);
  const [left, setLeft] = useState(DECK_SECONDS);
  const [running, setRunning] = useState(deck.length > 0);
  const [tally, setTally] = useState({ again: 0, hard: 0, good: 0 });
  const [saving, setSaving] = useState(false);
  const c = queue[i];
  const done = queue.length > 0 && i >= queue.length;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          setRunning(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  async function answer(a: "again" | "hard" | "good") {
    if (!c || saving) return;
    setSaving(true);
    try {
      await apiFetch("/api/review", { body: { action: "answer", cardId: c.id, answer: a } });
      setTally((t) => ({ ...t, [a]: t[a] + 1 }));
      // "again" comes back once more in this session (max two extra looks per card)
      if (a === "again" && queue.filter((x) => x.id === c.id).length < 3) setQueue((q) => [...q, { ...c, why: "again" }]);
      setShow(false);
      setI((x) => x + 1);
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
      if (!c) return;
      if (e.code === "Space") {
        e.preventDefault();
        setShow(true);
        return;
      }
      if (!show) return;
      if (e.key === "1") void answer("again");
      if (e.key === "2") void answer("hard");
      if (e.key === "3") void answer("good");
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  if (!deck.length)
    return (
      <EmptyState icon="sparkle" title="Nothing due right now">
        The deck fills itself: every analysed error becomes a review card, and due cards come first. <Link href="/forge?tab=errors" className="font-extrabold underline">Analyse an error in the Forge</Link>.
      </EmptyState>
    );

  if (done) {
    const total = tally.again + tally.hard + tally.good;
    return (
      <Card tone="mint" className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex items-center gap-3">
          <Icon name="check" size={28} />
          <h2 className="font-display text-title-l uppercase">Deck cleared</h2>
        </div>
        <p className="text-body">
          {total} card{total === 1 ? "" : "s"} answered in {clock(DECK_SECONDS - left)}. Good {tally.good} · Hard {tally.hard} · Again {tally.again}.
        </p>
        <p className="text-body-s text-muted">Memory is built here, not in the new-test counter. Intervals grow 1 → 3 → 7 → 14 → 30 days.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/today" className="btn-primary">
            Back to Today
          </Link>
          <Link href="/forge?tab=review" className="btn-ghost">
            Review queue
          </Link>
        </div>
      </Card>
    );
  }

  const remaining = queue.length - i;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={left === 0 ? "coral" : "purple"} icon="clock">
          {clock(left)}
        </Chip>
        <span className="text-caption font-extrabold uppercase text-muted">
          {remaining} remaining · Card {i + 1}
        </span>
        <button className="ms-auto chip border border-line bg-surface-1 text-ink" onClick={() => setRunning((r) => !r)} aria-label={running ? "Pause timer" : "Resume timer"}>
          {running ? "Pause" : "Resume"}
        </button>
      </div>
      <p className="text-caption text-muted">{left === 0 ? "Time's up — finish the current card, or stop here. The rest stays due." : reviewXpLeft > 0 ? `${reviewXpLeft} review XP left today` : "Daily review XP cap reached — keep going for memory, not XP"}</p>
      {c && (
        <>
          <Card tone="mint" className="flex min-h-48 flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption font-extrabold uppercase text-muted">{c.why === "due" ? "Due today" : c.why === "again" ? "Again" : "Recent error"}</span>
              <span className="text-caption font-extrabold uppercase text-muted">rep {c.reps}</span>
            </div>
            <p className="text-title-m font-extrabold" dir="auto">
              {c.front}
            </p>
            {show ? (
              <p className="rounded-2xl bg-on-color/10 p-3 text-body font-bold" dir="auto">
                {c.back}
              </p>
            ) : (
              <button className="btn-primary self-start" onClick={() => setShow(true)}>
                Show answer <kbd className="rounded bg-white/15 px-1.5 text-caption">Space</kbd>
              </button>
            )}
          </Card>
          {show && (
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" disabled={saving} onClick={() => answer("again")}>
                Again <kbd className="text-caption">1</kbd>
              </button>
              <button className="btn-ghost flex-1" disabled={saving} onClick={() => answer("hard")}>
                Hard <kbd className="text-caption">2</kbd>
              </button>
              <button className="btn-accent flex-1" disabled={saving} onClick={() => answer("good")}>
                Good <kbd className="text-caption">3</kbd>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
