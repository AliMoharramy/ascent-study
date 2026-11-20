"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, Eyebrow } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { MascotSlot } from "@/ui/Mascot";
import type { coachView } from "@/server/coach";

type V = Awaited<ReturnType<typeof coachView>>;

const CHIPS = [
  { label: "Quiz me", text: "Quiz me on what's due" },
  { label: "Review errors", text: "Help me review my errors" },
  { label: "Plan my week", text: "How is my plan for this week?" },
  { label: "Lighten my week", text: "This week is too heavy — lighten my plan" },
  { label: "Sleep check", text: "How is my sleep?" },
  { label: "Burnout check", text: "Am I heading for burnout?" },
];

/** ChatBubble (doc 12 §1.1): user = dark purple, Archie = mint. Suggestion chips; proposals need explicit approval. */
export function CoachChat({ data, mascots }: { data: V; mascots: boolean }) {
  const { toast } = useFeedback();
  const [v, setV] = useState(data);
  useEffect(() => {
    setV(data);
  }, [data]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [v.messages.length]);

  async function send(msg: string) {
    if (!msg.trim() || busy) return;
    setBusy(true);
    setText("");
    try {
      const r = await apiFetch<Pick<V, "messages" | "proposal">>("/api/coach", { body: { action: "message", text: msg } });
      setV((old) => ({ ...old, ...r }));
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }
  async function decide(action: "approve" | "reject") {
    if (!v.proposal || busy) return;
    setBusy(true);
    try {
      const r = await apiFetch<Pick<V, "messages" | "proposal">>("/api/coach", { body: { action, proposalId: v.proposal.id } });
      setV((old) => ({ ...old, ...r }));
      toast(action === "approve" ? "Plan updated — the moves are logged" : "Proposal rejected — plan unchanged");
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }

  const p = v.proposal;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <Card className="flex min-h-[420px] flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Chat · everything runs on your device</Eyebrow>
          <Chip tone={v.remoteReady ? "mint" : "surface"}>{v.remoteReady ? "AI assist on (numbers only)" : "Local coach"}</Chip>
        </div>
        <div className="flex max-h-[46vh] flex-1 flex-col gap-2 overflow-y-auto pe-1" aria-live="polite">
          {v.messages.length === 0 && (
            <div className="grid flex-1 place-items-center gap-2 py-6 text-center">
              <MascotSlot character="archie" state="reading" size="sm" enabled={mascots} />
              <p className="max-w-sm text-body-s text-muted">Ask Archie anything about your week — or tap a chip below. Plan changes are always drafted first and applied only when you approve.</p>
            </div>
          )}
          {v.messages.map((m) => (
            <div key={m.id} className={cx("max-w-[85%] whitespace-pre-wrap rounded-3xl px-4 py-2.5 text-body-s font-bold shadow-card", m.role === "user" ? "self-end rounded-ee-md bg-purple text-white" : "self-start rounded-es-md bg-mint text-on-color")} dir="auto">
              {m.text}
            </div>
          ))}
          {busy && <div className="self-start rounded-3xl rounded-es-md bg-mint px-4 py-2.5 text-body-s font-bold text-on-color opacity-70">Archie is thinking…</div>}
          <div ref={endRef} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map((c) => (
            <button key={c.label} className="chip border border-line bg-surface-2 text-ink hover:bg-surface-1" disabled={busy} onClick={() => send(c.text)}>
              {c.label}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <input className="field flex-1" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type to Archie… (English or فارسی)" aria-label="Message to Archie" dir="auto" />
          <button className="btn-primary" disabled={busy || !text.trim()}>Send</button>
        </form>
      </Card>
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-2">
          <Eyebrow>This week, in numbers</Eyebrow>
          <ul className="grid grid-cols-2 gap-1.5 text-body-s font-bold">
            <li className="rounded-xl bg-surface-2 px-3 py-2">Week {v.context.weekNo}</li>
            <li className="rounded-xl bg-surface-2 px-3 py-2">{v.context.weekHours} h logged</li>
            <li className="rounded-xl bg-surface-2 px-3 py-2">{v.context.planWeekHours} h planned</li>
            <li className="rounded-xl bg-surface-2 px-3 py-2">{v.context.consistencyPct}% consistent</li>
            <li className="rounded-xl bg-surface-2 px-3 py-2">{v.context.dueCards} cards due</li>
            <li className="rounded-xl bg-surface-2 px-3 py-2">Radar: {v.context.burnoutLevel}</li>
          </ul>
          <p className="text-caption text-muted">Only these aggregates ever reach a remote AI — your chat text never leaves the device.</p>
        </Card>
        {p && p.status === "pending" && (
          <Card tone="yellow" className="flex flex-col gap-2">
            <Eyebrow>Plan proposal · nothing moves until you approve</Eyebrow>
            <p className="text-body-s font-extrabold">
              Lighten week {p.proposal.weekNo}: {Math.round((p.proposal.beforeMin / 60) * 10) / 10} h → {Math.round((p.proposal.afterMin / 60) * 10) / 10} h
            </p>
            <ul className="grid gap-1 text-body-s">
              {p.proposal.changes.map((c) => (
                <li key={c.itemId} className="rounded-xl bg-surface-1/70 px-3 py-1.5 font-bold">
                  {c.chapterId} · {Math.round(c.minutes)} min → week {c.toWeek}
                </li>
              ))}
            </ul>
            <p className="text-caption">Core (M) items never move. Optional (C) first, then S.</p>
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy} onClick={() => decide("approve")}>Approve changes</button>
              <button className="btn-ghost" disabled={busy} onClick={() => decide("reject")}>Reject</button>
            </div>
          </Card>
        )}
        {p && p.status !== "pending" && (
          <Card className="flex flex-col gap-1">
            <Eyebrow>Last proposal</Eyebrow>
            <p className="text-body-s font-bold">{p.status === "approved" ? "Approved — the plan page reflects the moves." : "Rejected — the plan stayed untouched."}</p>
          </Card>
        )}
      </div>
    </div>
  );
}