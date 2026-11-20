"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow, ProgressBar, StatTile } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";
import type { councilData, monthlyReviewView, reviewRoundsView } from "@/server/reviews";
import type { monthlyView } from "@/server/life";

type Q = { id: string; kind: string; title: string; tierDone: "seed" | "standard" | "stretch" | null; habit: boolean; tiers: Record<string, string> };

/**
 * Nightly Review (doc 05 §10.1): 1) tick quests 2) Spark Log (optional) 3) tomorrow's environment checklist (editable).
 * Keyboard: 1–9 toggle a quest/check item, Enter saves. Timer shows you stayed under 2 minutes.
 */
export function NightlyReview({ quests, saved, checklist, goal }: { quests: Q[]; saved: { spark: string; envDone: string[] } | null; checklist: string[]; goal: { minutes: number; focus: number; upgrade: { suggest: boolean; minutes: number; hitRate: number } } }) {
  const { toast } = useFeedback();
  const [spark, setSpark] = useState(saved?.spark ?? "");
  const [env, setEnv] = useState<string[]>(saved?.envDone ?? []);
  const [list, setList] = useState(checklist);
  const [newItem, setNewItem] = useState("");
  const [editing, setEditing] = useState(false);
  const t0 = useRef(Date.now());
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSec(Math.floor((Date.now() - t0.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const manual = quests.filter((q) => q.habit || q.kind === "pillar");
  async function tick(q: Q) {
    await apiFetch(`/api/quests/${q.id}`, { body: { tier: q.tierDone ? null : "standard" } }).catch((e) => toast((e as Error).message, "warn"));
  }
  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    try {
      await apiFetch("/api/reviews", { body: { action: "nightly", spark, envDone: env, checklist: list, seconds: sec } });
      toast(`Nightly review saved in ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} — sleep well`);
    } catch (err) {
      toast((err as Error).message, "warn");
    }
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA"].includes(tag)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const all = [...manual.map((q) => ({ q })), ...list.map((c) => ({ c }))];
        const it = all[n - 1];
        if (it && "q" in it) void tick(it.q);
        if (it && "c" in it) setEnv((x) => (x.includes(it.c) ? x.filter((y) => y !== it.c) : [...x, it.c]));
      }
      if (e.key === "Enter") void save();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  let idx = 0;
  return (
    <form onSubmit={save} className="grid gap-4 lg:grid-cols-3">
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Eyebrow>1 · Today&apos;s quests</Eyebrow>
          <Chip tone={sec <= 120 ? "lime" : "coral"} icon="clock">
            {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")} / 2:00
          </Chip>
        </div>
        <ul className="flex flex-col gap-1.5">
          {quests.map((q) => {
            const key = q.habit || q.kind === "pillar" ? ++idx : null;
            return (
              <li key={q.id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-body-s">
                <button type="button" disabled={key === null} onClick={() => tick(q)} className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full border-2", q.tierDone ? "border-lime bg-lime text-on-color" : "border-line")} aria-label={`${q.title}: ${q.tierDone ?? "not done"}`}>
                  {q.tierDone && <Icon name="check" size={12} />}
                </button>
                <span className="flex-1 font-bold" dir="auto">
                  {q.title}
                </span>
                {key !== null ? <kbd className="text-caption text-muted">{key}</kbd> : <span className="text-caption text-muted">{q.tierDone ?? "from logs"}</span>}
              </li>
            );
          })}
        </ul>
        <div>
          <p className="text-caption font-extrabold uppercase text-muted">Daily goal</p>
          <ProgressBar value={goal.focus / Math.max(1, goal.minutes)} tone="lime" label="Daily goal" />
          <p className="mt-1 text-caption">
            {goal.focus} / {goal.minutes} min
          </p>
          {goal.upgrade.suggest && <GoalUpgrade minutes={goal.upgrade.minutes} hitRate={goal.upgrade.hitRate} />}
        </div>
      </Card>
      <Card tone="yellow" className="flex flex-col gap-3">
        <Eyebrow>2 · Spark log (optional)</Eyebrow>
        <textarea className="min-h-36 rounded-2xl bg-on-color/10 p-3 font-bold outline-none placeholder:text-on-color/50" dir="auto" maxLength={300} value={spark} onChange={(e) => setSpark(e.target.value)} placeholder="What was good today? One line is enough." />
      </Card>
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Eyebrow>3 · Prepare tomorrow</Eyebrow>
          <button type="button" className="text-caption underline" onClick={() => setEditing((x) => !x)}>
            {editing ? "Done editing" : "Edit list"}
          </button>
        </div>
        <ul className="flex flex-col gap-1.5">
          {list.map((c) => {
            const key = ++idx;
            return (
              <li key={c} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-body-s">
                <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-purple))]" checked={env.includes(c)} onChange={() => setEnv((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))} aria-label={c} />
                <span className="flex-1" dir="auto">
                  {c}
                </span>
                {editing ? (
                  <button type="button" onClick={() => setList(list.filter((x) => x !== c))} aria-label={`Remove ${c}`}>
                    <Icon name="trash" size={14} />
                  </button>
                ) : (
                  <kbd className="text-caption text-muted">{key <= 9 ? key : ""}</kbd>
                )}
              </li>
            );
          })}
        </ul>
        {editing && (
          <div className="flex gap-2">
            <input className="field py-1.5" dir="auto" value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="New item" aria-label="New checklist item" />
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                if (newItem.trim()) setList([...list, newItem.trim()]);
                setNewItem("");
              }}
            >
              Add
            </button>
          </div>
        )}
        <button className="btn-accent self-start">
          Save review <kbd className="rounded bg-black/25 px-1.5 text-caption">Enter</kbd>
        </button>
      </Card>
    </form>
  );
}

