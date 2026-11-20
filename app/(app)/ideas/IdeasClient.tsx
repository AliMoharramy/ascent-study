"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/ui/client";
import { Card, Chip, cx, EmptyState, Eyebrow } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";
import { Modal } from "@/ui/Modal";
import type { detourLedger, listIdeas } from "@/server/ideas";

type Idea = Awaited<ReturnType<typeof listIdeas>>[number];
type Ledger = Awaited<ReturnType<typeof detourLedger>>;
const KINDS = ["coding", "new_idea", "builder", "video", "social", "games", "news", "other"];

export function IdeasClient({ ideas, coreDone, ledger }: { ideas: Idea[]; coreDone: boolean; ledger: Ledger }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [friction, setFriction] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("30");
  async function post(body: Record<string, unknown>, ok?: string) {
    try {
      await apiFetch("/api/ideas", { body });
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message, "warn");
      return false;
    }
  }
  /** Detour Detector: a non-study session while Core is unfinished → friction screen with 3 choices (no hard lock). */
  function startBuilding(kind: string) {
    if (coreDone) return void post({ action: "detour", kind, choice: "continue", minutes: Number(minutes), reason: "Core done — free time" }, "Enjoy — Core is done");
    setFriction(kind);
  }
  async function choose(choice: "study_first" | "later" | "continue") {
    if (!friction) return;
    if (await post({ action: "detour", kind: friction, choice, minutes: choice === "continue" ? Number(minutes) : 0, reason: reason || null })) {
      setFriction(null);
      setReason("");
      if (choice === "study_first") router.push("/focus");
      else toast(choice === "later" ? "Noted — the idea stays parked" : "Logged as a detour — awareness, not punishment", "ok");
    }
  }
  const parked = ideas.filter((i) => i.status === "parked");
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-4">
        <form
          className="card flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await post({ action: "park", text, tags }, "Parked")) {
              setText("");
              setTags("");
            }
          }}
        >
          <input className="field flex-[2]" dir="auto" required minLength={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="New idea (≤ 30 s) — press N anywhere" aria-label="Idea" />
          <input className="field flex-1" dir="auto" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags" aria-label="Tags" />
          <button className="btn-accent">Park</button>
        </form>
        {ideas.length === 0 && <EmptyState icon="bulb" title="The Vault is empty">Ideas come at the worst moment. Park them here in one line and get back to Core.</EmptyState>}
        <ul className="flex flex-col gap-2">
          {ideas.map((i) => (
            <li key={i.id} className={cx("card flex flex-col gap-2 p-4", i.status !== "parked" && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex-1 font-extrabold" dir="auto">
                  {i.text}
                </p>
                <Chip tone={i.status === "chosen" ? "purple" : i.status === "built" ? "lime" : "surface"}>{i.status}</Chip>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-caption">
                {i.tags && <span className="text-muted">#{i.tags.split(/[,\s]+/).filter(Boolean).join(" #")}</span>}
                <span className="ms-auto">Value</span>
                {[1, 2, 3, 4, 5].map((v) => (
                  <button key={v} onClick={() => post({ action: "update", id: i.id, value: v })} aria-label={`Value ${v}`} className={cx("h-6 w-6 rounded-full font-bold", (i.value ?? 0) >= v ? "bg-yellow text-on-color" : "bg-surface-2")}>
                    {v}
                  </button>
                ))}
                <span>Effort</span>
                {(["S", "M", "L"] as const).map((e) => (
                  <button key={e} onClick={() => post({ action: "update", id: i.id, effort: e })} className={cx("h-6 w-6 rounded-full font-bold", i.effort === e ? "bg-purple text-white" : "bg-surface-2")}>
                    {e}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 text-caption">
                {i.status === "parked" && (
                  <button className="btn-ghost px-3 py-1" onClick={() => startBuilding("builder")}>
                    <Icon name="hammer" size={13} /> Work on it now
                  </button>
                )}
                {i.status === "parked" && (
                  <button className="underline" onClick={() => post({ action: "update", id: i.id, status: "chosen" }, "Chosen for Builder Hour")}>
                    Choose for Builder Hour
                  </button>
                )}
                {i.status === "chosen" && (
                  <button className="underline" onClick={() => post({ action: "update", id: i.id, status: "built" }, "Built!")}>
                    Mark built
                  </button>
                )}
                {i.status !== "dropped" && (
                  <button className="underline text-muted" onClick={() => post({ action: "update", id: i.id, status: "dropped" })}>
                    Drop
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-4">
        <Card tone={coreDone ? "lime" : "yellow"} className="flex flex-col gap-2">
          <Eyebrow>Builder Hour</Eyebrow>
          <p className="font-bold">{coreDone ? "Today's Core is done — free time is yours." : "Core first. Ideas wait in the Vault; Builder Hour opens at week's end (consistency ≥ 70 % and ≥ 4 Core days)."}</p>
          <p className="text-caption">Top idea by value/effort: {parked[0]?.text ?? "—"}</p>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.slice(0, 4).map((k) => (
              <button key={k} className="chip border border-on-color/40 py-1" onClick={() => startBuilding(k)}>
                Start {k.replace("_", " ")}
              </button>
            ))}
          </div>
        </Card>
        <Card className="flex flex-col gap-2">
          <Eyebrow>Detour Ledger · last 7 days</Eyebrow>
          <p className="font-display text-display-m leading-none">{ledger.totalMinutes} min</p>
          {ledger.topKinds.map((k) => (
            <p key={k.kind} className="text-body-s">
              {k.kind.replace("_", " ")}: <b>{k.minutes} min</b>
            </p>
          ))}
          <p className="text-caption text-muted">
            Friction screens: {ledger.prompted} · chose study first: {ledger.studyFirst}
          </p>
        </Card>
      </div>
      <Modal open={!!friction} onClose={() => setFriction(null)} title="Core isn't done yet">
        <div className="flex flex-col gap-3">
          <p className="text-body-s">You&apos;re about to start “{friction?.replace("_", " ")}”. No lock — just a choice, made consciously.</p>
          <button className="btn-accent justify-start" onClick={() => choose("study_first")} autoFocus>
            <Icon name="play" size={14} /> 25 minutes of study first
          </button>
          <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3">
            <input className="field py-1.5" dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why now? (one line)" aria-label="Reason" />
            <button className="btn-ghost justify-start" disabled={!reason.trim()} onClick={() => choose("later")}>
              Later — write why
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={() => choose("continue")}>
              Continue anyway (log the detour)
            </button>
            <input className="field w-20 py-1.5" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} aria-label="Planned minutes" />
            <span className="text-caption">min</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
