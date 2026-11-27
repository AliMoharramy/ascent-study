import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/testing";
import { chapters, courses, lessons, studyLogReviews, studyLogs, subjects } from "@/db/schema";
import { createUser } from "./auth";
import { pauseFocus, resumeFocus, startFocus, stopFocus } from "./focus";
import * as studyLogService from "./studyLogs";

let fixture: TestDb;
let userId: string;
const today = "2026-11-14";
const now = new Date("2026-11-14T10:00:00.000Z");
const sourceText = "Breadth-first search uses a queue. It visits vertices by distance from the start.";

const schedule = (evidence = "Breadth-first search uses a queue.") => ({
  decision: "schedule",
  reason: "The notes contain a core algorithm and a useful traversal property.",
  reviews: [1, 2, 3, 4].map((n) => ({ front: `Question ${n}`, back: `Answer ${n}`, evidence })),
});

const input = (clientRequestId: string, overrides: Record<string, unknown> = {}) => ({
  topic: "Breadth-first search",
  sourceText,
  clientRequestId,
  ...overrides,
});

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
    const malformed = await studyLogService.submitStudyLog(fixture.db, userId, input("study-retry-001"), today, evaluator(schedule("not present in the notes")));
    expect(malformed.log.status).toBe("retryable");
    expect(malformed.reviews).toEqual([]);

    const unavailable = await studyLogService.submitStudyLog(fixture.db, userId, input("study-retry-002"), today, evaluator(null));
    expect(unavailable.log.status).toBe("retryable");
    const retried = await studyLogService.retryStudyLog(fixture.db, userId, unavailable.log.id, sourceText, today, evaluator(schedule()));
    expect(retried.log.status).toBe("scheduled");
    expect(retried.reviews).toHaveLength(4);
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

    const snoozed = await studyLogService.actOnStudyLogReview(fixture.db, userId, first!.id, { action: "snooze", dueOn: "2026-11-25" }, today);
    expect(snoozed).toMatchObject({ scheduledOn: "2026-11-17", dueOn: "2026-11-25", status: "pending" });
    await expect(studyLogService.actOnStudyLogReview(fixture.db, userId, second!.id, { action: "snooze", dueOn: today }, today)).rejects.toBeInstanceOf(studyLogService.StudyLogConflict);
    expect((await studyLogService.dueStudyLogReviews(fixture.db, userId, "2026-11-24")).map((review) => review.id)).toEqual([second!.id]);

    const done = await studyLogService.actOnStudyLogReview(fixture.db, userId, first!.id, { action: "complete" }, "2026-11-25");
    expect(done).toMatchObject({ status: "done", doneOn: "2026-11-25", scheduledOn: "2026-11-17" });
    expect((await studyLogService.actOnStudyLogReview(fixture.db, userId, second!.id, { action: "skip" }, today)).status).toBe("skipped");
    expect((await studyLogService.actOnStudyLogReview(fixture.db, userId, third!.id, { action: "cancel" }, today)).status).toBe("canceled");
    expect((await studyLogService.actOnStudyLogReview(fixture.db, userId, fourth!.id, { action: "complete" }, today)).status).toBe("done");
    await expect(studyLogService.actOnStudyLogReview(fixture.db, "different-owner", first!.id, { action: "complete" }, today)).rejects.toBeInstanceOf(studyLogService.StudyLogNotFound);
  });

  it("reclaims a processing attempt after its five-minute lease and leaves focus transitions independent", async () => {
    const pending = await studyLogService.submitStudyLog(fixture.db, userId, input("study-lease-001"), today, evaluator(null));
    await fixture.db.update(studyLogs).set({ status: "processing", analysisStartedAt: "2026-11-14T09:50:00.000Z" }).where(eq(studyLogs.id, pending.log.id));
    const recovered = await studyLogService.retryStudyLog(fixture.db, userId, pending.log.id, sourceText, today, evaluator(schedule()));
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
