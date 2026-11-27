import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/testing";
import { chapters, courses, events, lessons, studyLogReviews, studyLogs, subjects } from "@/db/schema";
import { createUser } from "./auth";
import { pauseFocus, resumeFocus, startFocus, stopFocus } from "./focus";
import * as studyLogService from "./studyLogs";

let fixture: TestDb;
let userId: string;
const today = "2026-11-14";
const now = new Date("2026-11-14T10:00:00.000Z");
const sourceText = "Breadth-first search uses a queue. It visits vertices by distance from the start.";

const schedule = () => ({
  decision: "schedule",
  reason: "The notes contain a core algorithm and a useful traversal property.",
  reviews: [
    { front: "Breadth-first search uses a {{blank}}.", back: "queue", evidence: "Breadth-first search uses a queue." },
    { front: "It visits vertices by {{blank}} from the start.", back: "distance", evidence: "It visits vertices by distance from the start." },
    { front: "Breadth-first search uses a {{blank}}.", back: "queue", evidence: "Breadth-first search uses a queue." },
    { front: "It visits vertices by {{blank}} from the start.", back: "distance", evidence: "It visits vertices by distance from the start." },
  ],
});

const input = (clientRequestId: string, overrides: Record<string, unknown> = {}) => ({
  topic: "Breadth-first search",
  sourceText,
  clientRequestId,
  consentToRemoteAi: true,
  ...overrides,
});

const retryInput = (clientRequestId: string, notes = sourceText) => ({ sourceText: notes, clientRequestId, consentToRemoteAi: true });
const reviewAction = (action: "complete" | "skip" | "cancel" | "snooze", clientRequestId: string, dueOn?: string) => ({ action, clientRequestId, ...(dueOn ? { dueOn } : {}) });

const evaluator = (value: unknown) => async () => value;

async function insertOwnedCourse(ownerId: string, id: string) {
  const at = now.toISOString();
  await fixture.db.insert(subjects).values({ id: `subject-${id}`, nameFa: "الگوریتم", nameEn: "Algorithms", group: "core", status: "active", updatedAt: at });
  await fixture.db.insert(courses).values({ id, userId: ownerId, subjectId: `subject-${id}`, kind: "teaching", title: "Algorithms course", createdAt: at, updatedAt: at });
}

beforeEach(async () => {
  fixture = await createTestDb({ label: "study-logs" });
  userId = await createUser(fixture.db, { username: "study-log-owner", name: "Owner", password: "local test password" });
});

afterEach(async () => { await fixture?.close(); });

