"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { STUDY_LOG_ANALYSIS_LEASE_MS } from "@/domain/studyLog";
import { apiFetch, isAmbiguousMutationOutcome, requestId } from "@/ui/client";
import { Chip, EmptyState, Eyebrow, cx } from "@/ui/components";
import { Icon } from "@/ui/icons";
import { createStableMutationAttempt, mutationAttemptBody, type StableMutationAttempt } from "@/ui/studyLogMutation";

type LogStatus = "pending" | "processing" | "retryable" | "needs_material" | "no_sequence" | "scheduled";
type ReviewStatus = "pending" | "done" | "skipped" | "canceled";
type Review = { id: string; checkpoint: number; offsetDays: number; front: string; back: string; scheduledOn: string; dueOn: string; status: ReviewStatus; doneOn: string | null };
type SummaryReview = Pick<Review, "id" | "checkpoint" | "offsetDays" | "scheduledOn" | "dueOn" | "status">;
type Log = { id: string; userId: string; clientRequestId: string; topic: string; courseId: string | null; lessonId: string | null; chapterId: string | null; studiedOn: string; sourceText: string; status: LogStatus; decision: "schedule" | "no_sequence" | "needs_material" | null; reason: string; analysisStartedAt: string | null; createdAt: string; updatedAt: string };
type Bundle = { log: Log; reviews: Review[] };
type Summary = Pick<Log, "id" | "clientRequestId" | "topic" | "courseId" | "lessonId" | "chapterId" | "studiedOn" | "status" | "decision" | "reason" | "analysisStartedAt" | "createdAt"> & { reviews: SummaryReview[] };
type Course = { id: string; title: string; subjectId: string };
type Lesson = { id: string; title: string; courseId: string; chapterIds: string[] };
type Chapter = { id: string; no: number; title: string; subjectId: string };

const offsets = [3, 7, 14, 30];
const checkpointNames = ["first recall", "reinforce", "consolidate", "retain"];
const statusPresentation: Record<LogStatus, {
  label: string;
  tone: "yellow" | "mint" | "coral" | "purple" | "lime";
  dotClass: string;
  createNotice: string;
  retryNotice: string;
}> = {
  pending: { label: "Saved", tone: "purple", dotClass: "bg-purple", createNotice: "Saved. Review planning is still in progress.", retryNotice: "Review planning is still in progress." },
  processing: { label: "Analyzing", tone: "purple", dotClass: "bg-purple", createNotice: "Saved. Review planning is still in progress.", retryNotice: "Review planning is still in progress." },
  retryable: { label: "Retry available", tone: "coral", dotClass: "bg-coral", createNotice: "Saved. The review plan could not be verified; edit the notes and retry.", retryNotice: "Review planning is unavailable. You can edit the notes and retry again." },
  needs_material: { label: "Needs more notes", tone: "yellow", dotClass: "bg-yellow", createNotice: "Saved. Add more notes whenever you are ready to try again.", retryNotice: "More notes are needed before useful questions can be made." },
  no_sequence: { label: "No sequence", tone: "mint", dotClass: "bg-purple", createNotice: "Saved. The notes do not need a fixed review sequence.", retryNotice: "The notes are saved without a fixed sequence." },
  scheduled: { label: "Reviews scheduled", tone: "lime", dotClass: "bg-lime", createNotice: "Four reviews are set from the material you shared.", retryNotice: "Four new review dates are ready." },
};

