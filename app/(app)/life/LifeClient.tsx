"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { bondsView, builderView, escapeSeries, explorationView, monthlyView } from "@/server/life";
import type { leagueView } from "@/server/league";
import type { storyView } from "@/server/story";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, EmptyState, Eyebrow, ProgressBar, StatTile } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";

type Explore = Awaited<ReturnType<typeof explorationView>>;
type Bonds = Awaited<ReturnType<typeof bondsView>>;
type Builder = Awaited<ReturnType<typeof builderView>>;
type League = Awaited<ReturnType<typeof leagueView>>;
type Story = Omit<Awaited<ReturnType<typeof storyView>>, "overridden"> & { overridden: number[] };
type Escapes = Awaited<ReturnType<typeof escapeSeries>>;
type Monthly = Awaited<ReturnType<typeof monthlyView>>;
type Post = (body: Record<string, unknown>, ok?: string) => Promise<boolean>;
type Data = { explore: Explore; bonds: Bonds; builder: Builder; league: League; story: Story; escapes: Escapes; monthly: Monthly };

const STATUS_TONE = { backlog: "surface", trial: "mint", active: "lime", archived: "coral" } as const;

export function LifeClient({ tab, data, today }: { tab: string; data: Data; today: string }) {
  const { toast } = useFeedback();
  const router = useRouter();
  const post: Post = async (body, ok) => {
    try {
      await apiFetch("/api/life", { body });
      if (ok) toast(ok);
      router.refresh();
      return true;
    } catch (e) {
      toast((e as Error).message, "warn");
      return false;
    }
  };
  if (tab === "explore") return <Explore v={data.explore} post={post} />;
  if (tab === "bonds") return <Bonds v={data.bonds} post={post} />;
  if (tab === "builder") return <Builder v={data.builder} post={post} />;
  if (tab === "league") return <League v={data.league} />;
  if (tab === "story") return <StoryTab v={data.story} post={post} />;
  if (tab === "escapes") return <Escapes v={data.escapes} />;
  return <MonthlyTab v={data.monthly} today={today} />;
}

// ── exploration slot (#76) ──────────────────────────────────

