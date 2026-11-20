"use client";

import Link from "next/link";
import { apiFetch } from "@/ui/client";
import { useFeedback } from "@/ui/feedback";

export function ConfirmBaseline({ confirmed }: { confirmed: boolean }) {
  const { celebrate, toast } = useFeedback();
  async function go() {
    try {
      const r = await apiFetch<{ tiers: number; planItems: number }>("/api/reviews", { body: { action: "baseline" } });
      celebrate(`Ch.1 complete — ${r.tiers} chapters triaged, ${r.planItems} plan items. The Shadow wakes.`);
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button className="btn-accent" onClick={go}>
        {confirmed ? "Re-confirm (re-run triage & plan)" : "Confirm baseline & activate the rules"}
      </button>
      <Link href="/plan" className="btn-ghost">
        Review the plan first
      </Link>
    </div>
  );
}
