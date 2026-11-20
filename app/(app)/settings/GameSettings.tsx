"use client";

import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, cx, Eyebrow } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { playSound } from "@/ui/sound";

const FLAG_LABEL: Record<string, string> = {
  rival: "Shadow Rival",
  bosses: "Bosses",
  loot: "Loot rolls",
  shop: "Reward Shop",
  sleepProgram: "Sleep Program",
  ghostLeague: "Ghost League",
  ai: "AI Mentor (later)",
  sounds: "Sounds",
  mascots: "Mascot illustrations (calm mode = off)",
  fog: "Territory Fog on the map",
  bossRush: "Boss Rush (final week)",
  seasonPass: "Free Season Pass",
  challengeCards: "Weekly challenge cards",
  anomalyAlerts: "Gentle anomaly alerts",
  calm: "Calm mode (fades only, no sounds/confetti/mascots)",
};

type Reminders = { enabled: boolean; tone: "calm" | "playful" | "direct"; maxPerDay: number };

/** Feature flags (#48, F-OPS-06): config-driven; every flip is a new config version + `config.changed` event. Also: daily goal, replay, onboarding, anchor reminders (#97). */
export function GameSettings({ flags, goal, budget, reminders, volume }: { flags: Record<string, boolean>; goal: number; budget: number; reminders: Reminders; volume: number }) {
  const { toast } = useFeedback();
  const [f, setF] = useState(flags);
  const [g, setG] = useState(String(goal));
  const [b, setB] = useState(String(budget));
  const [r, setR] = useState(reminders);
  const [vol, setVol] = useState(volume);
  async function saveVolume(next: number) {
    setVol(next);
    try {
      await apiFetch("/api/config", { method: "PUT", body: { patch: { sound: { volume: next } }, reason: `Sound volume → ${Math.round(next * 100)}%` } });
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  async function saveReminders(next: Reminders) {
    try {
      await apiFetch("/api/config", { method: "PUT", body: { patch: { reminders: next }, reason: `Anchor reminders: ${next.enabled ? "on" : "off"}, ${next.tone}, max ${next.maxPerDay}/day` } });
      setR(next);
      toast("Reminder settings saved (config version logged)");
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  async function flip(k: string) {
    const next = !f[k];
    try {
      await apiFetch("/api/config", { method: "PUT", body: { patch: { flags: { [k]: next } }, reason: `Feature flag ${k} → ${next ? "on" : "off"}` } });
      setF({ ...f, [k]: next });
      toast(`${FLAG_LABEL[k] ?? k} ${next ? "enabled" : "disabled"} (logged as a config version)`);
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="flex flex-col gap-3">
        <Eyebrow>Feature flags</Eyebrow>
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.entries(f).map(([k, v]) => (
            <li key={k}>
              <button role="switch" aria-checked={v} onClick={() => flip(k)} className="flex w-full items-center justify-between rounded-2xl bg-surface-2 px-3 py-2 text-body-s font-bold">
                {FLAG_LABEL[k] ?? k}
                <span className={cx("relative h-6 w-11 rounded-pill transition", v ? "bg-lime" : "bg-line")}>
                  <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", v ? "start-[22px]" : "start-0.5")} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex flex-col gap-3">
        <Eyebrow>Commitments</Eyebrow>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apiFetch("/api/reviews", { body: { action: "goal", minutes: Number(g) } }).then(() => toast(`Daily goal: ${g} min`), (err) => toast((err as Error).message, "warn"));
          }}
        >
          <label className="flex-1">
            <span className="label">Daily goal (minutes)</span>
            <input className="field" inputMode="numeric" value={g} onChange={(e) => setG(e.target.value.replace(/\D/g, ""))} />
          </label>
          <button className="btn-ghost">Save</button>
        </form>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apiFetch("/api/config", { method: "PUT", body: { patch: { shop: { monthlyMoneyBudget: Number(b) } }, reason: "Monthly reward money budget" } }).then(() => toast("Budget saved"), (err) => toast((err as Error).message, "warn"));
          }}
        >
          <label className="flex-1">
            <span className="label">Monthly money budget for rewards (0 = free rewards only)</span>
            <input className="field" inputMode="numeric" value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ""))} />
          </label>
          <button className="btn-ghost">Save</button>
        </form>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => apiFetch<{ days: number; identical: boolean }>("/api/replay", { body: {} }).then((r) => toast(`Replayed ${r.days} days — ${r.identical ? "ledgers identical ✔" : "ledgers updated"}`))}>
            Replay event log
          </button>
          <Link href="/onboarding" className="btn-ghost">
            Replay onboarding
          </Link>
          <Link href="/baseline" className="btn-ghost">
            Baseline report
          </Link>
        </div>
      </Card>
      <Card className="flex flex-col gap-3 md:col-span-2">
        <Eyebrow>Sound & calm · default off, your call</Eyebrow>
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <label>
            <span className="label">Sound volume — {Math.round(vol * 100)}%</span>
            <input type="range" min={0} max={100} value={Math.round(vol * 100)} onChange={(e) => setVol(Number(e.target.value) / 100)} onMouseUp={() => saveVolume(vol)} onTouchEnd={() => saveVolume(vol)} onKeyUp={() => saveVolume(vol)} className="w-full accent-purple" aria-label="Sound volume" />
          </label>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => playSound("pop", vol)}>Preview pop (XP)</button>
            <button className="btn-ghost" onClick={() => playSound("chime", vol)}>Preview chime (Level)</button>
            <button className="btn-ghost" onClick={() => playSound("drum", vol)}>Preview drum (Boss)</button>
          </div>
        </div>
        <p className="text-caption text-muted">Sounds play only when the Sounds flag is on and Calm mode is off. Calm mode also replaces every animation with a simple fade and hides mascot art. Reduced-motion system settings are always respected.</p>
      </Card>
      <Card className="flex flex-col gap-3 md:col-span-2">
        <Eyebrow>Anchor reminders · gentle nudges, never blame</Eyebrow>
        <div className="grid gap-3 sm:grid-cols-3">
          <button role="switch" aria-checked={r.enabled} onClick={() => saveReminders({ ...r, enabled: !r.enabled })} className="flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-2 text-body-s font-bold">
            Reminders {r.enabled ? "on" : "off"}
            <span className={cx("relative h-6 w-11 rounded-pill transition", r.enabled ? "bg-lime" : "bg-line")}>
              <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", r.enabled ? "start-[22px]" : "start-0.5")} />
            </span>
          </button>
          <label>
            <span className="label">Tone</span>
            <select className="field" value={r.tone} onChange={(e) => saveReminders({ ...r, tone: e.target.value as Reminders["tone"] })}>
              <option value="calm">Calm</option>
              <option value="playful">Playful</option>
              <option value="direct">Direct</option>
            </select>
          </label>
          <label>
            <span className="label">Max per day (hard cap 5)</span>
            <select className="field" value={r.maxPerDay} onChange={(e) => saveReminders({ ...r, maxPerDay: Number(e.target.value) })}>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-caption text-muted">Anchors come from your active habits plus Core block, nightly review and wind-down. The bell in the header shows what is due — in-app only, no push notifications, no penalties.</p>
      </Card>
    </div>
  );
}