function Explore({ v, post }: { v: Explore; post: Post }) {
  const [f, setF] = useState({ title: "", why: "", value: 3 });
  const [log, setLog] = useState({ topicId: v.topics.find((t) => t.status === "trial" || t.status === "active")?.id ?? "", minutes: 20, kind: "trial" as "trial" | "review" | "output", output: "" });
  const open = v.topics.filter((t) => t.status === "trial" || t.status === "active");
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="flex flex-col gap-3 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <Eyebrow>This week · week {v.weekNo}</Eyebrow>
            <p className="font-display text-display-m leading-none">
              {v.budget.usedMinutes} / {v.budget.capMinutes} min
            </p>
            <p className="mt-1 text-caption text-muted">Study {v.studyMinutes} min → exploration cap is 10 % of it. Forge/builder minutes count against the same cap.</p>
          </div>
          <Chip tone={v.suspended ? "coral" : v.budget.over ? "coral" : "mint"}>{v.suspended ? `Paused · ${v.phase}` : v.budget.over ? "Over cap" : "Open"}</Chip>
        </div>
        <ProgressBar value={v.budget.capMinutes ? v.budget.usedMinutes / v.budget.capMinutes : 0} tone={v.budget.over ? "coral" : "mint"} label="Exploration budget" />
        {v.suspended && <p className="rounded-2xl bg-coral/15 p-3 text-body-s font-bold">The slot is suspended during {v.phase}. Core and review only — curiosity returns after the gate.</p>}
        {v.pick && (
          <div className="rounded-2xl bg-surface-2 p-3">
            <p className="text-caption font-extrabold uppercase text-muted">This week&apos;s pick</p>
            <p className="mt-1 text-title-s font-extrabold" dir="auto">
              {v.pick.title}
            </p>
            <p className="text-body-s opacity-80" dir="auto">
              {v.pick.why || "No reason written — a curiosity needs a why."}
            </p>
            <button className="btn-ghost mt-2 py-1.5" disabled={v.suspended} onClick={() => post({ action: "topic-status", id: v.pick!.id, status: "trial" }, "7-day trial started")}>
              Start 7-day trial <Icon name="arrow" size={13} />
            </button>
          </div>
        )}
        <p className="text-caption text-muted">Weekly target: {v.target.sessions}/3 sessions · {v.target.minutes} min used. Backlog → 7-day Trial → gate review (28-day re-check) → Active or Archive.</p>
      </Card>
      <Card tone="purple" className="flex flex-col gap-2">
        <Eyebrow>Spend slot time</Eyebrow>
        {open.length === 0 ? (
          <p className="text-body-s font-bold">Start a topic as a trial first. Backlog items cannot spend slot time.</p>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await post({ action: "explore", ...log }, "Slot session logged");
            }}
          >
            <label>
              <span className="label">Topic</span>
              <select className="field" value={log.topicId} onChange={(e) => setLog({ ...log, topicId: e.target.value })}>
                {open.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({t.status})
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="label">Minutes (≤ 30)</span>
                <input type="number" min={1} max={30} className="field" value={log.minutes} onChange={(e) => setLog({ ...log, minutes: Number(e.target.value) })} />
              </label>
              <label>
                <span className="label">Kind</span>
                <select className="field" value={log.kind} onChange={(e) => setLog({ ...log, kind: e.target.value as typeof log.kind })}>
                  <option value="trial">trial</option>
                  <option value="review">review</option>
                  <option value="output">output</option>
                </select>
              </label>
            </div>
            <label>
              <span className="label">One-line output</span>
              <input className="field" dir="auto" value={log.output} onChange={(e) => setLog({ ...log, output: e.target.value })} placeholder="What did the 20 minutes produce?" />
            </label>
            <button className="btn-primary" disabled={v.suspended || !log.topicId}>
              Log session
            </button>
          </form>
        )}
      </Card>
      <Card className="flex flex-col gap-2 lg:col-span-2">
        <Eyebrow>Topic backlog</Eyebrow>
        {v.topics.length === 0 ? (
          <EmptyState icon="bulb" title="No topics yet">
            Add one curiosity from this week — something you would study even without an exam.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {v.topics.map((t) => (
              <TopicRow key={t.id} t={t} post={post} />
            ))}
          </ul>
        )}
      </Card>
      <Card tone="mint" className="flex flex-col gap-2">
        <Eyebrow>Add a topic</Eyebrow>
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await post({ action: "topic", ...f }, "Topic saved")) setF({ title: "", why: "", value: 3 });
          }}
        >
          <label>
            <span className="label">Title</span>
            <input className="field" dir="auto" required minLength={2} maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Distributed consensus" />
          </label>
          <label>
            <span className="label">Why now?</span>
            <input className="field" dir="auto" maxLength={300} value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} placeholder="The question that will not leave you alone" />
          </label>
          <label>
            <span className="label">Perceived value (1–5)</span>
            <input type="number" min={1} max={5} className="field" value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} />
          </label>
          <button className="btn-accent">Add to backlog</button>
        </form>
      </Card>
    </div>
  );
}