describe("PostgreSQL study-log lifecycle", () => {
  it("stores exactly four source-grounded reviews on fixed server dates", async () => {
    const result = await studyLogService.submitStudyLog(fixture.db, userId, input("study-request-001"), today, evaluator(schedule()));

    expect(result.log).toMatchObject({ status: "scheduled", decision: "schedule", studiedOn: today });
    expect(result.reviews).toHaveLength(4);
    expect(result.reviews.map((review) => [review.offsetDays, review.scheduledOn, review.dueOn])).toEqual([
      [3, "2026-11-17", "2026-11-17"],
      [7, "2026-11-21", "2026-11-21"],
      [14, "2026-11-28", "2026-11-28"],
      [30, "2026-12-14", "2026-12-14"],
    ]);
    expect(result.reviews.every((review) => review.front && review.back)).toBe(true);
    expect(result.log).not.toHaveProperty("requestFingerprint");
  });

  it("persists no-sequence and needs-material decisions without reviews", async () => {
    for (const decision of ["no_sequence", "needs_material"] as const) {
      const result = await studyLogService.submitStudyLog(fixture.db, userId, input(`study-${decision}-001`), today, evaluator({ decision, reason: "There is not enough connected material for a fixed review sequence.", reviews: [] }));
      expect(result.log).toMatchObject({ status: decision, decision, reason: expect.any(String) });
      expect(result.reviews).toEqual([]);
    }
    expect(await fixture.db.select().from(studyLogReviews)).toEqual([]);
  });

  it("keeps malformed or unavailable AI decisions recoverable and succeeds after retry", async () => {
    const malformed = await studyLogService.submitStudyLog(fixture.db, userId, input("study-retry-001"), today, evaluator({ ...schedule(), reviews: schedule().reviews.map((review) => ({ ...review, evidence: "not present in the notes" })) }));
    expect(malformed.log.status).toBe("retryable");
    expect(malformed.reviews).toEqual([]);

    const unavailable = await studyLogService.submitStudyLog(fixture.db, userId, input("study-retry-002"), today, evaluator(null));
    expect(unavailable.log.status).toBe("retryable");
    const retried = await studyLogService.retryStudyLog(fixture.db, userId, unavailable.log.id, retryInput("study-retry-request-001"), today, evaluator(schedule()));
    expect(retried.log.status).toBe("scheduled");
    expect(retried.reviews).toHaveLength(4);
  });

  it("marks a failed review-sequence transaction retryable without partial rows", async () => {
    await fixture.db.execute(sql`CREATE FUNCTION reject_study_review_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'review persistence rejected'; END;
    $$`);
    await fixture.db.execute(sql`CREATE TRIGGER reject_study_review_insert BEFORE INSERT ON study_log_reviews FOR EACH ROW EXECUTE FUNCTION reject_study_review_insert()`);

    const failed = await studyLogService.submitStudyLog(fixture.db, userId, input("study-persist-fail-001"), today, evaluator(schedule()));
    expect(failed.log.status).toBe("retryable");
    expect(failed.log.aiConsentAt).toBeTruthy();
    expect(failed.reviews).toEqual([]);

    await fixture.db.execute(sql`DROP TRIGGER reject_study_review_insert ON study_log_reviews`);
    await fixture.db.execute(sql`DROP FUNCTION reject_study_review_insert()`);
    const recovered = await studyLogService.retryStudyLog(fixture.db, userId, failed.log.id, retryInput("study-persist-retry-001"), today, evaluator(schedule()));
    expect(recovered.log.status).toBe("scheduled");
    expect(recovered.reviews).toHaveLength(4);
  });

  it("replays an identical retry request and rejects a reused key with changed notes", async () => {
    const failed = await studyLogService.submitStudyLog(fixture.db, userId, input("study-retry-replay-001"), today, evaluator(null));
    const request = retryInput("study-retry-replay-request-001");
    const first = await studyLogService.retryStudyLog(fixture.db, userId, failed.log.id, request, today, evaluator(schedule()));
    const replay = await studyLogService.retryStudyLog(fixture.db, userId, failed.log.id, request, today, evaluator(null));
    expect(replay.reviews.map((review) => review.id)).toEqual(first.reviews.map((review) => review.id));
    await expect(studyLogService.retryStudyLog(fixture.db, userId, failed.log.id, retryInput(request.clientRequestId, "Changed BFS source."), today, evaluator(null))).rejects.toBeInstanceOf(studyLogService.EventRequestConflict);
    const retryEvents = await fixture.db.select().from(events).where(eq(events.type, "study_log.retry_requested"));
    expect(retryEvents).toHaveLength(1);
  });

  it("replays identical idempotency keys, conflicts on changed payload, and permits a fresh session", async () => {
    let calls = 0;
    const runEvaluator = async () => { calls += 1; return schedule(); };
    const first = await studyLogService.submitStudyLog(fixture.db, userId, input("study-idempotent-001"), today, runEvaluator);
    const replay = await studyLogService.submitStudyLog(fixture.db, userId, input("study-idempotent-001"), today, runEvaluator);
    expect(replay.log.id).toBe(first.log.id);
    expect(calls).toBe(1);
    await expect(studyLogService.submitStudyLog(fixture.db, userId, input("study-idempotent-001", { topic: "Different topic" }), today, runEvaluator)).rejects.toBeInstanceOf(studyLogService.StudyLogConflict);

    const fresh = await studyLogService.submitStudyLog(fixture.db, userId, input("study-idempotent-002"), today, runEvaluator);
    expect(fresh.log.id).not.toBe(first.log.id);
    expect(calls).toBe(2);
  });

  it("replays a committed submission when its HTTP response is lost, even after analysis edits", async () => {
    const request = input("study-lost-response-001");
    let calls = 0;
    const committed = await studyLogService.submitStudyLog(fixture.db, userId, request, today, async () => {
      calls += 1;
      return null;
    });
    // Simulate the server commit succeeding while the browser never receives that response.
    await studyLogService.retryStudyLog(fixture.db, userId, committed.log.id, retryInput("study-lost-response-retry-001", "Edited source after the first analysis."), today, evaluator(null));

    const replay = await studyLogService.submitStudyLog(fixture.db, userId, request, today, async () => {
      calls += 1;
      return schedule();
    });

    expect(replay.log.id).toBe(committed.log.id);
    expect(replay.log.sourceText).toBe("Edited source after the first analysis.");
    expect(calls).toBe(1);
  });

  it("replays omitted study-day submissions after game-day rollover", async () => {
    const request = input("study-rollover-replay-001", { studiedOn: undefined });
    const first = await studyLogService.submitStudyLog(fixture.db, userId, request, today, evaluator(null));
    const replay = await studyLogService.submitStudyLog(fixture.db, userId, request, "2026-11-15", evaluator(schedule()));

    expect(replay.log.id).toBe(first.log.id);
    expect(replay.log.studiedOn).toBe(today);
  });

  it("replays review-action requests after game-day rollover", async () => {
    const result = await studyLogService.submitStudyLog(fixture.db, userId, input("study-action-rollover-001"), today, evaluator(schedule()));
    const request = reviewAction("complete", "review-rollover-action-001");
    const first = await studyLogService.actOnStudyLogReview(fixture.db, userId, result.reviews[0]!.id, request, today);
    const replay = await studyLogService.actOnStudyLogReview(fixture.db, userId, result.reviews[0]!.id, request, "2026-11-15");

    expect(replay).toEqual(first);
  });

  it("replays all review actions across rollover, including snooze on and after its original due date", async () => {
    const result = await studyLogService.submitStudyLog(fixture.db, userId, input("study-action-rollover-all-001"), today, evaluator(schedule()));
    const [complete, snooze, skip, cancel] = result.reviews;
    const requests = [
      { review: complete!, input: reviewAction("complete", "review-rollover-complete-001"), firstReplayDay: "2026-11-15" },
      { review: snooze!, input: reviewAction("snooze", "review-rollover-snooze-001", "2026-11-16"), firstReplayDay: "2026-11-16" },
      { review: skip!, input: reviewAction("skip", "review-rollover-skip-001"), firstReplayDay: "2026-11-15" },
      { review: cancel!, input: reviewAction("cancel", "review-rollover-cancel-001"), firstReplayDay: "2026-11-15" },
    ] as const;

    for (const item of requests) {
      const committed = await studyLogService.actOnStudyLogReview(fixture.db, userId, item.review.id, item.input, today);
      const replay = await studyLogService.actOnStudyLogReview(fixture.db, userId, item.review.id, item.input, item.firstReplayDay);
      expect(replay).toEqual(committed);
      if (item.input.action === "snooze") {
        expect(await studyLogService.actOnStudyLogReview(fixture.db, userId, item.review.id, item.input, "2026-11-17")).toEqual(committed);
      }
    }

    await expect(studyLogService.actOnStudyLogReview(
      fixture.db,
      userId,
      result.reviews[0]!.id,
      reviewAction("snooze", "review-rollover-new-invalid-001", "2026-11-14"),
      "2026-11-14",
    )).rejects.toBeInstanceOf(studyLogService.StudyLogConflict);
  });

  it("returns bounded deterministic history pages without source text", async () => {
    const createdAt = "2026-11-14T10:00:00.000Z";
    await fixture.db.insert(studyLogs).values(Array.from({ length: 7 }, (_, index) => ({
      id: `history-${index}`,
      userId,
      clientRequestId: `history-request-${index}`,
      topic: `History ${index}`,
      courseId: null,
      lessonId: null,
      chapterId: null,
      studiedOn: today,
      sourceText: `private source ${index}`,
      status: "no_sequence" as const,
      decision: "no_sequence" as const,
      reason: "No sequence needed.",
      analysisStartedAt: null,
      aiConsentAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    })));

    const first = await studyLogService.listStudyLogs(fixture.db, userId, { limit: 3 });
    const second = await studyLogService.listStudyLogs(fixture.db, userId, { limit: 3, cursor: first.nextCursor! });
    const third = await studyLogService.listStudyLogs(fixture.db, userId, { limit: 3, cursor: second.nextCursor! });

    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(3);
    expect(third.items).toHaveLength(1);
    expect([...first.items, ...second.items, ...third.items].map(({ log }) => log.id)).toEqual([
      "history-6", "history-5", "history-4", "history-3", "history-2", "history-1", "history-0",
    ]);
    expect(first.items[0]!.log).not.toHaveProperty("sourceText");
    expect(first.nextCursor).toBeTruthy();
    expect(third.nextCursor).toBeNull();
  });

  it("caps an oversized history page at fifty rows", async () => {
    const createdAt = "2026-11-14T10:00:00.000Z";
    await fixture.db.insert(studyLogs).values(Array.from({ length: 55 }, (_, index) => ({
      id: `bounded-history-${index}`,
      userId,
      clientRequestId: `bounded-history-request-${index}`,
      topic: `Bounded history ${index}`,
      courseId: null,
      lessonId: null,
      chapterId: null,
      studiedOn: today,
      sourceText: `private source ${index}`,
      status: "no_sequence" as const,
      decision: "no_sequence" as const,
      reason: "No sequence needed.",
      analysisStartedAt: null,
      aiConsentAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    })));

    const page = await studyLogService.listStudyLogs(fixture.db, userId, { limit: 500 });

    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();
    expect(page.items.every(({ log }) => !("sourceText" in log))).toBe(true);
  });

  it("reconciles pending browser request IDs through private-free summaries and accepted events", async () => {
    const submitted = await studyLogService.submitStudyLog(fixture.db, userId, input("reconcile-submit-001"), today, evaluator(schedule()));
    const failed = await studyLogService.submitStudyLog(fixture.db, userId, input("reconcile-retry-log-001"), today, evaluator(null));
    await studyLogService.retryStudyLog(fixture.db, userId, failed.log.id, retryInput("reconcile-retry-action-001"), today, evaluator(null));
    await studyLogService.actOnStudyLogReview(
      fixture.db,
      userId,
      submitted.reviews[0]!.id,
      reviewAction("complete", "reconcile-review-action-001"),
      today,
    );

    const result = await studyLogService.reconcileStudyLogMutations(fixture.db, userId, [
      "reconcile-submit-001",
      "reconcile-retry-log-001",
      "reconcile-retry-action-001",
      "reconcile-review-action-001",
      "missing-request-001",
    ]);

    expect(result.studyLogs.map(({ log }) => log.clientRequestId).sort()).toEqual(["reconcile-retry-log-001", "reconcile-submit-001"]);
    expect(result.studyLogs.every(({ log }) => !("sourceText" in log))).toBe(true);
    expect(result.acceptedRequestIds.sort()).toEqual(["reconcile-retry-action-001", "reconcile-review-action-001"]);
  });

  it("claims a concurrent request only once", async () => {
    let calls = 0;
    const slowEvaluator = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return schedule();
    };
    const [first, second] = await Promise.all([
      studyLogService.submitStudyLog(fixture.db, userId, input("study-race-001"), today, slowEvaluator),
      studyLogService.submitStudyLog(fixture.db, userId, input("study-race-001"), today, slowEvaluator),
    ]);
    expect(first.log.id).toBe(second.log.id);
    expect(calls).toBe(1);
    expect((await fixture.db.select().from(studyLogReviews))).toHaveLength(4);
  });

  it("rejects cross-owner or inconsistent references and hides another owner's log", async () => {
    await expect(studyLogService.submitStudyLog(fixture.db, userId, input("study-reference-001", { courseId: "missing-course" }), today, evaluator(schedule()))).rejects.toBeInstanceOf(studyLogService.StudyLogConflict);

    await insertOwnedCourse(userId, "owner-course");
    await insertOwnedCourse(userId, "other-course");
    const at = now.toISOString();
    await fixture.db.insert(lessons).values({ id: "lesson-other", courseId: "other-course", no: 1, title: "Other course lesson", durationMin: 20, status: "todo", watchedAt: null, createdAt: at, updatedAt: at });
    await fixture.db.insert(chapters).values({ id: "chapter-other", subjectId: "subject-other-course", no: 1, title: "Other course chapter", optional: false, tier: null, tierLocked: false, eqWeight: null, updatedAt: at });
    await expect(studyLogService.submitStudyLog(fixture.db, userId, input("study-reference-003", { courseId: "owner-course", lessonId: "lesson-other" }), today, evaluator(schedule()))).rejects.toBeInstanceOf(studyLogService.StudyLogConflict);
    await expect(studyLogService.submitStudyLog(fixture.db, userId, input("study-reference-004", { courseId: "owner-course", chapterId: "chapter-other" }), today, evaluator(schedule()))).rejects.toBeInstanceOf(studyLogService.StudyLogConflict);
    const result = await studyLogService.submitStudyLog(fixture.db, userId, input("study-reference-002", { courseId: "owner-course" }), today, evaluator(schedule()));
    await expect(studyLogService.getStudyLog(fixture.db, "different-owner", result.log.id)).rejects.toBeInstanceOf(studyLogService.StudyLogNotFound);
    expect((await studyLogService.getStudyLog(fixture.db, userId, result.log.id)).log.id).toBe(result.log.id);
  });

  it("supports complete, snooze, skip, and cancel while preserving the original due date", async () => {
    const result = await studyLogService.submitStudyLog(fixture.db, userId, input("study-actions-001"), today, evaluator(schedule()));
    const [first, second, third, fourth] = result.reviews;

    const snoozeRequest = reviewAction("snooze", "review-snooze-0001", "2026-11-25");
    const snoozed = await studyLogService.actOnStudyLogReview(fixture.db, userId, first!.id, snoozeRequest, today);
    expect(await studyLogService.actOnStudyLogReview(fixture.db, userId, first!.id, snoozeRequest, today)).toEqual(snoozed);
    expect(snoozed).toMatchObject({ scheduledOn: "2026-11-17", dueOn: "2026-11-25", status: "pending" });
    await expect(studyLogService.actOnStudyLogReview(fixture.db, userId, second!.id, reviewAction("snooze", "review-snooze-invalid", today), today)).rejects.toBeInstanceOf(studyLogService.StudyLogConflict);
    expect((await studyLogService.dueStudyLogReviews(fixture.db, userId, "2026-11-24")).map((review) => review.id)).toEqual([second!.id]);

    const completeRequest = reviewAction("complete", "review-complete-0001");
    const done = await studyLogService.actOnStudyLogReview(fixture.db, userId, first!.id, completeRequest, "2026-11-25");
    expect(await studyLogService.actOnStudyLogReview(fixture.db, userId, first!.id, completeRequest, "2026-11-25")).toEqual(done);
    expect(await studyLogService.actOnStudyLogReview(fixture.db, userId, first!.id, reviewAction("complete", "review-complete-repeat"), "2026-11-25")).toEqual(done);
    expect(done).toMatchObject({ status: "done", doneOn: "2026-11-25", scheduledOn: "2026-11-17" });
    expect((await studyLogService.actOnStudyLogReview(fixture.db, userId, second!.id, reviewAction("skip", "review-skip-0001"), today)).status).toBe("skipped");
    expect((await studyLogService.actOnStudyLogReview(fixture.db, userId, third!.id, reviewAction("cancel", "review-cancel-0001"), today)).status).toBe("canceled");
    expect((await studyLogService.actOnStudyLogReview(fixture.db, userId, fourth!.id, reviewAction("complete", "review-complete-0002"), today)).status).toBe("done");
    await expect(studyLogService.actOnStudyLogReview(fixture.db, "different-owner", first!.id, reviewAction("complete", "review-other-owner"), today)).rejects.toBeInstanceOf(studyLogService.StudyLogNotFound);
    const reviewEvents = await fixture.db.select().from(events).where(eq(events.type, "study_log.review_acted"));
    expect(reviewEvents).toHaveLength(6);
  });

  it("reclaims a processing attempt after its five-minute lease and leaves focus transitions independent", async () => {
    const pending = await studyLogService.submitStudyLog(fixture.db, userId, input("study-lease-001"), today, evaluator(null));
    await fixture.db.update(studyLogs).set({ status: "processing", analysisStartedAt: new Date().toISOString() }).where(eq(studyLogs.id, pending.log.id));
    await expect(studyLogService.retryStudyLog(fixture.db, userId, pending.log.id, retryInput("study-active-lease-001"), today, evaluator(schedule()))).rejects.toBeInstanceOf(studyLogService.StudyLogConflict);
    await fixture.db.update(studyLogs).set({ status: "processing", analysisStartedAt: "2026-11-14T09:50:00.000Z" }).where(eq(studyLogs.id, pending.log.id));
    const recovered = await studyLogService.retryStudyLog(fixture.db, userId, pending.log.id, retryInput("study-lease-retry-001"), today, evaluator(schedule()));
    expect(recovered.log.status).toBe("scheduled");

    const before = await fixture.db.select().from(studyLogReviews).where(eq(studyLogReviews.studyLogId, recovered.log.id));
    const started = await startFocus(fixture.db, userId, { kind: "video", clientRequestId: "study-focus-001" }, { now });
    await pauseFocus(fixture.db, userId, new Date(now.getTime() + 2 * 60_000));
    await resumeFocus(fixture.db, userId, new Date(now.getTime() + 3 * 60_000));
    await stopFocus(fixture.db, userId, new Date(now.getTime() + 4 * 60_000));
    const after = await fixture.db.select().from(studyLogReviews).where(eq(studyLogReviews.studyLogId, recovered.log.id));
    expect(after).toEqual(before);
    expect(started.status).toBe("running");
  });
});
