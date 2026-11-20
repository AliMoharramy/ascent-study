"use client";

import { useState } from "react";
import { apiFetch, requestId } from "./client";
import { useFeedback } from "./feedback";
import { Modal } from "./Modal";
import { cx } from "./components";

/** Error analysis form (#39, F-ERR-01): cause (6) + lesson learned + chapter → XP 1.0 and a review card. */

export const CAUSES = [
  { id: "concept", label: "Concept gap" },
  { id: "calc", label: "Calculation" },
  { id: "time", label: "Ran out of time" },
  { id: "unread", label: "Didn't read carefully" },
  { id: "forgot", label: "Forgot it" },
  { id: "careless", label: "Careless" },
] as const;

export type ChapterOpt = { id: string; label: string };

export function ErrorLogDialog({ open, onClose, chapters, defaultChapter, testLogId, count = 1 }: { open: boolean; onClose: () => void; chapters: ChapterOpt[]; defaultChapter?: string | null; testLogId?: string | null; count?: number }) {
  const { toast } = useFeedback();
  const [cause, setCause] = useState<string>("concept");
  const [takeaway, setTakeaway] = useState("");
  const [chapterId, setChapterId] = useState(defaultChapter ?? "");
  const [sourceRef, setSourceRef] = useState("");
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/api/errors", { body: { cause, takeaway, chapterId: chapterId || null, sourceRef: sourceRef || null, testLogId: testLogId ?? null, clientRequestId: requestId() } });
      setDone((d) => d + 1);
      setTakeaway("");
      setSourceRef("");
      if (done + 1 >= count) {
        toast(`${done + 1} error(s) analysed — review cards created`);
        setDone(0);
        onClose();
      }
    } catch (err) {
      toast((err as Error).message, "warn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={count > 1 ? `Analyse error ${done + 1} of ${count}` : "Analyse an error"}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <fieldset>
          <legend className="label">Cause</legend>
          <div className="flex flex-wrap gap-2">
            {CAUSES.map((c) => (
              <button key={c.id} type="button" aria-pressed={cause === c.id} onClick={() => setCause(c.id)} className={cx("chip py-1.5 text-body-s", cause === c.id ? "bg-purple text-white" : "border border-line bg-surface-2 text-ink")}>
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          <span className="label">Lesson learned</span>
          <textarea className="field min-h-20" dir="auto" required minLength={3} maxLength={500} value={takeaway} onChange={(e) => setTakeaway(e.target.value)} placeholder="What will you do differently next time?" autoFocus />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="label">Chapter</span>
            <select className="field" value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
              <option value="">—</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Source (book/test no.)</span>
            <input className="field" dir="auto" value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} maxLength={120} placeholder="e.g. Parsa p.112 #7" />
          </label>
        </div>
        <button className="btn-accent self-start" disabled={busy}>
          Save analysis (+1 XP)
        </button>
      </form>
    </Modal>
  );
}