export function StudyLogClient(p: { today: string; courses: Course[]; lessons: Lesson[]; chapters: Chapter[]; recent: Summary[]; nextCursor: string | null }) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [consentToRemoteAi, setConsentToRemoteAi] = useState(false);
  const [studiedOn, setStudiedOn] = useState(p.today);
  const [courseId, setCourseId] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<StableMutationAttempt<Record<string, unknown>> | null>(null);
  const [pendingRetries, setPendingRetries] = useState<Record<string, StableMutationAttempt<Record<string, unknown>>>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [olderItems, setOlderItems] = useState<Summary[]>([]);
  const [nextCursor, setNextCursor] = useState(p.nextCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Bundle>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [detailError, setDetailError] = useState("");
  const [retrySource, setRetrySource] = useState<Record<string, string>>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState("");
  const [leaseClock, setLeaseClock] = useState(() => Date.now());

  const recent = useMemo(() => [...p.recent, ...olderItems.filter((item) => !p.recent.some((current) => current.id === item.id))], [olderItems, p.recent]);
  useEffect(() => {
    setOlderItems([]);
    setNextCursor(p.nextCursor);
  }, [p.nextCursor, p.recent]);
  useEffect(() => {
    const retryAt = recent
      .filter((item) => item.status === "processing" && item.analysisStartedAt)
      .map((item) => new Date(item.analysisStartedAt!).getTime() + STUDY_LOG_ANALYSIS_LEASE_MS)
      .filter((at) => Number.isFinite(at) && at > Date.now())
      .sort((a, b) => a - b)[0];
    if (!retryAt) return;
    const timer = setTimeout(() => {
      setLeaseClock(Date.now());
      if (selectedId && details[selectedId]?.log.status === "processing") {
        void apiFetch<Bundle>(`/api/study-logs/${encodeURIComponent(selectedId)}`)
          .then((result) => setDetails((current) => ({ ...current, [selectedId]: result })))
          .catch(() => router.refresh());
      }
    }, Math.min(retryAt - Date.now() + 25, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [leaseClock, recent, selectedId, details, router]);
  const selectedCourse = p.courses.find((course) => course.id === courseId);
  const selectedLesson = p.lessons.find((lesson) => lesson.id === lessonId);
  const availableLessons = p.lessons.filter((lesson) => !courseId || lesson.courseId === courseId);
  const availableChapters = p.chapters.filter((chapter) => {
    if (selectedLesson) return selectedLesson.chapterIds.includes(chapter.id);
    if (selectedCourse) return chapter.subjectId === selectedCourse.subjectId;
    return !courseId;
  });

  async function createLog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const payload = {
      topic,
      sourceText,
      studiedOn,
      ...(courseId ? { courseId } : {}),
      ...(lessonId ? { lessonId } : {}),
      ...(chapterId ? { chapterId } : {}),
      consentToRemoteAi: true,
    };
    const attempt = createStableMutationAttempt(pendingSubmission, payload, requestId);
    setPendingSubmission(attempt);
    try {
      const result = await apiFetch<Bundle>("/api/study-logs", {
        body: mutationAttemptBody(attempt),
      });
      setPendingSubmission(null);
      setDetails((current) => ({ ...current, [result.log.id]: result }));
      setSelectedId(result.log.id);
      setNotice(statusPresentation[result.log.status].createNotice);
      setTopic("");
      setSourceText("");
      setConsentToRemoteAi(false);
      setStudiedOn(p.today);
      setCourseId("");
      setLessonId("");
      setChapterId("");
      router.refresh();
    } catch (cause) {
      const ambiguous = isAmbiguousMutationOutcome(cause);
      if (!ambiguous) setPendingSubmission(null);
      setError(ambiguous
        ? "The connection ended before the save was confirmed. The server may already have saved it; submit again to replay this same request safely."
        : cause instanceof Error ? cause.message : "Study log could not be saved.");
      if (ambiguous) {
        try {
          const page = await apiFetch<{ studyLogs: Summary[] }>("/api/study-logs?limit=50");
          const saved = page.studyLogs.find((item) => item.clientRequestId === attempt.clientRequestId);
          if (saved) {
            const fresh = await apiFetch<Bundle>(`/api/study-logs/${encodeURIComponent(saved.id)}`);
            setDetails((current) => ({ ...current, [fresh.log.id]: fresh }));
            setSelectedId(fresh.log.id);
            setRetrySource((current) => ({ ...current, [fresh.log.id]: fresh.log.sourceText }));
            setPendingSubmission(null);
            setError("");
            setNotice(statusPresentation[fresh.log.status].createNotice);
            setTopic("");
            setSourceText("");
            setConsentToRemoteAi(false);
            setStudiedOn(p.today);
            setCourseId("");
            setLessonId("");
            setChapterId("");
          }
        } catch {
          // Keep the original attempt available for an idempotent retry when reconciliation is also offline.
        }
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleDetails(id: string) {
    setDetailError("");
    setHistoryNotice("");
    if (selectedId === id) {
      setSelectedId(null);
      return;
    }
    setSelectedId(id);
    setDetailLoading(id);
    try {
      const result = await apiFetch<Bundle>(`/api/study-logs/${encodeURIComponent(id)}`);
      setDetails((current) => ({ ...current, [id]: result }));
      setRetrySource((current) => ({ ...current, [id]: result.log.sourceText }));
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : "This study log could not be loaded.");
    } finally {
      setDetailLoading(null);
    }
  }

  async function retry(id: string) {
    const source = retrySource[id] ?? details[id]?.log.sourceText ?? "";
    const attempt = createStableMutationAttempt(pendingRetries[id] ?? null, { sourceText: source, consentToRemoteAi: true }, requestId);
    setPendingRetries((current) => ({ ...current, [id]: attempt }));
    setRetryingId(id);
    setDetailError("");
    setHistoryNotice("");
    try {
      const result = await apiFetch<Bundle>(`/api/study-logs/${encodeURIComponent(id)}/retry`, {
        body: mutationAttemptBody(attempt),
      });
      setPendingRetries((current) => { const next = { ...current }; delete next[id]; return next; });
      setDetails((current) => ({ ...current, [id]: result }));
      setRetrySource((current) => ({ ...current, [id]: result.log.sourceText }));
      setHistoryNotice(statusPresentation[result.log.status].retryNotice);
      router.refresh();
    } catch (cause) {
      const ambiguous = isAmbiguousMutationOutcome(cause);
      if (!ambiguous) setPendingRetries((current) => { const next = { ...current }; delete next[id]; return next; });
      setDetailError(ambiguous
        ? "The server may have accepted this analysis retry, but its result was not confirmed. Retry delivery to replay the same notes and request key."
        : cause instanceof Error ? cause.message : "The review plan could not be retried.");
      void apiFetch<Bundle>(`/api/study-logs/${encodeURIComponent(id)}`).then((fresh) => setDetails((current) => ({ ...current, [id]: fresh }))).catch(() => router.refresh());
    } finally {
      setRetryingId(null);
    }
  }

  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setDetailError("");
    try {
      const page = await apiFetch<{ studyLogs: Summary[]; nextCursor: string | null }>(`/api/study-logs?cursor=${encodeURIComponent(nextCursor)}`);
      setOlderItems((current) => [...current, ...page.studyLogs.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : "Older study logs could not be loaded.");
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      <header className="grid gap-5 rounded-card border border-line bg-surface-1 p-5 shadow-card md:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)] md:items-end md:p-7">
        <div>
          <Eyebrow className="text-mint-ink">Field notes · spaced recall</Eyebrow>
          <h1 className="mt-2 font-display text-display-m uppercase leading-[0.92] tracking-wide md:text-display-l">Study log</h1>
          <p className="mt-3 max-w-2xl text-body-s text-muted">Keep what you learned in your own words. We’ll turn only those notes into a review path you can inspect and change.</p>
        </div>
        <div aria-label="Review spacing: 3, 7, 14 and 30 days after study" className="rounded-3xl bg-surface-2 px-4 py-4 md:px-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Eyebrow>Recall path</Eyebrow>
            <span className="font-mono text-caption text-muted">FROM STUDY DAY</span>
          </div>
          <div className="grid grid-cols-4">
            {offsets.map((offset, index) => (
              <div key={offset} className="relative flex flex-col items-center gap-1 text-center">
                <span aria-hidden="true" className={cx("absolute start-0 top-[7px] h-px w-full", index === 0 ? "bg-transparent" : "bg-line")} />
                <span className="relative z-10 grid h-4 w-4 place-items-center rounded-full border-2 border-yellow bg-surface-2 shadow-[0_0_0_3px_rgb(var(--surface-2))]">
                  <span className="h-1 w-1 rounded-full bg-yellow" />
                </span>
                <span className="mt-1 font-mono text-body-s font-bold text-yellow-ink">+{String(offset).padStart(2, "0")}</span>
                <span className="text-caption text-muted">{checkpointNames[index]}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
        <section aria-labelledby="capture-heading" className="rounded-card bg-surface-1 p-5 shadow-card md:p-6">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <Eyebrow className="text-purple-ink">Capture a session</Eyebrow>
              <h2 id="capture-heading" className="mt-1 font-display text-title-l uppercase">What did you study?</h2>
            </div>
            <span className="hidden rounded-full border border-line bg-surface-2 p-2 text-yellow-ink sm:grid" aria-hidden="true"><Icon name="book" size={19} /></span>
          </div>

          <form onSubmit={createLog} className="flex flex-col gap-4">
            <fieldset disabled={!!pendingSubmission} className="contents">
            <label className="block">
              <span className="label">Topic</span>
              <input className="field" required minLength={2} maxLength={160} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. Breadth-first search" />
            </label>

            <label className="block">
              <span className="label">Your notes or transcript</span>
              <textarea className="field min-h-56 resize-y leading-relaxed" required minLength={1} maxLength={20_000} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste the notes you want to remember…" dir="auto" />
              <span className="mt-1 block text-end font-mono text-caption text-muted">{sourceText.length.toLocaleString()} / 20,000</span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Course <span className="font-normal text-muted">· optional</span></span>
                <select className="field" value={courseId} onChange={(event) => { setCourseId(event.target.value); setLessonId(""); setChapterId(""); }}>
                  <option value="">No course</option>
                  {p.courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Lesson / video <span className="font-normal text-muted">· optional</span></span>
                <select className="field" value={lessonId} onChange={(event) => { setLessonId(event.target.value); setChapterId(""); }}>
                  <option value="">No lesson</option>
                  {availableLessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Chapter <span className="font-normal text-muted">· optional</span></span>
                <select className="field" value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
                  <option value="">No chapter</option>
                  {availableChapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.subjectId.toUpperCase()} {chapter.no} · {chapter.title}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Study day</span>
                <input className="field font-mono" type="date" required value={studiedOn} onChange={(event) => setStudiedOn(event.target.value)} />
                <span className="mt-1 block text-caption text-muted">Defaults to your current game day: {p.today}</span>
              </label>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-yellow/40 bg-yellow/10 p-3 text-body-s text-muted">
              <input className="mt-1 accent-yellow" type="checkbox" required checked={consentToRemoteAi} onChange={(event) => setConsentToRemoteAi(event.target.checked)} />
              <span>If AI review planning is enabled, your topic and notes or transcript will be sent to this app’s configured AI provider. Course, lesson, and chapter links stay in your account. Agree before submitting to request a review plan.</span>
            </label>

            {error && <p role="alert" className="rounded-2xl border border-coral/50 bg-coral/10 px-4 py-3 text-body-s font-bold text-coral-ink">{error}</p>}
            {notice && <p role="status" className="rounded-2xl border border-mint/40 bg-mint/10 px-4 py-3 text-body-s font-bold text-mint-ink">{notice}</p>}
            {pendingSubmission && <p role="status" className="rounded-2xl border border-yellow/40 bg-yellow/10 px-4 py-3 text-body-s text-muted">Delivery is unconfirmed. The form is locked so retrying keeps the original study details and request key.</p>}
            </fieldset>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="max-w-md text-caption text-muted">Questions are saved only when all four can be grounded in your notes.</p>
              <button className="btn-accent min-w-40 justify-center" disabled={busy || topic.trim().length < 2 || !sourceText.trim() || !consentToRemoteAi}>
                <Icon name={busy ? "clock" : "arrow"} size={16} /> {busy ? "Building review path…" : pendingSubmission ? "Retry same submission" : "Save study log"}
              </button>
            </div>
          </form>
        </section>

        <section aria-labelledby="history-heading" className="rounded-card border border-line bg-surface-1 p-5 shadow-card md:p-6">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <Eyebrow className="text-yellow-ink">Your notebook</Eyebrow>
              <h2 id="history-heading" className="mt-1 font-display text-title-l uppercase">Recent sessions</h2>
            </div>
            <span className="font-mono text-caption text-muted">{recent.length} loaded</span>
          </div>

          {recent.length === 0 ? (
            <EmptyState icon="book" title="Your first note starts here">A session appears here after you save notes. Open it to inspect the source and any review dates.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {recent.map((item) => (
                <li key={item.id} className="overflow-hidden rounded-2xl border border-line bg-surface-2">
                  <button type="button" aria-expanded={selectedId === item.id} onClick={() => void toggleDetails(item.id)} className="group flex w-full items-start gap-3 p-4 text-start transition-colors hover:bg-surface-1 focus-visible:outline-none motion-reduce:transition-none">
                    <span aria-hidden="true" className={cx("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", statusPresentation[item.status].dotClass)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-extrabold" dir="auto">{item.topic}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                        <span className="font-mono">{item.studiedOn}</span>
                        <span aria-hidden="true">·</span>
                        <span>{statusPresentation[item.status].label}</span>
                        {item.reviews.length > 0 && <><span aria-hidden="true">·</span><span>{item.reviews.filter((review) => review.status === "pending").length} pending</span></>}
                      </span>
                    </span>
                    <Icon name="arrow" className={cx("transition-transform motion-reduce:transition-none", selectedId === item.id && "rotate-90")} size={16} />
                  </button>

                  {selectedId === item.id && (
                    <div className="border-t border-line p-4">
                      {detailLoading === item.id && <p role="status" className="text-body-s text-muted">Opening notes…</p>}
                      {detailError && <p role="alert" className="mb-3 text-body-s font-bold text-coral-ink">{detailError}</p>}
                      {details[item.id] && <LogDetail
                        bundle={details[item.id]!}
                        retrySource={retrySource[item.id] ?? details[item.id]!.log.sourceText}
                        onSourceChange={(value) => setRetrySource((current) => ({ ...current, [item.id]: value }))}
                        retryPending={!!pendingRetries[item.id]}
                        key={item.id}
                        onRetry={() => retry(item.id)}
                        retrying={retryingId === item.id}
                      />}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {nextCursor && <button type="button" className="btn-ghost mt-3 w-full justify-center" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Loading…" : "Load older sessions"}</button>}
          {historyNotice && <p role="status" className="mt-3 rounded-2xl bg-mint/10 px-4 py-3 text-body-s font-bold text-mint-ink">{historyNotice}</p>}
          <p className="mt-4 border-t border-line pt-3 text-caption text-muted">Due reviews live in Forge, separate from focus sessions.</p>
        </section>
      </div>
    </div>
  );
}

function LogDetail(p: { bundle: Bundle; retrySource: string; onSourceChange: (value: string) => void; retryPending: boolean; onRetry: () => Promise<void>; retrying: boolean }) {
  const { log, reviews } = p.bundle;
  const leaseExpired = !log.analysisStartedAt || !Number.isFinite(Date.parse(log.analysisStartedAt)) || Date.now() - Date.parse(log.analysisStartedAt) >= STUDY_LOG_ANALYSIS_LEASE_MS;
  const canRetry = log.status === "retryable" || log.status === "needs_material" || (log.status === "processing" && leaseExpired);
  const [retryConsent, setRetryConsent] = useState(false);

  async function retryWithConsent() {
    try {
      await p.onRetry();
    } finally {
      setRetryConsent(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={statusPresentation[log.status].tone}>{statusPresentation[log.status].label}</Chip>
        {log.decision === "schedule" && <span className="text-caption text-muted">4 fixed checkpoints</span>}
      </div>
      {log.reason && <p className="text-body-s text-muted">{log.reason}</p>}
      {log.status === "processing" && !canRetry && <p role="status" className="text-caption text-muted">An analysis attempt is still active. Retry becomes available after its five-minute lease expires.</p>}

      {reviews.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Scheduled review dates">
          {reviews.map((review) => (
            <div key={review.id} className="rounded-xl border border-line bg-surface-1 p-3">
              <span className="font-mono text-caption font-bold text-yellow-ink">+{String(review.offsetDays).padStart(2, "0")} days</span>
              <span className="mt-1 block font-mono text-caption">{review.scheduledOn}</span>
              {review.dueOn !== review.scheduledOn && <span className="mt-1 block text-caption text-purple-ink">Moved to {review.dueOn}</span>}
              <span className="mt-1 block text-caption text-muted">{review.status === "done" ? `Completed ${review.doneOn}` : review.status}</span>
            </div>
          ))}
        </div>
      )}

      <details className="rounded-xl border border-line bg-surface-1">
        <summary className="cursor-pointer px-3 py-2 text-body-s font-bold focus-visible:outline-none">Show saved source</summary>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-line px-3 py-3 font-body text-body-s leading-relaxed" dir="auto">{log.sourceText}</pre>
      </details>

      {canRetry && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <label className="block">
            <span className="label">Edit notes and try again</span>
            <textarea className="field min-h-32 resize-y leading-relaxed" maxLength={20_000} disabled={p.retryPending} value={p.retrySource} onChange={(event) => p.onSourceChange(event.target.value)} dir="auto" />
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-yellow/40 bg-yellow/10 p-3 text-body-s text-muted">
            <input className="mt-1 accent-yellow" type="checkbox" required disabled={p.retryPending} checked={retryConsent} onChange={(event) => setRetryConsent(event.target.checked)} />
            <span>Submitting this retry sends the edited notes or transcript to this app’s configured AI provider if AI review planning is enabled.</span>
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-caption text-muted">{p.retrySource.length.toLocaleString()} / 20,000</span>
            <button type="button" className="btn-accent" disabled={p.retrying || (!p.retryPending && (!p.retrySource.trim() || !retryConsent))} onClick={() => void retryWithConsent()}>
              <Icon name={p.retrying ? "clock" : "arrow"} size={15} /> {p.retrying ? "Retrying…" : p.retryPending ? "Retry delivery" : "Retry review plan"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
