"use client";

import { useState } from "react";
import { addDaysIso } from "@/i18n/jalali";
import { apiFetch } from "@/ui/client";
import { EmptyState, Eyebrow, cx } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";
import { useRouter } from "next/navigation";

type DueReview = {
  id: string;
  studyLogId: string;
  checkpoint: number;
  offsetDays: number;
  front: string;
  back: string;
  scheduledOn: string;
  dueOn: string;
  status: "pending" | "done" | "skipped" | "canceled";
  topic: string;
};

export function StudyLogReviews({ due, today }: { due: DueReview[]; today: string }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [newDueOn, setNewDueOn] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const nextGameDay = addDaysIso(today, 1);

  async function act(review: DueReview, action: "complete" | "skip" | "cancel" | "snooze") {
    setBusyId(review.id);
    setError("");
    try {
      await apiFetch(`/api/study-log-reviews/${encodeURIComponent(review.id)}`, {
        body: action === "snooze" ? { action, dueOn: newDueOn[review.id] ?? nextGameDay } : { action },
      });
      toast(action === "complete" ? "Study review completed" : action === "snooze" ? "Study review rescheduled" : action === "skip" ? "Study review skipped" : "Study review canceled");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This review could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="study-log-reviews-heading" className="rounded-card border border-mint/40 bg-surface-1 p-4 shadow-card md:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow className="text-mint-ink">Your source · fixed dates</Eyebrow>
          <h3 id="study-log-reviews-heading" className="mt-1 font-display text-title-l uppercase">Study-log reviews</h3>
        </div>
        <span className="rounded-full bg-mint/15 px-3 py-1 font-mono text-caption font-bold text-mint-ink">{due.length} due</span>
      </div>

      {error && <p role="alert" className="mb-3 rounded-xl bg-coral/10 px-3 py-2 text-body-s font-bold text-coral-ink">{error}</p>}
      {due.length === 0 ? (
        <EmptyState icon="check" title="No study-log reviews due">The four-date recall path appears here on its scheduled game days, independent of focus sessions and reminders.</EmptyState>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {due.map((review) => {
            const overdue = review.dueOn < today;
            const busy = busyId === review.id;
            return (
              <li key={review.id} className="flex flex-col gap-3 rounded-3xl bg-surface-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-surface-1 px-3 py-1 text-caption font-bold text-muted">Checkpoint {review.checkpoint} · +{review.offsetDays} days</span>
                  <span className={cx("ms-auto rounded-full px-3 py-1 text-caption font-extrabold", overdue ? "bg-coral/15 text-coral-ink" : "bg-yellow/15 text-yellow-ink")}>
                    {overdue ? "Overdue" : "Due today"}
                  </span>
                </div>

                <div>
                  <p className="text-caption font-bold uppercase tracking-wide text-muted" dir="auto">{review.topic}</p>
                  <p className="mt-1 text-title-m font-extrabold" dir="auto">{review.front}</p>
                </div>

                {revealed[review.id] ? (
                  <div className="rounded-2xl border border-mint/30 bg-surface-1 p-3">
                    <Eyebrow className="text-mint-ink">Your answer</Eyebrow>
                    <p className="mt-1 text-body-s leading-relaxed" dir="auto">{review.back}</p>
                  </div>
                ) : (
                  <button type="button" onClick={() => setRevealed((current) => ({ ...current, [review.id]: true }))} className="flex w-fit items-center gap-2 rounded-full border border-line px-3 py-1.5 text-body-s font-bold hover:bg-surface-1 focus-visible:outline-none">
                    <Icon name="book" size={15} /> Reveal answer
                  </button>
                )}

                <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line pt-3 text-caption text-muted sm:grid-cols-3">
                  <p>Original <span className="font-mono font-bold text-ink">{review.scheduledOn}</span></p>
                  <p>Current due <span className="font-mono font-bold text-ink">{review.dueOn}</span></p>
                  <p>Status <span className="font-bold text-ink">Pending</span></p>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <button type="button" className="btn-accent" disabled={busy} onClick={() => void act(review, "complete")}>
                    <Icon name="check" size={15} /> {busy ? "Saving…" : "Complete"}
                  </button>
                  <label className="ms-auto flex min-w-44 flex-1 items-center gap-2 text-caption text-muted">
                    <span className="sr-only">Reschedule review date</span>
                    <input type="date" min={nextGameDay} value={newDueOn[review.id] ?? nextGameDay} onChange={(event) => setNewDueOn((current) => ({ ...current, [review.id]: event.target.value }))} className="field min-w-0 flex-1 py-1.5 font-mono text-caption" />
                    <button type="button" className="btn-ghost px-2 py-1.5" disabled={busy} onClick={() => void act(review, "snooze")}>
                      Move
                    </button>
                  </label>
                  <button type="button" className="btn-ghost px-2 py-1.5" title="Skip this checkpoint" disabled={busy} onClick={() => void act(review, "skip")}>Skip</button>
                  <button type="button" className="btn-ghost px-2 py-1.5 text-muted" title="Cancel this checkpoint" disabled={busy} onClick={() => void act(review, "cancel")}>Cancel</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
