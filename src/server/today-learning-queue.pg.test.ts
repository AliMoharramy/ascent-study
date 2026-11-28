import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/testing";
import { reviewCards, studyLogReviews, studyLogs } from "@/db/schema";
import { createUser } from "./auth";
import { dueCardSummary } from "./forge";
import { dueStudyLogReviewSummary } from "./studyLogs";

let fixture: TestDb;
let ownerId: string;
const otherId = "other-today-queue-user";
const today = "2026-11-28";
const at = "2026-11-28T10:00:00.000Z";

beforeEach(async () => {
  fixture = await createTestDb({ label: "today-queue" });
  ownerId = await createUser(fixture.db, { username: "today-queue-owner", name: "Owner", password: "local test password" });
});

afterEach(async () => { await fixture?.close(); });

describe("Today learning queue summaries", () => {
  it("counts each owner’s due adaptive and fixed reviews exactly while returning only bounded, answer-free previews", async () => {
    await fixture.db.insert(reviewCards).values([
      { id: "adaptive-overdue", userId: ownerId, refType: "error", refId: "e1", front: "Overdue question", back: "Private answer", step: 0, reps: 1, dueOn: "2026-11-27", createdAt: at, updatedAt: at },
      { id: "adaptive-today", userId: ownerId, refType: "manual", refId: null, front: "Due today", back: "Private answer", step: 0, reps: 0, dueOn: today, createdAt: at, updatedAt: at },
      { id: "adaptive-future", userId: ownerId, refType: "manual", refId: null, front: "Future question", back: "Private answer", step: 0, reps: 0, dueOn: "2026-11-29", createdAt: at, updatedAt: at },
    ]);

    await fixture.db.insert(studyLogs).values([
      { id: "fixed-log-owner", userId: ownerId, clientRequestId: "fixed-owner", topic: "BFS recall", studiedOn: "2026-11-14", sourceText: "Source notes", status: "scheduled", decision: "schedule", reason: "", createdAt: at, updatedAt: at },
    ]);
    await fixture.db.insert(studyLogReviews).values([
      { id: "fixed-overdue", userId: ownerId, studyLogId: "fixed-log-owner", checkpoint: 1, offsetDays: 3, front: "Question", back: "Private answer", scheduledOn: "2026-11-17", dueOn: "2026-11-26", status: "pending", doneOn: null, createdAt: at, updatedAt: at },
      { id: "fixed-today", userId: ownerId, studyLogId: "fixed-log-owner", checkpoint: 2, offsetDays: 7, front: "Question", back: "Private answer", scheduledOn: today, dueOn: today, status: "pending", doneOn: null, createdAt: at, updatedAt: at },
      { id: "fixed-future", userId: ownerId, studyLogId: "fixed-log-owner", checkpoint: 3, offsetDays: 14, front: "Question", back: "Private answer", scheduledOn: "2026-11-29", dueOn: "2026-11-29", status: "pending", doneOn: null, createdAt: at, updatedAt: at },
      { id: "fixed-done", userId: ownerId, studyLogId: "fixed-log-owner", checkpoint: 4, offsetDays: 30, front: "Question", back: "Private answer", scheduledOn: "2026-11-27", dueOn: "2026-11-27", status: "done", doneOn: "2026-11-27", createdAt: at, updatedAt: at },
    ]);

    const adaptive = await dueCardSummary(fixture.db, ownerId, today, 1);
    const fixed = await dueStudyLogReviewSummary(fixture.db, ownerId, today, 1);

    expect(adaptive).toEqual({ count: 2, cards: [{ id: "adaptive-overdue", front: "Overdue question", dueOn: "2026-11-27", refType: "error" }] });
    expect(adaptive.cards[0]).not.toHaveProperty("back");
    expect(fixed).toEqual({ count: 2, reviews: [{ id: "fixed-overdue", dueOn: "2026-11-26", topic: "BFS recall" }] });
    expect(fixed.reviews[0]).not.toHaveProperty("front");
    expect(fixed.reviews[0]).not.toHaveProperty("back");
    expect(await dueCardSummary(fixture.db, otherId, today)).toEqual({ count: 0, cards: [] });
    expect(await dueStudyLogReviewSummary(fixture.db, otherId, today)).toEqual({ count: 0, reviews: [] });
  });
});
