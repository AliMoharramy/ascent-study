import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { addDaysIso } from "@/i18n/jalali";
import { createTestDb, type TestDb } from "@/db/testing";
import { reminders } from "@/db/schema";
import { currentStudyGameDay } from "@/domain/studyLog";
import { createUser } from "./auth";
import { ensureDefaultConfig, updateConfig } from "./config";
import { actOnStudyLogReview, dueStudyLogReviews, submitStudyLog } from "./studyLogs";
import { ensureTodayReminders, remindersView } from "./reminders";

let fixture: TestDb;
let userId: string;
const today = "2026-11-14";
const sourceText = "Breadth-first search uses a queue and visits vertices by distance.";
const decision = {
  decision: "schedule" as const,
  reason: "The notes contain a useful algorithm and traversal rule.",
  reviews: [
    {
      front: "Breadth-first search uses a {{blank}}",
      back: "queue",
      evidence: "Breadth-first search uses a queue",
    },
    {
      front: "and visits vertices by {{blank}}.",
      back: "distance",
      evidence: "and visits vertices by distance.",
    },
    {
      front: "Breadth-first search uses a {{blank}}",
      back: "queue",
      evidence: "Breadth-first search uses a queue",
    },
    {
      front: "and visits vertices by {{blank}}.",
      back: "distance",
      evidence: "and visits vertices by distance.",
    },
  ],
};

async function addLog(dueOffset: 3 | 7 | 14 | 30, requestId: string) {
  return await submitStudyLog(
    fixture.db,
    userId,
    {
      topic: `Study reminder ${requestId}`,
      sourceText,
      studiedOn: addDaysIso(today, -dueOffset),
      clientRequestId: requestId,
      consentToRemoteAi: true,
    },
    today,
    async () => decision,
  );
}

beforeEach(async () => {
  fixture = await createTestDb({ label: "reminders-study" });
  userId = await createUser(fixture.db, {
    username: "reminders-study",
    name: "Reminder test",
    password: "local test password",
  });
  await ensureDefaultConfig(fixture.db, userId);
});

afterEach(async () => {
  await fixture?.close();
});

