"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, Eyebrow } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";

type D = { id: string; date: string; title: string; body: string; rationale: string; alternatives: string; status: string };

/** Decision Log (F-CDX-02): every new decision needs a reason; status can be superseded later. */
export function DecisionLog({ decisions }: { decisions: D[] }) {
  const { toast } = useFeedback();
  const [f, setF] = useState({ title: "", rationale: "", alternatives: "", body: "" });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/api/codex", { body: { action: "decision", ...f } });
      toast("Decision recorded");
      setF({ title: "", rationale: "", alternatives: "", body: "" });
    } catch (err) {
      toast((err as Error).message, "warn");
    }
  }
  return (
    <Card className="flex flex-col gap-3">
      <Eyebrow>Decision log</Eyebrow>
      <form onSubmit={save} className="grid gap-2 sm:grid-cols-2">
        <input className="field sm:col-span-2" dir="auto" required minLength={3} placeholder="Decision (e.g. drop linear algebra)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Decision title" />
        <textarea className="field min-h-20" dir="auto" required minLength={5} placeholder="Why? (required)" value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} aria-label="Rationale" />
        <textarea className="field min-h-20" dir="auto" placeholder="Alternatives considered" value={f.alternatives} onChange={(e) => setF({ ...f, alternatives: e.target.value })} aria-label="Alternatives" />
        <button className="btn-accent justify-self-start">Record decision</button>
      </form>
      <ul className="flex flex-col gap-2">
        {decisions.map((d) => (
          <li key={d.id} className="rounded-2xl bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 font-extrabold" dir="auto">
                {d.title}
              </p>
              <Chip tone={d.status === "accepted" ? "lime" : d.status === "superseded" ? "surface" : "coral"}>{d.status}</Chip>
              <span className="text-caption text-muted">{d.date}</span>
            </div>
            <p className="text-body-s" dir="auto">
              <b>Why:</b> {d.rationale}
            </p>
            {d.alternatives && (
              <p className="text-caption text-muted" dir="auto">
                Alternatives: {d.alternatives}
              </p>
            )}
            {d.status === "accepted" && (
              <button className="mt-1 text-caption underline" onClick={() => apiFetch("/api/codex", { body: { action: "status", id: d.id, status: "superseded" } }).then(() => toast("Marked superseded"))}>
                Mark superseded
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
