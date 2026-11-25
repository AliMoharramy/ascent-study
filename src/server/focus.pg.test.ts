import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/testing";
import { focusSessions, personalTasks } from "@/db/schema";
import { createUser } from "./auth";
import { completeFocusBlock, discardFocus, FocusConflict, idlePause, manualFocus, minutesForDay, openSession, pauseFocus, resumeFocus, startFocus, stopFocus } from "./focus";
import { listEvents } from "@/events/store";

let fixture: TestDb;
let userId: string;
const now = new Date("2026-11-14T00:29:00Z");
beforeEach(async () => {
  fixture = await createTestDb({ label: "focus" });
  userId = await createUser(fixture.db, { username: "focus", name: "Focus", password: "local test password" });
});
afterEach(async () => { await fixture?.close(); });

describe("PostgreSQL focus transactions", () => {
  it("returns the original session for concurrent retries, including after stop", async () => {
    const db = fixture.db;
    const input = { kind: "video" as const, clientRequestId: "start" };
    const sessions = await Promise.all(Array.from({ length: 6 }, () => startFocus(db, userId, input, { now })));
    expect(new Set(sessions.map((r) => r.id)).size).toBe(1);
    expect(await db.select().from(focusSessions)).toHaveLength(1);
    await expect(startFocus(db, userId, { kind: "tests", clientRequestId: "start" }, { now })).rejects.toThrow(FocusConflict);
    const stopped = await stopFocus(db, userId, new Date("2026-11-14T00:49:00Z"));
    expect(stopped).toMatchObject({ minutes: 20, gameDay: "2026-11-13" });
    expect((await startFocus(db, userId, input, { now })).id).toBe(stopped.id);
    expect(await openSession(db, userId)).toBeUndefined();
    expect(await listEvents(db, userId, "focus.started")).toHaveLength(1);
  });

  it("allows only one winner for different simultaneous start requests", async () => {
    const results = await Promise.allSettled([startFocus(fixture.db, userId, { clientRequestId: "one" }, { now }), startFocus(fixture.db, userId, { clientRequestId: "two" }, { now })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason).toBeInstanceOf(FocusConflict);
  });

  it("persists the selected task source, ID, and title across focus transitions", async () => {
    const started = await startFocus(fixture.db, userId, {
      kind: "video",
      taskSource: "Courses",
      taskId: "lesson-17",
      taskTitle: "Review chapter 4",
    }, { now });
    expect(started).toMatchObject({
      taskSource: "Courses",
      taskId: "lesson-17",
      taskTitle: "Review chapter 4",
    });

    await pauseFocus(fixture.db, userId, new Date("2026-11-14T00:39:00Z"));
    expect(await openSession(fixture.db, userId)).toMatchObject({
      id: started.id,
      taskSource: "Courses",
      taskId: "lesson-17",
      taskTitle: "Review chapter 4",
      status: "paused",
    });
  });

  it("stops at 25 active minutes and completes the selected personal task once", async () => {
    const taskId = "mine-focus-block";
    await fixture.db.insert(personalTasks).values({
      id: taskId,
      userId,
      title: "Review chapter 4",
      status: "open",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: null,
    });
    const started = await startFocus(fixture.db, userId, {
      kind: "video",
      taskSource: "Mine",
      taskId,
      taskTitle: "Review chapter 4",
    }, { now });

    const early = await completeFocusBlock(fixture.db, userId, started.id, new Date(now.getTime() + 24 * 60_000 + 59_000));
    expect(early.blockCompleted).toBe(false);
    expect(early.session.status).toBe("running");

    const completed = await completeFocusBlock(fixture.db, userId, started.id, new Date(now.getTime() + 25 * 60_000 + 30_000));
    expect(completed).toMatchObject({
      blockCompleted: true,
      taskAutoCompleted: true,
      session: {
        status: "ended",
        minutes: 25,
        endedAt: "2026-11-14T00:54:00.000Z",
        taskAutoCompleted: true,
      },
    });
    expect(await fixture.db.select().from(personalTasks)).toMatchObject([{ id: taskId, status: "done" }]);

    const retry = await completeFocusBlock(fixture.db, userId, started.id, new Date(now.getTime() + 26 * 60_000));
    expect(retry).toMatchObject({ blockCompleted: true, taskAutoCompleted: true, session: { id: started.id } });
    expect(await listEvents(fixture.db, userId, "focus.stopped")).toHaveLength(1);
    expect(await listEvents(fixture.db, userId, "personal_task.completed")).toHaveLength(1);
  });

  it("does not let discard erase a block once 25 active minutes have elapsed", async () => {
    const started = await startFocus(fixture.db, userId, { kind: "review" }, { now });
    const result = await discardFocus(fixture.db, userId, new Date(now.getTime() + 25 * 60_000));

    expect(result).toMatchObject({
      blockCompleted: true,
      taskAutoCompleted: false,
      session: { id: started.id, status: "ended", minutes: 25 },
    });
    expect(await listEvents(fixture.db, userId, "focus.discarded")).toHaveLength(0);
    expect(await listEvents(fixture.db, userId, "focus.stopped")).toHaveLength(1);
  });

  it("increments idle pauses once per running-to-paused transition", async () => {
    const db = fixture.db;
    await startFocus(db, userId, {}, { now });
    const later = new Date("2026-11-14T00:39:00Z");
    await Promise.all(Array.from({ length: 5 }, () => idlePause(db, userId, later)));
    expect(await openSession(db, userId)).toMatchObject({ status: "paused", idlePauses: 1 });
    await resumeFocus(db, userId, later);
    await idlePause(db, userId, new Date("2026-11-14T00:49:00Z"));
    expect(await openSession(db, userId)).toMatchObject({ idlePauses: 2 });
  });

  it("deduplicates manual entries and returns the original result on retry", async () => {
    const db = fixture.db;
    const input = { day: "2026-11-13", start: "12:00", minutes: 20, clientRequestId: "manual" };
    const results = await Promise.all([manualFocus(db, userId, input, { now }), manualFocus(db, userId, input, { now })]);
    expect(results[0]).toBeTruthy();
    expect(results[1]).toEqual(results[0]);
    expect(await minutesForDay(db, userId, "2026-11-13")).toBe(20);
    await expect(manualFocus(db, userId, { ...input, minutes: 21 }, { now })).rejects.toThrow(FocusConflict);
  });
});
