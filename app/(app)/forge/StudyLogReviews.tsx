"use client";

import { useEffect, useState } from "react";
import { addDaysIso } from "@/i18n/jalali";
import { apiFetch, isAmbiguousMutationOutcome, requestId } from "@/ui/client";
import { EmptyState, Eyebrow, cx } from "@/ui/components";
import { useFeedback } from "@/ui/feedback";
import { Icon } from "@/ui/icons";
import { useRouter } from "next/navigation";
import { createStableMutationAttempt, mutationAttemptBody, restoreMutationAttempt, type StableMutationAttempt } from "@/ui/studyLogMutation";
import { clearStudyLogRecoveryMarker, readStudyLogRecoveryMarkers, saveStudyLogRecoveryMarker, type RecoveryStorage } from "@/ui/studyLogState";

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

function recoveryStorage(): RecoveryStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function StudyLogReviews({ due, today }: { due: DueReview[]; today: string }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [newDueOn, setNewDueOn] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Record<string, StableMutationAttempt<Record<string, unknown>>>>({});
  const [error, setError] = useState("");
  const nextGameDay = addDaysIso(today, 1);

  useEffect(() => {
    const storage = recoveryStorage();
    const markers = storage ? readStudyLogRecoveryMarkers(storage).filter((marker) => marker.kind === "review") : [];
    if (!storage || markers.length === 0) return;
    let cancelled = false;
    setPendingActions((current) => {
      const next = { ...current };
      for (const marker of markers) {
        if (marker.kind !== "review") continue;
        const body = { action: marker.action, ...(marker.action === "snooze" ? { dueOn: marker.dueOn } : {}) };
        next[marker.reviewId] = restoreMutationAttempt(marker.clientRequestId, body);
      }
      return next;
    });
    void apiFetch<{ acceptedRequestIds: string[] }>(`/api/study-logs?requestIds=${encodeURIComponent(markers.map((marker) => marker.clientRequestId).join(","))}`)
      .then(async ({ acceptedRequestIds }) => {
        if (cancelled) return;
        for (const marker of markers) {
          if (marker.kind !== "review") continue;
          const body = {
            action: marker.action,
            ...(marker.action === "snooze" ? { dueOn: marker.dueOn } : {}),
          };
          if (acceptedRequestIds.includes(marker.clientRequestId)) {
            clearStudyLogRecoveryMarker(storage, marker.clientRequestId);
            setPendingActions((current) => { const next = { ...current }; delete next[marker.reviewId]; return next; });
            continue;
          }
          try {
            await apiFetch(`/api/study-log-reviews/${encodeURIComponent(marker.reviewId)}`, {
              body: { ...body, clientRequestId: marker.clientRequestId },
            });
            clearStudyLogRecoveryMarker(storage, marker.clientRequestId);
            setPendingActions((current) => { const next = { ...current }; delete next[marker.reviewId]; return next; });
            router.refresh();
          } catch (cause) {
            if (!isAmbiguousMutationOutcome(cause)) {
              clearStudyLogRecoveryMarker(storage, marker.clientRequestId);
              setPendingActions((current) => { const next = { ...current }; delete next[marker.reviewId]; return next; });
            }
            setError(isAmbiguousMutationOutcome(cause)
              ? "A previous review action is still unconfirmed. Retry keeps its saved request ID and action."
              : cause instanceof Error ? cause.message : "This review could not be recovered.");
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError("A previous review action is still unconfirmed. Its ID and action are kept in this tab until the server can reconcile it.");
      });
    return () => { cancelled = true; };
  }, [router]);

  async function sendAttempt(review: DueReview, attempt: StableMutationAttempt<Record<string, unknown>>) {
    setBusyId(review.id);
    setError("");
    try {
      await apiFetch(`/api/study-log-reviews/${encodeURIComponent(review.id)}`, { body: mutationAttemptBody(attempt) });
      const storage = recoveryStorage();
      if (storage) clearStudyLogRecoveryMarker(storage, attempt.clientRequestId);
      setPendingActions((current) => { const next = { ...current }; delete next[review.id]; return next; });
      const action = attempt.body.action as "complete" | "skip" | "cancel" | "snooze";
      toast(action === "complete" ? "Study review completed" : action === "snooze" ? "Study review rescheduled" : action === "skip" ? "Study review skipped" : "Study review canceled");
      router.refresh();
    } catch (cause) {
      const ambiguous = isAmbiguousMutationOutcome(cause);
      if (!ambiguous) {
        const storage = recoveryStorage();
        if (storage) clearStudyLogRecoveryMarker(storage, attempt.clientRequestId);
        setPendingActions((current) => { const next = { ...current }; delete next[review.id]; return next; });
      }
      setError(ambiguous
        ? "The server may have applied this review action, but the response was not confirmed. Retry delivery to safely replay the same action."
        : cause instanceof Error ? cause.message : "This review could not be updated.");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  function act(review: DueReview, action: "complete" | "skip" | "cancel" | "snooze") {
    if (pendingActions[review.id]) return;
    const payload = action === "snooze"
      ? { action, dueOn: newDueOn[review.id] ?? nextGameDay }
      : { action };
    const attempt = createStableMutationAttempt(null, payload, requestId);
    const storage = recoveryStorage();
    if (storage) saveStudyLogRecoveryMarker(storage, {
      kind: "review",
      clientRequestId: attempt.clientRequestId,
      reviewId: review.id,
      action,
      ...(action === "snooze" ? { dueOn: payload.dueOn as string } : {}),
    });
    setPendingActions((current) => ({ ...current, [review.id]: attempt }));
    void sendAttempt(review, attempt);
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
            const pending = pendingActions[review.id];
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

                {pending && (
                  <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-yellow/40 bg-yellow/10 p-3 text-caption text-muted">
                    <span>Action outcome is unconfirmed. The retry keeps the original action and request key.</span>
                    <button type="button" className="btn-ghost" disabled={busy} onClick={() => void sendAttempt(review, pending)}>Retry delivery</button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <button type="button" className="btn-accent" disabled={busy || !!pending} onClick={() => act(review, "complete")}>
                    <Icon name="check" size={15} /> {busy ? "Saving…" : "Complete"}
                  </button>
                  <label className="ms-auto flex min-w-44 flex-1 items-center gap-2 text-caption text-muted">
                    <span className="sr-only">Reschedule review date</span>
                    <input type="date" min={nextGameDay} value={newDueOn[review.id] ?? nextGameDay} onChange={(event) => setNewDueOn((current) => ({ ...current, [review.id]: event.target.value }))} className="field min-w-0 flex-1 py-1.5 font-mono text-caption" disabled={busy || !!pending} />
                    <button type="button" className="btn-ghost px-2 py-1.5" disabled={busy || !!pending} onClick={() => act(review, "snooze")}>
                      Move
                    </button>
                  </label>
                  <button type="button" className="btn-ghost px-2 py-1.5" title="Skip this checkpoint" disabled={busy || !!pending} onClick={() => act(review, "skip")}>Skip</button>
                  <button type="button" className="btn-ghost px-2 py-1.5 text-muted" title="Cancel this checkpoint" disabled={busy || !!pending} onClick={() => act(review, "cancel")}>Cancel</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
