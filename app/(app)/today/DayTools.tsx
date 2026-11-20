"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Eyebrow } from "@/ui/components";
import { Icon } from "@/ui/icons";
import { useFeedback } from "@/ui/feedback";
import { Modal } from "@/ui/Modal";

/** Shields (use on yesterday within 24 h), Life Event, manual entry — the "safety net" card (doc 04 §6.2). */
export function DayTools({ shields, flame, yesterday, yesterdayPenalty, today, yesterdayShielded }: { shields: number; flame: number; yesterday: string; yesterdayPenalty: number; today: string; yesterdayShielded: boolean }) {
  const { toast } = useFeedback();
  const [life, setLife] = useState(false);
  const [manual, setManual] = useState(false);
  const [reason, setReason] = useState("");
  const [m, setM] = useState({ day: today, start: "10:00", minutes: "30", kind: "video" });

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
  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await apiFetch<{ entry: { late: boolean } | null }>("/api/focus/manual", { body: { ...m, minutes: Number(m.minutes) } });
      toast(r.entry?.late ? "Added (manual, > 24 h late → 50 % XP)" : "Manual entry added");
      setManual(false);
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
        <button className="btn-ghost" onClick={() => setManual(true)}>
          <Icon name="plus" size={14} /> Manual entry
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
      <Modal open={manual} onClose={() => setManual(false)} title="Manual focus entry">
        <form onSubmit={addManual} className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">Day</span>
            <input type="date" className="field" value={m.day} max={today} onChange={(e) => setM({ ...m, day: e.target.value })} />
          </label>
          <label>
            <span className="label">Start</span>
            <input type="time" className="field" value={m.start} onChange={(e) => setM({ ...m, start: e.target.value })} />
          </label>
          <label>
            <span className="label">Minutes</span>
            <input inputMode="numeric" className="field" value={m.minutes} onChange={(e) => setM({ ...m, minutes: e.target.value.replace(/\D/g, "") })} />
          </label>
          <label>
            <span className="label">Kind</span>
            <select className="field" value={m.kind} onChange={(e) => setM({ ...m, kind: e.target.value })}>
              {["video", "tests", "review", "analysis", "forge", "other"].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <p className="col-span-2 text-caption text-muted">Tagged “manual”. Entries made more than 24 h after the day ended earn 50 % XP (anti-gaming, doc 04 §11).</p>
          <button className="btn-accent col-span-2 justify-self-start">Add</button>
        </form>
      </Modal>
    </section>
  );
}
