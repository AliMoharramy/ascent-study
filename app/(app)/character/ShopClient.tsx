"use client";

import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";
import type { shopView } from "@/server/shop";

type Shop = Awaited<ReturnType<typeof shopView>>;

/** Reward Shop (S17, F-GAME-07/08): spend Gold on real-life rewards; money rewards respect the monthly budget (default 0). */
export function ShopClient({ shop }: { shop: Shop }) {
  const { toast, celebrate } = useFeedback();
  const [add, setAdd] = useState({ title: "", goldCost: "", moneyCost: "0" });
  async function post(body: Record<string, unknown>, ok: string, party = false) {
    try {
      await apiFetch("/api/shop", { body });
      if (party) celebrate(ok);
      else toast(ok);
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Reward Shop</Eyebrow>
        <div className="flex gap-2">
          <Chip tone="yellow" icon="star">
            {Math.round(shop.gold)} Gold
          </Chip>
          <Chip>
            Money budget {shop.spent}/{shop.budget} this month
          </Chip>
        </div>
      </div>
      {!shop.enabled && <p className="text-body-s text-muted">The shop is turned off in Settings → Feature flags.</p>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shop.rewards.map((r) => {
          const can = shop.gold >= r.goldCost && (r.moneyCost === 0 || shop.spent + r.moneyCost <= shop.budget);
          return (
            <div key={r.id} className={cx("flex flex-col gap-2 rounded-3xl p-4", can ? "bg-surface-2" : "bg-surface-2/50")}>
              <p className="font-extrabold">{r.title}</p>
              <p className="text-caption text-muted">
                {r.goldCost} Gold{r.moneyCost > 0 ? ` · costs money (${r.moneyCost})` : ""}
              </p>
              <button className="btn-accent self-start py-1.5" disabled={!can || !shop.enabled} onClick={() => post({ action: "claim", rewardId: r.id }, `Enjoy: ${r.title}`, true)}>
                <Icon name="gift" size={14} /> Claim
              </button>
            </div>
          );
        })}
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void post({ action: "save", title: add.title, goldCost: Number(add.goldCost), moneyCost: Number(add.moneyCost || 0) }, "Reward added");
          setAdd({ title: "", goldCost: "", moneyCost: "0" });
        }}
      >
        <input className="field flex-[2]" dir="auto" required minLength={2} placeholder="New reward" value={add.title} onChange={(e) => setAdd({ ...add, title: e.target.value })} aria-label="Reward title" />
        <input className="field w-28" inputMode="numeric" required placeholder="Gold" value={add.goldCost} onChange={(e) => setAdd({ ...add, goldCost: e.target.value.replace(/\D/g, "") })} aria-label="Gold cost" />
        <input className="field w-28" inputMode="numeric" placeholder="Money" value={add.moneyCost} onChange={(e) => setAdd({ ...add, moneyCost: e.target.value.replace(/\D/g, "") })} aria-label="Money cost" />
        <button className="btn-ghost">Add</button>
      </form>
      {shop.claims.length > 0 && <p className="text-caption text-muted">Recent: {shop.claims.map((c) => c.title).join(" · ")}</p>}
      <p className="text-caption text-muted">Gold: 10 per Standard day, +5 Stretch, 50 Weekly Boss, 100 duel win, 150 Region Boss, 10 daily goal, surplus non-study XP 1:1.</p>
    </Card>
  );
}