function TopicRow({ t, post }: { t: Explore["topics"][number]; post: Post }) {
  const [note, setNote] = useState("");
  const [gateOpen, setGateOpen] = useState(false);
  return (
    <li className="rounded-2xl bg-surface-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-extrabold" dir="auto">
            {t.title}
          </p>
          <p className="text-caption text-muted" dir="auto">
            value {t.value}/5 · {t.why || "no why yet"} {t.startedOn && `· trial since ${t.startedOn}`} {t.sessionsThisWeek > 0 && `· ${t.sessionsThisWeek} session(s) this week`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone={STATUS_TONE[t.status]}>{t.status}</Chip>
          {t.gateDue && <Chip tone="yellow">Gate due</Chip>}
          {t.archiveReview && <Chip tone="coral">28-day review</Chip>}
        </div>
      </div>
      {t.gateNote && (
        <p className="mt-2 text-caption" dir="auto">
          Gate verdict: {t.gateNote}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-caption">
        {t.status === "backlog" && <button className="underline" onClick={() => post({ action: "topic-status", id: t.id, status: "trial" }, "7-day trial started")}>Start trial</button>}
        {t.status === "trial" && <button className="font-bold text-purple-ink underline" onClick={() => setGateOpen((x) => !x)}>Gate review</button>}
        {t.status !== "archived" && <button className="underline" onClick={() => post({ action: "topic-status", id: t.id, status: "archived", note: "Archived from the backlog" }, "Archived — curiosity is not a contract")}>Archive</button>}
        {t.status === "archived" && <button className="underline" onClick={() => post({ action: "topic-status", id: t.id, status: "backlog" }, "Back in the backlog")}>Reopen</button>}
      </div>
      {gateOpen && t.status === "trial" && (
        <div className="mt-2 flex flex-col gap-2 rounded-xl bg-surface-1 p-2 sm:flex-row">
          <input className="field" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What earned it a permanent slot? (required)" aria-label="Gate verdict" />
          <button className="btn-ghost shrink-0" disabled={note.trim().length < 3} onClick={() => post({ action: "topic-status", id: t.id, status: "active", note }, "Topic promoted to Active")}>
            Pass gate
          </button>
          <button className="btn-ghost shrink-0" disabled={note.trim().length < 3} onClick={() => post({ action: "topic-status", id: t.id, status: "archived", note }, "Archived at the gate")}>
            Archive
          </button>
        </div>
      )}
    </li>
  );
}

// ── bonds + bedtime reading (#77) ───────────────────────────

function Bonds({ v, post }: { v: Bonds; post: Post }) {
  const [c, setC] = useState({ name: "", relation: "", reminderDays: 14 });
  const [r, setR] = useState({ book: v.reading[0]?.book ?? "", pages: 10, minutes: 0, note: "" });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card tone="purple" className="flex flex-col gap-2 lg:col-span-2">
        <Eyebrow>Weekly mission · gentle, no streak</Eyebrow>
        <p className="text-title-s font-extrabold">{v.mission ? v.mission.text : "Everyone is up to date. Send one unprompted message anyway — presence is the habit."}</p>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="People" value={v.peopleThisWeek} tone="surface" />
          <StatTile label="Interactions" value={v.thisWeek} tone="surface" />
          <StatTile label="Pages" value={v.pagesThisWeek} tone="surface" />
        </div>
        <p className="text-caption opacity-80">Missed reminders only re-appear. No SS loss, no broken streak, no guilt loop.</p>
      </Card>
      <Card tone="yellow" className="flex flex-col gap-2">
        <Eyebrow>Bedtime reading</Eyebrow>
        <p className="text-body-s font-bold">{v.bedtime.text}</p>
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await post({ action: "reading", ...r }, "Reading logged");
          }}
        >
          <input className="field bg-on-color/10" dir="auto" required maxLength={120} value={r.book} onChange={(e) => setR({ ...r, book: e.target.value })} placeholder="Book" aria-label="Book" />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min={0} max={500} className="field bg-on-color/10" value={r.pages} onChange={(e) => setR({ ...r, pages: Number(e.target.value) })} aria-label="Pages" />
            <input type="number" min={0} max={240} className="field bg-on-color/10" value={r.minutes} onChange={(e) => setR({ ...r, minutes: Number(e.target.value) })} aria-label="Minutes" />
          </div>
          <button className="btn-primary">Log tonight&apos;s pages</button>
        </form>
      </Card>
      <Card className="flex flex-col gap-2 lg:col-span-2">
        <Eyebrow>People</Eyebrow>
        {v.contacts.length === 0 ? (
          <EmptyState icon="sparkle" title="No bonds listed">Add two or three people who matter. The reminder interval is yours to set.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {v.contacts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 p-3">
                <div>
                  <p className="font-extrabold" dir="auto">
                    {p.name} <span className="text-caption font-normal text-muted">{p.relation}</span>
                  </p>
                  <p className="text-caption text-muted">{p.sinceDays === null ? "No contact logged yet" : `${p.sinceDays} days since last contact · remind every ${p.reminderDays}`}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {p.due && <Chip tone="yellow">Due</Chip>}
                  {(["message", "call", "meet"] as const).map((k) => (
                    <button key={k} className="chip border border-line bg-surface-1 py-1" onClick={() => post({ action: "bond-log", contactId: p.id, kind: k }, `${p.name} · ${k} logged`)}>
                      {k}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card tone="mint" className="flex flex-col gap-2">
        <Eyebrow>Add a person</Eyebrow>
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await post({ action: "bond", ...c }, "Bond added")) setC({ name: "", relation: "", reminderDays: 14 });
          }}
        >
          <input className="field" dir="auto" required value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="Name" aria-label="Name" />
          <input className="field" dir="auto" value={c.relation} onChange={(e) => setC({ ...c, relation: e.target.value })} placeholder="Relation (sister, friend…)" aria-label="Relation" />
          <label>
            <span className="label">Gentle reminder every (days)</span>
            <input type="number" min={1} max={365} className="field" value={c.reminderDays} onChange={(e) => setC({ ...c, reminderDays: Number(e.target.value) })} />
          </label>
          <button className="btn-accent">Add bond</button>
        </form>
      </Card>
      <Card className="flex flex-col gap-2 lg:col-span-3">
        <Eyebrow>This week&apos;s reading</Eyebrow>
        {v.reading.length === 0 ? (
          <p className="text-body-s text-muted">No pages logged in the last seven days. Ten pages before bed is enough to restart.</p>
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {v.reading.map((l, i) => (
              <li key={i} className="rounded-xl bg-surface-2 px-3 py-1.5 text-body-s">
                <b>{l.gameDay}</b> · <span dir="auto">{l.book}</span> · {l.pages} pages{l.minutes ? ` · ${l.minutes} min` : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Builder Hour (#78) ──────────────────────────────────────

function Builder({ v, post }: { v: Builder; post: Post }) {
  const [f, setF] = useState({ minutes: 60, built: "" });
  const [bank, setBank] = useState(30);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card tone={v.eligible ? "lime" : "coral"} className="flex flex-col gap-2 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <Eyebrow>Week {v.weekNo} · earned, not bought</Eyebrow>
            <p className="font-display text-display-m leading-none">{v.available} min available</p>
          </div>
          <Chip tone={v.eligible ? "mint" : "coral"}>{v.eligible ? "Unlocked" : "Locked"}</Chip>
        </div>
        <ProgressBar value={v.available / Math.max(1, v.credit + v.bank)} tone="purple" label="Available Builder minutes" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Base credit" value={v.credit} unit="min" tone="surface" />
          <StatTile label="Used" value={v.used} unit="min" tone="surface" />
          <StatTile label="Bank" value={`${v.bank}/${v.bankCap}`} unit="min" tone="surface" />
          <StatTile label="Boss + duel" value={`${v.bossesDefeated} + ${v.duelsWon}`} tone="surface" />
        </div>
        {!v.eligible && (
          <p className="text-body-s font-bold">
            Needs ≥ {Math.round(v.minConsistency * 100)} % consistency and {v.minCoreDays} Standard Core days this week — currently {Math.round(v.consistency * 100)} % and {v.coreDays} days. Gold cannot buy Builder time.
          </p>
        )}
        <p className="text-caption opacity-80">Credit = 60 base + 60 per boss/duel (weekly cap {v.credit} min) · unspent time can be banked up to {v.bankCap} min.</p>
      </Card>
      <Card tone="purple" className="flex flex-col gap-2">
        <Eyebrow>Log what you built</Eyebrow>
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await post({ action: "builder", ...f }, "Builder session logged")) setF({ minutes: 60, built: "" });
          }}
        >
          <label>
            <span className="label">Minutes</span>
            <input type="number" min={1} max={Math.max(1, v.available)} className="field" value={f.minutes} disabled={!v.eligible || v.available < 1} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })} />
          </label>
          <label>
            <span className="label">What I built (one line)</span>
            <input className="field" dir="auto" required minLength={3} maxLength={300} value={f.built} onChange={(e) => setF({ ...f, built: e.target.value })} placeholder="What exists now that did not before?" />
          </label>
          <button className="btn-primary" disabled={!v.eligible || v.available < 1 || f.built.trim().length < 3}>
            Log session
          </button>
        </form>
        <form
          className="flex items-end gap-2 border-t border-white/15 pt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await post({ action: "builder-bank", minutes: bank, reason: "Unused Builder time" }, "Minutes banked");
          }}
        >
          <label className="flex-1">
            <span className="label">Bank unused minutes</span>
            <input type="number" min={1} max={Math.max(1, v.available)} className="field bg-white/10" value={bank} disabled={!v.eligible || v.available < 1} onChange={(e) => setBank(Number(e.target.value))} />
          </label>
          <button className="btn-ghost" disabled={!v.eligible || v.available < 1}>
            Bank
          </button>
        </form>
      </Card>
      <Card className="flex flex-col gap-2 lg:col-span-2">
        <Eyebrow>“What I built?” report</Eyebrow>
        {v.sessions.length === 0 ? (
          <p className="text-body-s text-muted">No sessions this week. The door is open only after the Core is done — that is the point.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {v.sessions.map((s) => (
              <li key={s.id} className="rounded-xl bg-surface-2 px-3 py-2 text-body-s">
                <b>{s.gameDay}</b> · {s.minutes} min · <span dir="auto">{s.built}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="flex flex-col gap-2">
        <Eyebrow>Bank ledger</Eyebrow>
        {v.bankEntries.length === 0 ? (
          <p className="text-body-s text-muted">Nothing banked yet. Unused minutes expire with the week unless banked (max {v.bankCap}).</p>
        ) : (
          <ul className="flex flex-col gap-1 text-body-s">
            {v.bankEntries.map((b) => (
              <li key={b.id} className="flex justify-between gap-2 rounded-xl bg-surface-2 px-3 py-1.5">
                <span>
                  {b.gameDay} · {b.reason}
                </span>
                <b>{b.minutes} min</b>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Ghost League (#83) ──────────────────────────────────────

function League({ v }: { v: League }) {
  if (!v.enabled)
    return (
      <Card tone="purple" className="flex flex-col gap-2">
        <Eyebrow>Ghost League</Eyebrow>
        <p className="text-body-s font-bold">{v.reason}</p>
        <Link href="/settings" className="btn bg-white text-on-color self-start">
          Open feature flags
        </Link>
      </Card>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card tone="purple" className="flex flex-col gap-2 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <Eyebrow>Week {v.weekNo} · tier {v.tier} of {v.tierCount}</Eyebrow>
            <p className="font-display text-display-m leading-none">{v.tierName}</p>
            <p className="mt-1 text-caption opacity-80">Nine ghosts, one you. Only study XP counts; ghosts are always labelled Ghost and never chat.</p>
          </div>
          <div className="text-end">
            <p className="text-caption font-extrabold uppercase opacity-70">Your rank</p>
            <p className="font-display text-display-l leading-none">#{v.rank}</p>
            <Chip tone={v.outcome === "promoted" ? "mint" : v.outcome === "demoted" ? "coral" : "surface"}>{v.outcome === "promoted" ? "Promotion zone" : v.outcome === "demoted" ? "Demotion zone" : "Safe zone"}</Chip>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Your study XP" value={v.myXp} tone="surface" />
          <StatTile label="Baseline (median)" value={v.baseline} tone="surface" hint="Ghost median · σ 0.25" />
        </div>
        <p className="text-caption opacity-80">Top {v.promote} promote · bottom {v.demote} demote. If your week is incomplete, the league still settles on Sunday night.</p>
      </Card>
      <Card className="flex flex-col gap-2">
        <Eyebrow>This week&apos;s board</Eyebrow>
        <ol className="flex flex-col gap-1">
          {v.board.map((r) => (
            <li key={`${r.name}-${r.rank}`} className={cx("flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-body-s", r.ghost ? "bg-surface-2" : "bg-yellow font-extrabold text-on-color")}>
              <span className="flex min-w-0 items-center gap-2">
                <b>{r.rank}</b>
                <span className="truncate" dir="auto">
                  {r.name}
                </span>
                {r.ghost ? <span className="text-caption opacity-60">Ghost</span> : <span className="text-caption opacity-70">You</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <b>{r.xp}</b>
                {r.zone !== "safe" && <span className={cx("h-2 w-2 rounded-full", r.zone === "promote" ? "bg-mint" : "bg-coral")} aria-label={r.zone} />}
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <Card className="flex flex-col gap-2 lg:col-span-3">
        <Eyebrow>Settled weeks</Eyebrow>
        {v.history.length === 0 ? (
          <p className="text-body-s text-muted">No week has settled yet. The league opens in week 2; week 1 is for observation.</p>
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {v.history.map((h) => (
              <li key={h.id} className="rounded-xl bg-surface-2 px-3 py-1.5 text-body-s">
                <b>Week {h.weekNo}</b> · tier {h.tier} · rank {h.result.rank} · {h.result.myXp} XP · <span className={h.result.outcome === "promoted" ? "text-mint-ink" : h.result.outcome === "demoted" ? "text-coral-ink" : "text-muted"}>{h.result.outcome}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── story + dispatches (#80) ────────────────────────────────

function StoryTab({ v, post }: { v: Story; post: Post }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card tone="purple" className="flex flex-col gap-2 lg:col-span-2">
        <Eyebrow>
          Week {v.weekNo} · Chapter {v.chapter.no} of {v.progress.of} · {v.chapter.title}
        </Eyebrow>
        <p className="whitespace-pre-line text-body font-bold" dir="auto">
          {v.chapter.start}
        </p>
        <div className="h-px bg-white/20" />
        <p className="whitespace-pre-line text-body-s opacity-90" dir="auto">
          {v.chapter.end}
        </p>
        <p className="text-caption opacity-70">End text appears when the chapter closes. Every word is editable below.</p>
      </Card>
      <div className="flex flex-col gap-3">
        {v.events.map((e, i) => (
          <Card key={i} tone={e.tone} className="flex flex-col gap-2">
            <Eyebrow>{e.kind === "rival" ? "Rival dispatch" : "Bonus objective"}</Eyebrow>
            <p className="font-display text-title-m uppercase leading-none">{e.title}</p>
            <p className="text-body-s font-bold" dir="auto">
              {e.text}
            </p>
          </Card>
        ))}
      </div>
      <Card className="flex flex-col gap-2 lg:col-span-3">
        <Eyebrow>Six chapters · start & end text</Eyebrow>
        <div className="grid gap-2 lg:grid-cols-2">
          {v.chapters.map((c) => (
            <ChapterEditor key={c.no} c={c} current={c.no === v.currentNo} overridden={v.overridden.includes(c.no)} post={post} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function ChapterEditor({ c, current, overridden, post }: { c: Story["chapters"][number]; current: boolean; overridden: boolean; post: Post }) {
  const [start, setStart] = useState(c.start);
  const [end, setEnd] = useState(c.end);
  const [open, setOpen] = useState(false);
  return (
    <details className={cx("rounded-2xl p-3", current ? "bg-yellow text-on-color" : "bg-surface-2")} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-body-s font-extrabold">
        Ch.{c.no} · {c.title} {current && "· now"} {overridden && <span className="text-caption opacity-70">· edited</span>}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <label>
          <span className="label">Start text</span>
          <textarea className="min-h-24 w-full rounded-2xl bg-surface-1 p-2 text-body-s font-bold text-ink outline-none" dir="auto" maxLength={1200} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span className="label">End text</span>
          <textarea className="min-h-24 w-full rounded-2xl bg-surface-1 p-2 text-body-s font-bold text-ink outline-none" dir="auto" maxLength={1200} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <button className="btn-ghost self-start py-1.5" onClick={() => post({ action: "story", chapterNo: c.no, startText: start, endText: end }, `Chapter ${c.no} saved`)}>
          Save chapter
        </button>
      </div>
    </details>
  );
}

// ── escape ledger (#82) ─────────────────────────────────────

function Escapes({ v }: { v: Escapes }) {
  const max = Math.max(1, ...v.series.map((s) => s.minutes));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card tone={v.sharePct > 10 || v.total > 180 ? "coral" : "mint"} className="flex flex-col gap-2 lg:col-span-2">
        <Eyebrow>Last 14 days · weekly escape series</Eyebrow>
        <p className="font-display text-display-m leading-none">{Math.round(v.total / 6) / 10} h</p>
        <p className="text-body-s font-bold">{v.warning}</p>
        <div className="flex h-36 items-end gap-1" role="img" aria-label="Escape minutes per day">
          {v.series.map((s) => (
            <div key={s.day} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-28 w-full items-end">
                <div className={cx("w-full rounded-md", s.minutes > max * 0.6 ? "bg-coral" : "bg-purple/70")} style={{ height: `${Math.max(3, Math.round((s.minutes / max) * 112))}px` }} title={`${s.day}: ${s.minutes} min`} />
              </div>
              <span className="text-caption text-muted">{s.day.slice(5)}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card className="flex flex-col gap-2">
        <Eyebrow>Numbers, not verdicts</Eyebrow>
        <StatTile label="Escape minutes" value={v.total} unit="min" tone="surface" />
        <StatTile label="Share of study" value={v.sharePct} unit="%" tone={v.sharePct > 10 ? "coral" : "mint"} />
        <StatTile label="Peak day" value={v.peakDay.slice(5)} tone="surface" />
        <p className="text-caption text-muted">No penalty is attached to this chart. One planned break beats five unplanned ones; the Idea Vault is where the rest belongs.</p>
      </Card>
    </div>
  );
}

// ── monthly theme (#84) ─────────────────────────────────────

function MonthlyTab({ v, today }: { v: Monthly; today: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card tone="yellow" className="flex flex-col gap-2 lg:col-span-2">
        <Eyebrow>{v.month} · monthly challenge</Eyebrow>
        <p className="font-display text-display-m uppercase leading-none">{v.theme.name}</p>
        <p className="text-body-s font-bold">{v.theme.story}</p>
        <p className="font-display text-display-l leading-none">
          {v.progress.value} <span className="font-body text-body-s font-extrabold opacity-70">/ {v.progress.target} {v.theme.unit}</span>
        </p>
        <ProgressBar value={v.progress.pct} tone="purple" label="Monthly challenge progress" track="dark" />
        <div className="flex flex-wrap items-center gap-2">
          {v.badge ? <Chip tone="purple">Badge earned · {v.badge.badge}</Chip> : <Chip tone="surface">Badge locked</Chip>}
          <Link href="/review?tab=monthly" className="btn bg-white text-on-color ms-auto">
            Monthly review <Icon name="arrow" size={16} />
          </Link>
        </div>
      </Card>
      <Card className="flex flex-col gap-2">
        <Eyebrow>Month metrics</Eyebrow>
        <StatTile label="Standard days" value={v.metrics.standardDays} tone="surface" />
        <StatTile label="Error analyses" value={v.metrics.errorAnalyses} tone="surface" />
        <StatTile label="Duels won" value={v.metrics.duelsWon} tone="surface" />
        <StatTile label="Builder minutes" value={v.metrics.builderMinutes} tone="surface" />
        <p className="text-caption text-muted">Today is {today}. The theme rotates every month; the badge exists only for the month it was earned.</p>
      </Card>
    </div>
  );
}
