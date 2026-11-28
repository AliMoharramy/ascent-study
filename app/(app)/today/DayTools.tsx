"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Eyebrow } from "@/ui/components";
import { Icon } from "@/ui/icons";
import { useFeedback } from "@/ui/feedback";
import { Modal } from "@/ui/Modal";

/** Shields (use on yesterday within 24 h) and Life Event controls (doc 04 §6.2). */
export function DayTools({ shields, flame, yesterday, yesterdayPenalty, yesterdayShielded }: { shields: number; flame: number; yesterday: string; yesterdayPenalty: number; yesterdayShielded: boolean }) {
  const { toast } = useFeedback();
  const [life, setLife] = useState(false);
  const [reason, setReason] = useState("");

  async function shield() {
    try {
      await apiFetch("/api/quests", { body: { action: "shield", day: yesterday } });
      toast("Shield used — yesterday's penalties are forgiven");
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  async function declare(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await apiFetch<{ reflect: boolean }>("/api/quests", { body: { action: "life_event", reason } });
      toast(r.reflect ? "Life Event noted. That's a lot this month — worth a look in the Weekly Council." : "Life Event noted — no penalties today, Core is Seed-only.");
      setLife(false);
      setReason("");
    } catch (err) {
      toast((err as Error).message, "warn");
    }
  }
  return (
    <section className="card flex flex-col gap-3" aria-label="Safety net">
      <Eyebrow>Safety net</Eyebrow>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1" role="img" aria-label={`${shields} shields`}>
          {[0, 1, 2].map((i) => (
            <Icon key={i} name="shield" size={26} className={i < shields ? "text-mint" : "text-line"} />
          ))}
        </span>
        <span className="chip bg-yellow text-on-color" title="Flame: Standard days in a row (cosmetic)">
          <Icon name="flame" size={13} /> {flame}
        </span>
      </div>
      {yesterdayPenalty < 0 && !yesterdayShielded && (
        <button className="btn-ghost justify-start" onClick={shield} disabled={shields === 0}>
          <Icon name="shield" size={16} /> Use a Shield on yesterday ({yesterdayPenalty} SS)
        </button>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => setLife(true)}>
          Life Event
        </button>
      </div>
      <p className="text-caption text-muted">Penalties always have a way back: Seed counts, Comeback refunds 50 %, Shields forgive a day.</p>
      <Modal open={life} onClose={() => setLife(false)} title="Declare a Life Event">
        <form onSubmit={declare} className="flex flex-col gap-3">
          <p className="text-body-s text-muted">University, illness, travel… No penalties today; the Core shrinks to Seed. Max 2 per week.</p>
          <input className="field" dir="auto" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One line: what happened?" autoFocus />
          <button className="btn-accent self-start">Declare</button>
        </form>
      </Modal>
    </section>
  );
}
