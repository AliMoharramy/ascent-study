"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { cx } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";

/** Manual tier override with a mandatory reason (doc 03 §6); warns when it breaks the prerequisite rule. */
export function TierOverride({ chapterId, tier, locked }: { chapterId: string; tier: "M" | "S" | "C" | null; locked: boolean }) {
  const { toast } = useFeedback();
  const [t, setT] = useState<"M" | "S" | "C">(tier ?? "S");
  const [reason, setReason] = useState("");
  async function save(next: "M" | "S" | "C" | null) {
    try {
      const r = await apiFetch<{ override: { ok: boolean; error?: string; warnings: string[] } }>("/api/plan", { body: { action: "override", chapterId, tier: next, reason: next ? reason : "unlock" } });
      if (!r.override.ok) return toast(r.override.error ?? "Not saved", "warn");
      toast(r.override.warnings.length ? `Saved with a warning: ${r.override.warnings.join("; ")}` : next ? `Tier set to ${next}` : "Back to automatic triage", r.override.warnings.length ? "warn" : "ok");
      setReason("");
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save(t);
      }}
    >
      <span className="label">Override tier</span>
      <div className="flex gap-1.5" role="group" aria-label="Tier">
        {(["M", "S", "C"] as const).map((x) => (
          <button key={x} type="button" aria-pressed={t === x} onClick={() => setT(x)} className={cx("chip px-4 py-1.5", t === x ? "bg-purple text-white" : "border border-line bg-surface-2 text-ink")}>
            {x}
          </button>
        ))}
      </div>
      <input className="field" dir="auto" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (required)" />
      <div className="flex gap-2">
        <button className="btn-accent">Save override</button>
        {locked && (
          <button type="button" className="btn-ghost" onClick={() => save(null)}>
            Unlock
          </button>
        )}
      </div>
    </form>
  );
}