function GoalUpgrade({ minutes, hitRate }: { minutes: number; hitRate: number }) {
  const { toast } = useFeedback();
  return (
    <div className="mt-2 rounded-2xl bg-lime/20 p-3 text-body-s">
      <p className="font-bold">
        You hit your goal {Math.round(hitRate * 100)}% of recent days. Increase it slightly to {minutes} min?
      </p>
      <button type="button" className="btn-ghost mt-2 py-1.5" onClick={() => apiFetch("/api/reviews", { body: { action: "goal", minutes } }).then(() => toast(`Daily goal: ${minutes} min`))}>
        Yes, raise it
      </button>
    </div>
  );
}

type Council = Awaited<ReturnType<typeof councilData>>;
const STEPS = ["Scoreboard", "What worked?", "What blocked?", "One change", "Learning slot", "Approve plan", "Next boss"];

/** Weekly Council (doc 05 §10.2): 7-step wizard; output = exactly ONE change for next week, linked to the Detour Ledger. */
export function WeeklyCouncil({ data, nextBoss }: { data: Council; nextBoss: { title: string; date: string; questions: number } | null }) {
  const { toast, celebrate } = useFeedback();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ worked: data.saved?.worked ?? "", blocked: data.saved?.blocked ?? "", oneChange: data.saved?.oneChange ?? "", slotTopic: data.saved?.slotTopic ?? "", planApproved: data.saved?.planApproved ?? false, bossNote: data.saved?.bossNote ?? "" });
  const tones = ["yellow", "mint", "coral", "purple", "lime", "surface", "coral"] as const;
  async function finish() {
    try {
      await apiFetch("/api/reviews", { body: { action: "council", ...f } });
      celebrate("Council closed — one change, one week.");
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <ol className="flex flex-wrap gap-1.5" aria-label="Council steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined} className={cx("chip py-1.5", i === step ? "bg-purple text-white" : i < step ? "bg-lime text-on-color" : "border border-line bg-surface-1 text-ink")}>
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>
      <Card tone={tones[step]} className="flex min-h-72 flex-col gap-4">
        <Eyebrow>
          Step {step + 1} of 7 · {STEPS[step]}
        </Eyebrow>
        {step === 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Level" value={data.xp.level} />
            <StatTile label="Week SS" value={Math.round(data.xp.weekSs)} />
            <StatTile label="Consistency" value={Math.round(data.consistency * 100)} unit="%" />
            <StatTile label="Standard days" value={data.standardDays} />
            {data.experiment && (
              <p className="col-span-2 text-caption font-bold sm:col-span-4">
                Lab verdict: {data.experiment.result.verdict} on “{data.experiment.changeText}” — details in the One change step.
              </p>
            )}
          </div>
        )}
        {step === 1 && <textarea className="min-h-40 rounded-2xl bg-on-color/10 p-3 font-bold outline-none" dir="auto" value={f.worked} onChange={(e) => setF({ ...f, worked: e.target.value })} placeholder="What worked this week? Keep doing it." />}
        {step === 2 && (
          <>
            <div className="rounded-2xl bg-on-color/10 p-3 text-body-s">
              <p className="font-extrabold">Detour Ledger · {data.ledger.totalMinutes} min this week</p>
              <p>Top escapes: {data.ledger.topKinds.map((k) => `${k.kind} (${k.minutes}m)`).join(", ") || "none logged"}</p>
              <p className={data.ledger.overLimit ? "mt-1 font-extrabold" : "mt-1"}>
                Anti-goal · Builder/site {data.ledger.builderMinutes} min = {data.ledger.sharePct}% of {data.ledger.studyMinutes} study min{" "}
                {data.ledger.overLimit ? "— above the 10% ceiling. Next week: close the builder, open the chapter." : "— within the 10% ceiling."}
              </p>
              {data.ledger.riskyHours.length > 0 && <p>Risky hours: {data.ledger.riskyHours.map((h) => `${h.hour}:00`).join(", ")}</p>}
              {data.ledger.reasons.length > 0 && <p className="mt-1 italic">“{data.ledger.reasons.slice(0, 3).join("” · “")}”</p>}
            </div>
            <textarea className="min-h-28 rounded-2xl bg-on-color/10 p-3 font-bold outline-none" dir="auto" value={f.blocked} onChange={(e) => setF({ ...f, blocked: e.target.value })} placeholder="What got in the way?" />
          </>
        )}
        {step === 3 && (
          <>
            <p className="font-bold">Only one change. Not three. What single thing will you do differently next week?</p>
            {data.experiment && (
              <div className="rounded-2xl bg-on-color/10 p-3 text-body-s">
                <p className="font-extrabold" dir="auto">Experiment Lab · “{data.experiment.changeText}”</p>
                <p className="mt-1 font-bold">
                  {data.experiment.result.verdict.toUpperCase()} · {data.experiment.metric}: {data.experiment.result.baseline ?? "—"} → {data.experiment.result.during ?? "—"}
                  {data.experiment.result.delta !== null && ` (${data.experiment.result.delta > 0 ? "+" : ""}${data.experiment.result.delta}${data.experiment.result.metric === "focus" ? "%" : " pp"})`}
                </p>
                <p className="text-caption opacity-80">{data.experiment.result.reasons.join(" ")} Threshold: {data.experiment.result.thresholdLabel}.</p>
                <button
                  className="btn mt-2 border-2 border-current px-4"
                  onClick={() => setF({ ...f, oneChange: `${data.experiment!.result.verdict === "worked" ? "Keep" : data.experiment!.result.verdict === "didnt" ? "Revert" : "Retest"}: ${data.experiment!.changeText}` })}
                >
                  Use as next week&apos;s change
                </button>
              </div>
            )}
            <input className="rounded-2xl bg-on-color/10 p-3 text-title-m font-extrabold text-white outline-none" dir="auto" value={f.oneChange} onChange={(e) => setF({ ...f, oneChange: e.target.value })} placeholder="e.g. Phone in another room during Core" />
            {data.previous.length > 0 && <p className="text-caption">Previous: {data.previous.map((p) => p.oneChange).join(" · ")}</p>}
          </>
        )}
        {step === 4 && <input className="rounded-2xl bg-on-color/10 p-3 font-bold outline-none" dir="auto" value={f.slotTopic} onChange={(e) => setF({ ...f, slotTopic: e.target.value })} placeholder="This week's learning-slot topic (≤ 3 × 30 min, only after Core). Empty during Trials/Arena." />}
        {step === 5 && (
          <label className="flex items-center gap-3 font-bold">
            <input type="checkbox" className="h-6 w-6" checked={f.planApproved} onChange={(e) => setF({ ...f, planApproved: e.target.checked })} />
            Next week&apos;s plan: {data.nextWeekPlanH}h of chapters — approve it (or rebalance on the Plan page first).
          </label>
        )}
        {step === 6 && (
          <>
            <p className="text-title-m font-extrabold">{nextBoss ? `${nextBoss.title} · ${nextBoss.date} · ${nextBoss.questions} tests` : "No boss scheduled next week."}</p>
            <input className="rounded-2xl bg-on-color/10 p-3 font-bold outline-none" dir="auto" value={f.bossNote} onChange={(e) => setF({ ...f, bossNote: e.target.value })} placeholder="Battle plan in one line" />
          </>
        )}
        <div className="mt-auto flex gap-2">
          {step > 0 && (
            <button className="btn border-2 border-current px-5" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < 6 ? (
            <button className="btn-primary" onClick={() => setStep(step + 1)}>
              Next <Icon name="arrow" size={16} />
            </button>
          ) : (
            <button className="btn-primary" disabled={f.oneChange.trim().length < 3} onClick={finish}>
              Close the Council
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── TOC ×3 review rounds (#81) ──────────────────────────────

type Rounds = Awaited<ReturnType<typeof reviewRoundsView>>;

/** Three spaced review rounds per active subject (day 0 / +7 / +14). A round is a retelling from memory, not a reread. */
export function ReviewRounds({ data, today }: { data: Rounds; today: string }) {
  const { toast } = useFeedback();
  const router = useRouter();
  async function set(id: string, status: "pending" | "done" | "skipped", note = "") {
    try {
      await apiFetch("/api/reviews", { body: { action: "round", id, status, note } });
      toast(status === "done" ? "Round closed" : status === "skipped" ? "Round skipped" : "Round reopened");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-4">
        <StatTile label="Done" value={`${data.done}/${data.total}`} tone="lime" />
        <StatTile label="Due today" value={data.due.length} tone={data.due.length ? "yellow" : "surface"} />
        <StatTile label="Overdue" value={data.overdue} tone={data.overdue ? "coral" : "surface"} />
        <StatTile label="TOC rounds" value={data.toc ? `${data.toc.done}/3` : "—"} tone="purple" hint="Theory of Computation — the hardest three-round chain" />
      </div>
      <Card tone="purple" className="flex flex-col gap-1">
        <Eyebrow>How a round works</Eyebrow>
        <p className="text-body-s font-bold">Close the book and retell the chapter from memory, then check what you missed. Round spacing is 7 days; the third round doubles as the Legendary condition for that subject.</p>
        <p className="text-caption opacity-80">Today is {today}. Overdue rounds stay open — the goal is memory, not a perfect calendar.</p>
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.bySubject.map((s) => (
          <Card key={s.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <Eyebrow>{s.subject?.en ?? s.id}</Eyebrow>
                <p className="fa font-extrabold" dir="auto">
                  {s.subject?.fa ?? ""}
                </p>
              </div>
              <Chip tone={s.round3Done ? "lime" : s.done ? "yellow" : "surface"}>{s.done}/3 rounds</Chip>
            </div>
            <ul className="flex flex-col gap-2">
              {s.rounds.map((r) => (
                <RoundRow key={r.id} r={r} onSet={set} />
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RoundRow({ r, onSet }: { r: Rounds["rounds"][number]; onSet: (id: string, status: "pending" | "done" | "skipped", note?: string) => void }) {
  const [note, setNote] = useState(r.note);
  return (
    <li className={cx("rounded-2xl p-2.5", r.overdue ? "bg-coral/15" : "bg-surface-2")}>
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <p className="text-body-s font-extrabold">
          Round {r.round} · {r.scheduledOn}
        </p>
        <div className="flex items-center gap-1">
          {r.overdue && <Chip tone="coral">Overdue</Chip>}
          <Chip tone={r.status === "done" ? "lime" : r.status === "skipped" ? "surface" : "yellow"}>{r.status}</Chip>
        </div>
      </div>
      {r.doneOn && <p className="text-caption text-muted">Closed {r.doneOn}</p>}
      <input className="field mt-2 py-1.5 text-body-s" dir="auto" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you miss? (optional note)" aria-label={`Round ${r.round} note`} />
      <div className="mt-1.5 flex flex-wrap gap-2 text-caption">
        {r.status !== "done" && (
          <button className="font-bold text-purple-ink underline" onClick={() => onSet(r.id, "done", note)}>
            Mark done
          </button>
        )}
        {r.status === "done" && (
          <button className="underline" onClick={() => onSet(r.id, "pending", note)}>
            Reopen
          </button>
        )}
        {r.status !== "skipped" && (
          <button className="underline" onClick={() => onSet(r.id, "skipped", note)}>
            Skip
          </button>
        )}
      </div>
    </li>
  );
}

// ── monthly review + Spark pattern (#81) ────────────────────

type MonthlyData = Awaited<ReturnType<typeof monthlyReviewView>>;
type MonthlyTheme = Awaited<ReturnType<typeof monthlyView>>;

const LA_OPTIONS = [
  { v: "keep_dropped", label: "Keep linear algebra dropped" },
  { v: "activate", label: "Activate it again" },
  { v: "reduce_weight", label: "Keep it active but reduce weight" },
  { v: "keep_active", label: "Keep it active at full weight" },
] as const;

export function MonthlyReview({ data, theme }: { data: MonthlyData; theme: MonthlyTheme }) {
  const { toast, celebrate } = useFeedback();
  const router = useRouter();
  const [f, setF] = useState({
    wins: data.saved?.wins ?? "",
    risks: data.saved?.risks ?? "",
    oneChange: data.saved?.oneChange ?? "",
    linearAlgebra: data.saved?.linearAlgebra ?? ("keep_dropped" as (typeof LA_OPTIONS)[number]["v"]),
    confidence: data.saved?.confidence ?? 3,
    note: data.saved?.note ?? "",
  });
  const spark = data.spark;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card tone="yellow" className="flex flex-col gap-2 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>{theme.month} · monthly challenge</Eyebrow>
          <Link href="/report/monthly" className="btn-ghost-on-color no-print px-3 py-1.5 text-caption">
            <Icon name="download" size={13} /> Monthly report (PDF)
          </Link>
        </div>
        <p className="font-display text-display-m uppercase leading-none">{theme.theme.name}</p>
        <p className="text-body-s font-bold">{theme.theme.story}</p>
        <p className="font-display text-display-l leading-none">
          {theme.progress.value} <span className="font-body text-body-s font-extrabold opacity-70">/ {theme.progress.target} {theme.theme.unit}</span>
        </p>
        <ProgressBar value={theme.progress.pct} tone="purple" track="dark" label="Monthly challenge progress" />
        {theme.badge && <Chip tone="purple">Badge earned · {theme.badge.badge}</Chip>}
      </Card>
      <Card className="flex flex-col gap-2">
        <Eyebrow>Linear algebra decision</Eyebrow>
        <p className="text-body-s font-bold">
          {data.linearAlgebra ? `${data.linearAlgebra.nameEn} · status ${data.linearAlgebra.status}` : "Linear algebra is not in the subject list."}
        </p>
        <p className="text-caption text-muted">Risk decision once a month, not every week. A dropped subject stays visible on the map but is never counted in required nodes.</p>
      </Card>
      <Card className="flex flex-col gap-3 lg:col-span-2">
        <Eyebrow>Monthly review</Eyebrow>
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await apiFetch("/api/reviews", { body: { action: "monthly", ...f } });
              celebrate("Month reviewed — one change, one decision.");
              router.refresh();
            } catch (err) {
              toast((err as Error).message, "warn");
            }
          }}
        >
          <label className="sm:col-span-2">
            <span className="label">What worked this month?</span>
            <textarea className="min-h-24 w-full rounded-2xl bg-surface-2 p-3 font-bold outline-none" dir="auto" maxLength={1200} value={f.wins} onChange={(e) => setF({ ...f, wins: e.target.value })} />
          </label>
          <label className="sm:col-span-2">
            <span className="label">What was the biggest risk?</span>
            <textarea className="min-h-24 w-full rounded-2xl bg-surface-2 p-3 font-bold outline-none" dir="auto" maxLength={1200} value={f.risks} onChange={(e) => setF({ ...f, risks: e.target.value })} />
          </label>
          <label className="sm:col-span-2">
            <span className="label">One change for next month (required)</span>
            <input className="field" dir="auto" required minLength={3} maxLength={300} value={f.oneChange} onChange={(e) => setF({ ...f, oneChange: e.target.value })} placeholder="One change. Not three." />
          </label>
          <label>
            <span className="label">Linear algebra</span>
            <select className="field" value={f.linearAlgebra} onChange={(e) => setF({ ...f, linearAlgebra: e.target.value as typeof f.linearAlgebra })}>
              {LA_OPTIONS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Confidence in the decision (1–5)</span>
            <input type="number" min={1} max={5} className="field" value={f.confidence} onChange={(e) => setF({ ...f, confidence: Number(e.target.value) })} />
          </label>
          <label className="sm:col-span-2">
            <span className="label">Note</span>
            <input className="field" dir="auto" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </label>
          <button className="btn-accent justify-self-start">Save monthly review</button>
        </form>
        {data.saved && <p className="text-caption text-muted">Saved for {data.month}: {data.saved.oneChange}</p>}
        {data.history.length > 1 && (
          <details className="text-body-s">
            <summary className="cursor-pointer font-extrabold">Previous months</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {data.history.slice(1).map((h) => (
                <li key={h.date} className="rounded-xl bg-surface-2 px-3 py-1.5">
                  <b>{h.date}</b> · {h.oneChange} · linear algebra: {h.linearAlgebra}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      <Card tone="mint" className="flex flex-col gap-2">
        <Eyebrow>Spark log pattern</Eyebrow>
        {spark.ready ? (
          <>
            <p className="text-body-s font-bold">{spark.note}</p>
            <ul className="flex flex-col gap-2">
              {spark.topWords.map((w) => (
                <li key={w.word}>
                  <div className="flex items-center justify-between text-body-s font-extrabold">
                    <span dir="auto">{w.word}</span>
                    <span>{w.count}</span>
                  </div>
                  <ProgressBar value={w.count / Math.max(1, spark.topWords[0]?.count ?? 1)} tone="purple" label={`${w.word}: ${w.count}`} />
                </li>
              ))}
            </ul>
            <p className="text-caption opacity-80">From {spark.sparks.length} recent sparks.</p>
          </>
        ) : (
          <>
            <p className="text-body-s font-bold">The pattern needs {spark.needed} nightly sparks — you have {spark.days}.</p>
            <ProgressBar value={spark.days / spark.needed} tone="purple" label="Spark pattern progress" track="dark" />
            <p className="text-caption opacity-80">Spark after 14 days, not after one good night.</p>
          </>
        )}
      </Card>
    </div>
  );
}
