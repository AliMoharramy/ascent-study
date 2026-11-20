"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow, StatTile } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";
import type { capacityView, planView } from "@/server/plan";

type View = Awaited<ReturnType<typeof planView>>;
type Cap = Awaited<ReturnType<typeof capacityView>>;
const DAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
const STATUS = { green: "bg-lime", yellow: "bg-yellow", red: "bg-coral" } as const;

export function PlanClient({ view, capacity, restDays, today }: { view: View; capacity: Cap; fillFraction: number; restDays: string[]; today: string }) {
  const { toast } = useFeedback();
  const [sel, setSel] = useState(view.currentWeek);
  const [dragId, setDragId] = useState<string | null>(null);
  const [tab, setTab] = useState<"calendar" | "triage" | "capacity">("calendar");
  const chName = (id: string) => {
    const c = view.chapters.find((x) => x.id === id);
    return c ? `${c.subjectId.toUpperCase()} ${c.no} · ${c.title}` : id;
  };
  async function act(body: Record<string, unknown>, ok: string) {
    try {
      await apiFetch("/api/plan", { body });
      toast(ok);
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  const week = view.weeks.find((w) => w.no === sel)!;
  const items = view.items.filter((i) => i.weekNo === sel);
  const gap = view.gap;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Capacity (measured)" value={capacity.scenarios.find((s) => s.key === "measured")?.hours ?? capacity.scenarios[1]!.hours} unit="h/wk" hint={`factor ${capacity.factor.factor} · ${capacity.factor.source}`} />
        <StatTile label="M+S still needed" value={Math.round(gap.needH)} unit="h" />
        <StatTile label="Study hours left (to wk 19)" value={Math.round(gap.haveH)} unit="h" />
        <StatTile label="Burn gap" value={`${gap.gapH > 0 ? "+" : ""}${Math.round(gap.gapH)}`} unit="h" tone={gap.gapH > 0 ? "coral" : "lime"} hint={gap.gapH > 0 ? "deficit → rebalance / triage" : "fits"} />
      </div>
      <div className="flex flex-wrap gap-2">
        {(["calendar", "triage", "capacity"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={cx("chip px-4 py-2 text-body-s capitalize", tab === t ? "bg-purple text-white" : "border border-line bg-surface-1 text-ink")}>
            {t}
          </button>
        ))}
        <span className="ms-auto" />
        <button className="btn-ghost" onClick={() => act({ action: "triage" }, "Triage re-run — tiers updated")}>
          Re-run triage
        </button>
        <button className="btn-accent" onClick={() => act({ action: "rebalance" }, "Rebalanced from this week — no debt carried, C dropped if needed")}>
          Rebalance
        </button>
        <button className="btn-ghost" onClick={() => confirm("Reset Week? Once a month: penalties this week are limited to −50 and the plan restarts from today.") && act({ action: "reset_week" }, "Week reset — fresh start")}>
          Reset Week
        </button>
      </div>

      {tab === "calendar" && (
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Card className="flex flex-col gap-2">
            <Eyebrow>25 weeks · load ratio (green ≤ 0.9 · yellow ≤ 1.0 · red &gt; 1) · drag a chapter onto a week</Eyebrow>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
              {view.weeks.map((w) => (
                <button
                  key={w.no}
                  onClick={() => setSel(w.no)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dragId && act({ action: "move", itemId: dragId, toWeek: w.no }, `Moved to week ${w.no}`)}
                  aria-pressed={sel === w.no}
                  aria-label={`Week ${w.no}, load ${w.loadRatio}`}
                  className={cx("flex flex-col items-start gap-1 rounded-2xl p-2 text-start", sel === w.no ? "ring-2 ring-purple" : "", w.no === view.currentWeek ? "bg-surface-2" : "bg-surface-2/60", w.no < view.currentWeek && "opacity-60")}
                >
                  <span className="font-display text-title-m leading-none">{w.no}</span>
                  <span className={cx("h-1.5 w-full rounded-pill", STATUS[w.status as keyof typeof STATUS])} />
                  <span className="text-[10px] font-extrabold">{w.loadRatio}</span>
                  {w.reset && <span className="text-[10px] text-coral-ink">reset</span>}
                </button>
              ))}
            </div>
          </Card>
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Eyebrow>
                Week {week.no} · {week.phase}
              </Eyebrow>
              <Chip tone={week.status === "red" ? "coral" : week.status === "yellow" ? "yellow" : "lime"}>Load {week.loadRatio}</Chip>
            </div>
            <p className="text-body-s text-muted">
              Starts {week.startsOn} · capacity {week.capacityH}h · committed {week.committedH}h (incl. daily foundations + English)
            </p>
            {items.length === 0 && <p className="text-body-s text-muted">No chapters planned this week (Baseline, Trials, Arena and Final weeks are for tests and review).</p>}
            <ul className="flex flex-col gap-1.5">
              {items.map((i) => (
                <li key={i.id} draggable onDragStart={() => setDragId(i.id)} onDragEnd={() => setDragId(null)} className="flex cursor-grab items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-body-s active:cursor-grabbing">
                  <Chip tone={i.tier === "M" ? "yellow" : i.tier === "S" ? "mint" : "surface"}>{i.tier}</Chip>
                  <Link href={`/map/${i.chapterId}`} className="fa flex-1 truncate font-bold hover:underline" dir="auto">
                    {chName(i.chapterId)}
                  </Link>
                  <span className="text-caption text-muted">
                    {Math.round(i.plannedMin / 6) / 10}h · {i.testsTarget} tests
                  </span>
                  {i.manual && <span className="text-caption text-purple-ink">moved</span>}
                  <select aria-label="Move to week" className="rounded-lg bg-surface-1 px-1 text-caption" value={i.weekNo} onChange={(e) => act({ action: "move", itemId: i.id, toWeek: Number(e.target.value) }, `Moved to week ${e.target.value}`)}>
                    {view.weeks.map((w) => (
                      <option key={w.no} value={w.no}>
                        wk {w.no}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {tab === "triage" && (
        <Card className="overflow-x-auto">
          <Eyebrow>Triage · ROI = Eq × (1 − a0) ÷ H · M covers ~70 % of each subject&apos;s expected questions</Eyebrow>
          <p className="mt-1 text-caption text-muted">Eq is the chapter&apos;s share of past-exam questions (T-DATA-07). Highest-Eq chapters survive triage first, so the plan follows the real exam, not chapter order.</p>
          <table className="mt-3 w-full text-body-s">
            <thead>
              <tr className="text-caption uppercase text-muted">
                <th className="py-1 text-start">Chapter</th>
                <th>Tier</th>
                <th className="text-end">Eq</th>
                <th className="text-end">a0</th>
                <th className="text-end">Hours</th>
                <th className="text-end">State</th>
              </tr>
            </thead>
            <tbody>
              {view.chapters.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="py-1.5">
                    <Link href={`/map/${c.id}`} className="fa hover:underline" dir="auto">
                      {c.subjectId.toUpperCase()} {c.no} · {c.title}
                    </Link>
                  </td>
                  <td className="text-center">
                    <Chip tone={c.tier === "M" ? "yellow" : c.tier === "S" ? "mint" : "surface"}>
                      {c.tier ?? "—"}
                      {c.tierLocked ? " 🔒" : ""}
                    </Chip>
                  </td>
                  <td className="text-end">{c.eq != null ? c.eq.toFixed(3) : "—"}</td>
                  <td className="text-end">{c.a0 != null ? `${Math.round(c.a0 * 100)}%` : "—"}</td>
                  <td className="text-end">{c.hours}</td>
                  <td className="text-end">{c.cleared ? "★" : c.focusMin ? `${Math.round(c.focusMin)}m` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-caption text-muted">Override a tier from the chapter page (a reason is required; prerequisite conflicts warn).</p>
        </Card>
      )}

      {tab === "capacity" && <CapacityEditor capacity={capacity} restDays={restDays} today={today} />}
    </div>
  );
}

function CapacityEditor({ capacity, restDays, today }: { capacity: Cap; restDays: string[]; today: string }) {
  const { toast } = useFeedback();
  const router = useRouter();
  const [ws, setWs] = useState(capacity.windows);
  const [ex, setEx] = useState(capacity.exceptions.filter((e) => !restDays.includes(e.date)));
  const [rest, setRest] = useState(restDays);
  const [restDate, setRestDate] = useState(today);
  async function save() {
    try {
      await apiFetch("/api/plan", { body: { action: "windows", windows: ws, exceptions: ex } });
      toast("Time windows saved — capacity and plan recalculated on the next rebalance");
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  async function actRest(date: string, action: "set" | "remove") {
    try {
      const r = await apiFetch<{ days: string[] }>("/api/rest-days", { body: { action, date, today } });
      setRest(r.days);
      toast(action === "set" ? "Rest day planned — weekly capacity reduced, no penalties" : "Rest day removed");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card tone="purple" className="flex flex-col gap-3 lg:col-span-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Rest Day Pass (F-DUO-02)</Eyebrow>
            <p className="text-body-s font-bold">One planned rest day per week: capacity becomes 0, no penalties, the flame is untouched.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className="field w-40" value={restDate} min={today} onChange={(e) => setRestDate(e.target.value)} aria-label="Rest day date" />
            <button className="btn bg-white text-on-color" onClick={() => actRest(restDate, "set")} disabled={rest.includes(restDate)}>
              Plan rest
            </button>
          </div>
        </div>
        {rest.length === 0 ? (
          <p className="text-body-s opacity-80">No rest days planned.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {rest.map((d) => (
              <li key={d} className="flex items-center gap-2 rounded-pill bg-white/15 px-3 py-1.5 text-body-s font-bold">
                {d}
                <button onClick={() => actRest(d, "remove")} aria-label={`Remove rest day ${d}`} className="opacity-70 hover:opacity-100">
                  <Icon name="x" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-caption opacity-75">Capacity updates immediately; press Rebalance to reschedule chapters around it.</p>
      </Card>
      <Card className="flex flex-col gap-3">
        <Eyebrow>Weekly time windows · raw {capacity.rawHours}h</Eyebrow>
        {ws.map((w, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select className="field w-24 py-1.5" value={w.weekday} onChange={(e) => setWs(ws.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))} aria-label="Weekday">
              {DAYS.map((d, k) => (
                <option key={d} value={k}>
                  {d}
                </option>
              ))}
            </select>
            <input type="time" className="field w-32 py-1.5" value={w.start} onChange={(e) => setWs(ws.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} aria-label="Start" />
            <span>→</span>
            <input type="time" className="field w-32 py-1.5" value={w.end} onChange={(e) => setWs(ws.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} aria-label="End" />
            <button className="btn-ghost px-2.5 py-1.5" onClick={() => setWs(ws.filter((_, j) => j !== i))} aria-label="Remove window">
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setWs([...ws, { weekday: 0, start: "09:00", end: "12:00" }])}>
            <Icon name="plus" size={14} /> Window
          </button>
          <button className="btn-ghost" onClick={() => setEx([...ex, { date: new Date().toISOString().slice(0, 10), minutes: 0, reason: "" }])}>
            <Icon name="plus" size={14} /> Exception day
          </button>
          <button className="btn-accent" onClick={save}>
            Save
          </button>
        </div>
        {ex.map((e, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-body-s">
            <input type="date" className="field w-40 py-1.5" value={e.date} onChange={(v) => setEx(ex.map((x, j) => (j === i ? { ...x, date: v.target.value } : x)))} aria-label="Exception date" />
            <input inputMode="numeric" className="field w-24 py-1.5" value={e.minutes} onChange={(v) => setEx(ex.map((x, j) => (j === i ? { ...x, minutes: Number(v.target.value.replace(/\D/g, "") || 0) } : x)))} aria-label="Available minutes" />
            <span className="text-muted">min available</span>
            <input className="field flex-1 py-1.5" dir="auto" value={e.reason ?? ""} placeholder="reason" onChange={(v) => setEx(ex.map((x, j) => (j === i ? { ...x, reason: v.target.value } : x)))} aria-label="Reason" />
            <button className="btn-ghost px-2.5 py-1.5" onClick={() => setEx(ex.filter((_, j) => j !== i))} aria-label="Remove exception">
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
      </Card>
      <Card className="flex flex-col gap-2">
        <Eyebrow>Scenarios (doc 03 §2)</Eyebrow>
        {capacity.scenarios.map((s) => (
          <div key={s.key} className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
            <span className="font-extrabold capitalize">{s.key}</span>
            <span className="text-body-s text-muted">× {s.factor}</span>
            <span className="font-display text-title-l">{s.hours}h</span>
          </div>
        ))}
        <p className="text-caption text-muted">Focus factor = real focus ÷ raw window hours, moving average of the last 3 weeks ({capacity.factor.source === "measured" ? `${capacity.factor.weeks} weeks measured` : "no data yet → 0.65 base"}).</p>
      </Card>
    </div>
  );
}
