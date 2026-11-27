import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { addDaysIso } from "@/i18n/jalali";
import { createTestDb, type TestDb } from "@/db/testing";
import { reminders } from "@/db/schema";
import { createUser } from "./auth";
import { ensureDefaultConfig, updateConfig } from "./config";
import { dueStudyLogReviews, submitStudyLog } from "./studyLogs";
import { ensureTodayReminders } from "./reminders";

let fixture: TestDb;
let userId: string;
const today = "2026-11-14";
const sourceText = "Breadth-first search uses a queue and visits vertices by distance.";
const decision = {
  decision: "schedule" as const,
  reason: "The notes contain a useful algorithm and traversal rule.",
  reviews: [1, 2, 3, 4].map((n) => ({ front: `Question ${n}`, back: `Answer ${n}`, evidence: "Breadth-first search uses a queue" })),
};

async function addLog(dueOffset: 3 | 7 | 14 | 30, requestId: string) {
  return await submitStudyLog(fixture.db, userId, {
    topic: `Study reminder ${requestId}`,
    sourceText,
    studiedOn: addDaysIso(today, -dueOffset),
    clientRequestId: requestId,
  }, today, async () => decision);
}

beforeEach(async () => {
  fixture = await createTestDb({ label: "reminders-study" });
  userId = await createUser(fixture.db, { username: "reminders-study", name: "Reminder test", password: "local test password" });
  await ensureDefaultConfig(fixture.db, userId);
});

afterEach(async () => { await fixture?.close(); });

describe("PostgreSQL reminders with fixed study reviews", () => {
  it("prioritizes due reviews with stable keys, respects the cap, and remains idempotent", async () => {
    await updateConfig(fixture.db, userId, { reminders: { enabled: true, maxPerDay: 1 } }, "study reminder priority");
    const log = await addLog(3, "reminder-study-003");
    const dueReview = log.reviews.find((review) => review.offsetDays === 3)!;

    expect(await ensureTodayReminders(fixture.db, userId, today)).toBe(1);
    const first = await fixture.db.select().from(reminders).where(and(eq(reminders.userId, userId), eq(reminders.date, today)));
    expect(first).toHaveLength(1);
    expect(first[0]!.anchorKey).toBe(`study-review:${dueReview.id}`);
    expect(await ensureTodayReminders(fixture.db, userId, today)).toBe(0);
    expect(await fixture.db.select().from(reminders).where(and(eq(reminders.userId, userId), eq(reminders.date, today)))).toHaveLength(1);
  });

  it("creates no reminders when disabled while leaving the due review visible to Forge", async () => {
    await updateConfig(fixture.db, userId, { reminders: { enabled: false, maxPerDay: 5 } }, "disable study reminders");
    await addLog(3, "reminder-disabled-003");

    expect(await ensureTodayReminders(fixture.db, userId, today)).toBe(0);
    expect(await fixture.db.select().from(reminders).where(eq(reminders.userId, userId))).toEqual([]);
    expect(await dueStudyLogReviews(fixture.db, userId, today)).toHaveLength(1);
  });

  it("keeps all due reviews visible through Forge when reminders reach the configured cap", async () => {
    await updateConfig(fixture.db, userId, { reminders: { enabled: true, maxPerDay: 2 } }, "cap study reminders");
    await addLog(3, "reminder-cap-003");
    await addLog(7, "reminder-cap-007");
    await addLog(14, "reminder-cap-014");

    expect(await ensureTodayReminders(fixture.db, userId, today)).toBe(2);
    const created = await fixture.db.select().from(reminders).where(and(eq(reminders.userId, userId), eq(reminders.date, today)));
    expect(created).toHaveLength(2);
    expect(created.every((reminder) => reminder.anchorKey.startsWith("study-review:"))).toBe(true);
    expect(await dueStudyLogReviews(fixture.db, userId, today)).toHaveLength(6);
  });
});