describe("PostgreSQL reminders with fixed study reviews", () => {
  it("prioritizes due reviews with stable keys, respects the cap, and remains idempotent", async () => {
    await updateConfig(
      fixture.db,
      userId,
      { reminders: { enabled: true, maxPerDay: 1 } },
      "study reminder priority",
    );
    const log = await addLog(3, "reminder-study-003");
    const dueReview = log.reviews.find((review) => review.offsetDays === 3)!;

    expect(await ensureTodayReminders(fixture.db, userId, today)).toBe(1);
    const first = await fixture.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.userId, userId), eq(reminders.date, today)));
    expect(first).toHaveLength(1);
    expect(first[0]!.anchorKey).toBe(`study-review:${dueReview.id}`);
    expect(await ensureTodayReminders(fixture.db, userId, today)).toBe(0);
    expect(
      await fixture.db
        .select()
        .from(reminders)
        .where(and(eq(reminders.userId, userId), eq(reminders.date, today))),
    ).toHaveLength(1);
  });

  it("creates no reminders when disabled while leaving the due review visible to Forge", async () => {
    await updateConfig(
      fixture.db,
      userId,
      { reminders: { enabled: false, maxPerDay: 5 } },
      "disable study reminders",
    );
    await addLog(3, "reminder-disabled-003");

    expect(await ensureTodayReminders(fixture.db, userId, today)).toBe(0);
    expect(await fixture.db.select().from(reminders).where(eq(reminders.userId, userId))).toEqual([]);
    expect(await dueStudyLogReviews(fixture.db, userId, today)).toHaveLength(1);
  });

  it("keeps all due reviews visible through Forge when reminders reach the configured cap", async () => {
    await updateConfig(
      fixture.db,
      userId,
      { reminders: { enabled: true, maxPerDay: 2 } },
      "cap study reminders",
    );
    await addLog(3, "reminder-cap-003");
    await addLog(7, "reminder-cap-007");
    await addLog(14, "reminder-cap-014");

    expect(await ensureTodayReminders(fixture.db, userId, today)).toBe(2);
    const created = await fixture.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.userId, userId), eq(reminders.date, today)));
    expect(created).toHaveLength(2);
    expect(created.every((reminder) => reminder.anchorKey.startsWith("study-review:"))).toBe(true);
    expect(await dueStudyLogReviews(fixture.db, userId, today)).toHaveLength(6);
  });

  it.each([
    ["complete", "done"],
    ["snooze", "pending"],
    ["skip", "skipped"],
    ["cancel", "canceled"],
  ] as const)("dismisses the old actionable reminder when a review is %s", async (action, expectedStatus) => {
    await updateConfig(fixture.db, userId, { reminders: { enabled: true, maxPerDay: 1 } }, "test review reminder lifecycle");
    const log = await addLog(3, `reminder-action-${action}`);
    const review = log.reviews.find((candidate) => candidate.offsetDays === 3)!;
    await ensureTodayReminders(fixture.db, userId, today);
    expect(await fixture.db.select().from(reminders).where(eq(reminders.anchorKey, `study-review:${review.id}`))).toHaveLength(1);

    const request = action === "snooze"
      ? { action, dueOn: "2026-11-16", clientRequestId: `reminder-act-${action}-001` }
      : { action, clientRequestId: `reminder-act-${action}-001` };
    const updated = await actOnStudyLogReview(fixture.db, userId, review.id, request, today);

    expect(updated.status).toBe(expectedStatus);
    const oldReminder = (await fixture.db.select().from(reminders).where(and(
      eq(reminders.date, today),
      eq(reminders.anchorKey, `study-review:${review.id}`),
    )))[0];
    expect(oldReminder?.dismissedAt).toBeTruthy();
    expect(await remindersView(fixture.db, userId, today)).toMatchObject({ items: [], unread: 0 });
    expect(await dueStudyLogReviews(fixture.db, userId, today)).toEqual([]);
    if (action === "snooze") {
      await ensureTodayReminders(fixture.db, userId, "2026-11-16");
      expect(await fixture.db.select().from(reminders).where(and(
        eq(reminders.date, "2026-11-16"),
        eq(reminders.anchorKey, `study-review:${review.id}`),
        isNull(reminders.dismissedAt),
      ))).toHaveLength(1);
      expect(await dueStudyLogReviews(fixture.db, userId, "2026-11-16")).toHaveLength(1);
    }
  });

  it("keeps resolved reminders charged against the daily cap and hides them from unread views", async () => {
    await updateConfig(fixture.db, userId, { reminders: { enabled: true, maxPerDay: 1 } }, "preserve reminder daily cap");
    const firstLog = await addLog(3, "reminder-cap-preserved-first");
    const secondLog = await addLog(7, "reminder-cap-preserved-second");

    expect(await ensureTodayReminders(fixture.db, userId, today)).toBe(1);
    const cappedReminder = (await fixture.db.select().from(reminders).where(and(eq(reminders.userId, userId), eq(reminders.date, today))))[0]!;
    const firstReview = [...firstLog.reviews, ...secondLog.reviews].find((review) => cappedReminder.anchorKey === `study-review:${review.id}`)!;
    await actOnStudyLogReview(fixture.db, userId, firstReview.id, {
      action: "complete",
      clientRequestId: "reminder-cap-preserved-complete",
    }, today);

    expect(await ensureTodayReminders(fixture.db, userId, today)).toBe(0);
    expect(await fixture.db.select().from(reminders).where(and(eq(reminders.userId, userId), eq(reminders.date, today)))).toHaveLength(1);
    expect(await remindersView(fixture.db, userId, today)).toMatchObject({ items: [], unread: 0 });
    expect(await dueStudyLogReviews(fixture.db, userId, today)).toHaveLength(2);
  });

  it("keeps a newer snooze reminder active when the original action is replayed", async () => {
    await updateConfig(fixture.db, userId, { reminders: { enabled: true, maxPerDay: 1 } }, "protect newer snooze reminder");
    const log = await addLog(3, "reminder-historical-replay");
    const review = log.reviews.find((candidate) => candidate.offsetDays === 3)!;
    const request = { action: "snooze" as const, dueOn: "2026-11-16", clientRequestId: "reminder-historical-snooze-001" };

    await ensureTodayReminders(fixture.db, userId, today);
    await actOnStudyLogReview(fixture.db, userId, review.id, request, today);
    expect(await ensureTodayReminders(fixture.db, userId, "2026-11-16")).toBe(1);
    const currentReminder = (await fixture.db.select().from(reminders).where(and(
      eq(reminders.userId, userId),
      eq(reminders.date, "2026-11-16"),
      eq(reminders.anchorKey, `study-review:${review.id}`),
    )))[0]!;

    await expect(actOnStudyLogReview(fixture.db, userId, review.id, request, "2026-11-16")).resolves.toMatchObject({ dueOn: "2026-11-16" });
    await expect(actOnStudyLogReview(fixture.db, userId, review.id, request, "2026-11-17")).resolves.toMatchObject({ dueOn: "2026-11-16" });

    const afterReplay = (await fixture.db.select().from(reminders).where(eq(reminders.id, currentReminder.id)))[0]!;
    expect(afterReplay.dismissedAt).toBeNull();
    expect(await remindersView(fixture.db, userId, "2026-11-16")).toMatchObject({ items: [{ id: currentReminder.id }], unread: 1 });
  });

  it("surfaces a review on the correct local game day after the DST clock change", async () => {
    const dstToday = currentStudyGameDay(new Date("2026-03-08T08:30:00Z"), "America/New_York", 4);
    await updateConfig(
      fixture.db,
      userId,
      { reminders: { enabled: true, maxPerDay: 1 } },
      "DST study review",
    );
    const log = await submitStudyLog(
      fixture.db,
      userId,
      {
        topic: "DST study reminder",
        sourceText,
        studiedOn: addDaysIso(dstToday, -3),
        clientRequestId: "reminder-study-dst-003",
        consentToRemoteAi: true,
      },
      dstToday,
      async () => decision,
    );

    expect(log.reviews[0]?.scheduledOn).toBe(dstToday);
    expect(
      (await dueStudyLogReviews(fixture.db, userId, dstToday)).map((review) => review.studyLogId),
    ).toEqual([log.log.id]);
    expect(await ensureTodayReminders(fixture.db, userId, dstToday)).toBe(1);
  });
});
