"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Icon } from "@/ui/icons";
import { Modal } from "@/ui/Modal";
import { useFeedback } from "@/ui/feedback";

export function ManualFocusEntry({ today, className }: { today: string; className?: string }) {
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState({ day: today, start: "10:00", minutes: "30", kind: "video" });

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    try {
      const result = await apiFetch<{ entry: { late: boolean } | null }>("/api/focus/manual", { body: { ...entry, minutes: Number(entry.minutes) } });
      toast(result.entry?.late ? "Added (manual, > 24 h late → 50 % XP)" : "Manual entry added");
      setOpen(false);
    } catch (error) {
      toast((error as Error).message, "warn");
    }
  }

  return (
    <>
      <button type="button" className={className ?? "btn-ghost min-h-11 justify-start"} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="plus" size={15} /> Manual focus entry
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Manual focus entry">
        <form onSubmit={addManual} className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">Day</span>
            <input type="date" className="field" value={entry.day} max={today} onChange={(e) => setEntry({ ...entry, day: e.target.value })} />
          </label>
          <label>
            <span className="label">Start</span>
            <input type="time" className="field" value={entry.start} onChange={(e) => setEntry({ ...entry, start: e.target.value })} />
          </label>
          <label>
            <span className="label">Minutes</span>
            <input inputMode="numeric" className="field" value={entry.minutes} onChange={(e) => setEntry({ ...entry, minutes: e.target.value.replace(/\D/g, "") })} />
          </label>
          <label>
            <span className="label">Kind</span>
            <select className="field" value={entry.kind} onChange={(e) => setEntry({ ...entry, kind: e.target.value })}>
              {["video", "tests", "review", "analysis", "forge", "other"].map((kind) => <option key={kind}>{kind}</option>)}
            </select>
          </label>
          <p className="col-span-2 text-caption text-muted">Entries made more than 24 hours after the day ended earn 50% XP.</p>
          <button className="btn-accent col-span-2 justify-self-start" type="submit">Add focus entry</button>
        </form>
      </Modal>
    </>
  );
}
