"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, EmptyState, Eyebrow } from "@/ui/components";
import { CAUSES, ErrorLogDialog, type ChapterOpt } from "@/ui/ErrorLog";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";
import { ForgeInsights } from "./ForgeInsights";
import { StudyLogReviews } from "./StudyLogReviews";

type Err = { id: string; cause: string; takeaway: string; chapterId: string | null; subjectId: string | null; sourceRef: string | null; repeatedCount: number; gameDay: string };
type CardT = { id: string; front: string; back: string; dueOn: string; reps: number; step: number };
type StudyLogReviewT = { id: string; studyLogId: string; checkpoint: number; offsetDays: number; front: string; back: string; scheduledOn: string; dueOn: string; status: "pending" | "done" | "skipped" | "canceled"; topic: string };
type Art = { id: string; title: string; bodyMd: string; chapterId: string | null; kind: string; updatedAt: string };

export function ForgeClient(p: { tab: string; filters: { q: string; cause: string; subject: string }; errors: Err[]; causes: { cause: string; n: number }[]; due: CardT[]; studyLogDue: StudyLogReviewT[]; today: string; cards: number; artifacts: Art[]; subjects: { id: string; name: string }[]; chapters: ChapterOpt[]; reviewXpLeft: number; mining: Parameters<typeof ForgeInsights>[0]["mining"]; time: Parameters<typeof ForgeInsights>[0]["time"]; skip: Parameters<typeof ForgeInsights>[0]["skip"] }) {
  const router = useRouter();
  const [tab, setTab] = useState(p.tab);
  const [q, setQ] = useState(p.filters.q);
  const [newErr, setNewErr] = useState(false);
  const go = (patch: Record<string, string>) => {
    const u = new URLSearchParams({ tab, q, cause: p.filters.cause, subject: p.filters.subject, ...patch });
    for (const [k, v] of [...u.entries()]) if (!v) u.delete(k);
    router.push(`/forge?${u}`);
  };
  const label = (id: string | null) => p.chapters.find((c) => c.id === id)?.label ?? "—";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="tablist">
        {[
          ["errors", `Errors (${p.errors.length})`],
          ["review", `Review due (${p.due.length})`],
          ["artifacts", `Artifacts (${p.artifacts.length})`],
          ["coach", "Mistake coach"],
        ].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k!)} className={cx("chip px-4 py-2 text-body-s", tab === k ? "bg-purple text-white" : "border border-line bg-surface-1 text-ink")}>
            {l}
          </button>
        ))}
        <form
          className="ms-auto flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q });
          }}
        >
          <input className="field w-56 py-1.5" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search the Forge" />
          <button className="btn-ghost px-3 py-1.5" aria-label="Search">
            <Icon name="search" size={16} />
          </button>
        </form>
      </div>

      {tab === "errors" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-accent" onClick={() => setNewErr(true)}>
              <Icon name="plus" size={14} /> Analyse an error
            </button>
            <select className="field w-auto py-1.5" value={p.filters.cause} onChange={(e) => go({ cause: e.target.value })} aria-label="Filter by cause">
              <option value="">All causes</option>
              {CAUSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({p.causes.find((x) => x.cause === c.id)?.n ?? 0})
                </option>
              ))}
            </select>
            <select className="field w-auto py-1.5" value={p.filters.subject} onChange={(e) => go({ subject: e.target.value })} aria-label="Filter by subject">
              <option value="">All subjects</option>
              {p.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {p.causes.length > 0 && (
            <Card className="flex flex-wrap gap-3">
              {CAUSES.map((c) => {
                const n = p.causes.find((x) => x.cause === c.id)?.n ?? 0;
                const max = Math.max(1, ...p.causes.map((x) => x.n));
                return (
                  <div key={c.id} className="min-w-28 flex-1">
                    <p className="text-caption font-extrabold uppercase text-muted">{c.label}</p>
                    <div className="mt-1 h-2 rounded-pill bg-surface-2">
                      <div className="h-2 rounded-pill bg-coral" style={{ width: `${(n / max) * 100}%` }} />
                    </div>
                    <p className="text-body-s font-bold">{n}</p>
                  </div>
                );
              })}
            </Card>
          )}
          {p.errors.length === 0 ? (
            <EmptyState icon="target" title="No analysed errors yet">
              Analysing a wrong answer is worth more than a new test (1.0 vs 0.6 XP). Each one becomes a review card.
            </EmptyState>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {p.errors.map((e) => (
                <li key={e.id} className="card flex flex-col gap-1.5 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone="coral">{CAUSES.find((c) => c.id === e.cause)?.label ?? e.cause}</Chip>
                    {e.repeatedCount > 0 && <Chip tone="yellow">repeated ×{e.repeatedCount + 1}</Chip>}
                    <span className="ms-auto text-caption text-muted">{e.gameDay}</span>
                  </div>
                  <p className="font-bold" dir="auto">
                    {e.takeaway}
                  </p>
                  <p className="fa text-caption text-muted" dir="auto">
                    {label(e.chapterId)} {e.sourceRef && `· ${e.sourceRef}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <ErrorLogDialog open={newErr} onClose={() => setNewErr(false)} chapters={p.chapters} />
        </>
      )}

      {tab === "review" && (
        <>
          <StudyLogReviews due={p.studyLogDue} today={p.today} />
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-3xl bg-surface-2 p-4">
            <p className="text-body-s">Ten due or recent cards, five minutes, no new-test pressure.</p>
            <Link href="/deck" className="btn-accent">
              Open the five-minute deck
            </Link>
          </div>
          <ReviewQueue due={p.due} total={p.cards} xpLeft={p.reviewXpLeft} />
        </>
      )}
      {tab === "artifacts" && <Artifacts artifacts={p.artifacts} chapters={p.chapters} />}
      {tab === "coach" && <ForgeInsights mining={p.mining} time={p.time} skip={p.skip} />}
    </div>
  );
}

function ReviewQueue({ due, total, xpLeft }: { due: CardT[]; total: number; xpLeft: number }) {
  const { toast } = useFeedback();
  const [i, setI] = useState(0);
  const [show, setShow] = useState(false);
  const c = due[i];
  async function answer(a: "again" | "hard" | "good") {
    if (!c) return;
    try {
      await apiFetch("/api/review", { body: { action: "answer", cardId: c.id, answer: a } });
      setShow(false);
      setI((x) => x + 1);
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        setShow(true);
      }
      if (show && e.key === "1") void answer("again");
      if (show && e.key === "2") void answer("hard");
      if (show && e.key === "3") void answer("good");
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  if (!c)
    return (
      <EmptyState icon="check" title="Queue clear">
        {total} cards in the deck. Intervals: 1 · 3 · 7 · 14 · 30 days.
      </EmptyState>
    );
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <p className="text-caption font-extrabold uppercase text-muted">
        Card {i + 1} of {due.length} · {xpLeft > 0 ? `${xpLeft} review XP left today` : "daily review XP cap reached (keep going for memory!)"}
      </p>
      <Card tone="mint" className="flex min-h-48 flex-col gap-4">
        <p className="text-title-m font-extrabold" dir="auto">
          {c.front}
        </p>
        {show ? (
          <p className="rounded-2xl bg-on-color/10 p-3 text-body font-bold" dir="auto">
            {c.back}
          </p>
        ) : (
          <button className="btn-primary self-start" onClick={() => setShow(true)}>
            Show answer <kbd className="rounded bg-white/15 px-1.5 text-caption">Space</kbd>
          </button>
        )}
      </Card>
      {show && (
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={() => answer("again")}>
            Again <kbd className="text-caption">1</kbd>
          </button>
          <button className="btn-ghost flex-1" onClick={() => answer("hard")}>
            Hard <kbd className="text-caption">2</kbd>
          </button>
          <button className="btn-accent flex-1" onClick={() => answer("good")}>
            Good <kbd className="text-caption">3</kbd>
          </button>
        </div>
      )}
    </div>
  );
}

function Artifacts({ artifacts, chapters }: { artifacts: Art[]; chapters: ChapterOpt[] }) {
  const { toast } = useFeedback();
  const [edit, setEdit] = useState<{ id?: string; title: string; bodyMd: string; chapterId: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    try {
      await apiFetch("/api/review", { body: { action: "artifact", ...edit, chapterId: edit.chapterId || null } });
      toast(edit.id ? "Saved" : "Artifact forged (+8 XP)");
      setEdit(null);
    } catch (err) {
      toast((err as Error).message, "warn");
    }
  }
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
      <div className="flex flex-col gap-2">
        <button className="btn-accent self-start" onClick={() => setEdit({ title: "", bodyMd: "", chapterId: "" })}>
          <Icon name="hammer" size={14} /> Forge a new artifact
        </button>
        <Link href="/sheets" className="btn-ghost self-start">
          <Icon name="download" size={14} /> Build printable cheat-sheets
        </Link>
        {artifacts.length === 0 && <EmptyState icon="hammer" title="No artifacts yet">A one-page chapter sheet, a formula list, a “lesson learned” line.</EmptyState>}
        {artifacts.map((a) => (
          <button key={a.id} onClick={() => setEdit({ id: a.id, title: a.title, bodyMd: a.bodyMd, chapterId: a.chapterId ?? "" })} className="card p-4 text-start hover:ring-2 hover:ring-purple">
            <p className="font-extrabold">{a.title}</p>
            <p className="line-clamp-2 text-caption text-muted" dir="auto">
              {a.bodyMd}
            </p>
          </button>
        ))}
      </div>
      {edit && (
        <form onSubmit={save} className="card flex flex-col gap-3">
          <Eyebrow>{edit.id ? "Edit artifact" : "New artifact (Markdown)"}</Eyebrow>
          <input className="field" dir="auto" required minLength={2} placeholder="Title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <select className="field" value={edit.chapterId} onChange={(e) => setEdit({ ...edit, chapterId: e.target.value })} aria-label="Chapter">
            <option value="">No chapter</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <textarea className="field min-h-72 font-mono text-body-s" dir="auto" value={edit.bodyMd} onChange={(e) => setEdit({ ...edit, bodyMd: e.target.value })} placeholder={"# Chapter sheet\n- key idea…\n- trap to avoid…"} />
          <div className="flex gap-2">
            <button className="btn-accent">Save</button>
            <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
