import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/testing";
import { EventRequestConflict, listEvents } from "@/events/store";
import { createUser } from "./auth";
import { createPersonalTask, listPersonalTasks, updatePersonalTask } from "./personalTasks";

let fixture: TestDb;
let userId: string;

beforeEach(async () => {
  fixture = await createTestDb({ label: "personal-tasks" });
  userId = await createUser(fixture.db, { username: "taskowner", name: "Task owner", password: "local test password" });
});

afterEach(async () => { await fixture?.close(); });

describe("PostgreSQL personal tasks", () => {
  it("deduplicates concurrent create retries and rejects request-key reuse", async () => {
    const input = { title: "  Review chapter 4  ", clientRequestId: "personal-task-create" };
    const created = await Promise.all(Array.from({ length: 5 }, () => createPersonalTask(fixture.db, userId, input)));

    expect(new Set(created.map((task) => task.id)).size).toBe(1);
    expect(created[0]).toMatchObject({ title: "Review chapter 4", status: "open" });
    expect(await listPersonalTasks(fixture.db, userId)).toHaveLength(1);
    expect(await listEvents(fixture.db, userId, "personal_task.created")).toHaveLength(1);
    await expect(createPersonalTask(fixture.db, userId, {
      title: "Different task",
      clientRequestId: input.clientRequestId,
    })).rejects.toBeInstanceOf(EventRequestConflict);
  });

  it("scopes tasks to their owner and records completion and reopen transitions", async () => {
    const task = await createPersonalTask(fixture.db, userId, {
      title: "Review chapter 4",
      clientRequestId: "owned-task-create",
    });
    const otherUserId = `${userId}-other`;

    expect(await listPersonalTasks(fixture.db, otherUserId)).toEqual([]);
    await expect(updatePersonalTask(fixture.db, otherUserId, task.id, {
      status: "done",
      clientRequestId: "other-owner-completion",
    }))
      .rejects.toThrow("Unknown personal task");

    const completionRequest = {
      status: "done",
      clientRequestId: "task-completion",
    };
    const completed = await updatePersonalTask(fixture.db, userId, task.id, completionRequest);
    expect(completed).toMatchObject({ status: "done", completedAt: expect.any(String) });
    expect(await updatePersonalTask(fixture.db, userId, task.id, completionRequest))
      .toMatchObject({ id: task.id, status: "done", completedAt: completed.completedAt });
    await expect(updatePersonalTask(fixture.db, userId, task.id, {
      ...completionRequest,
      title: "A different task",
    })).rejects.toBeInstanceOf(EventRequestConflict);

    const reopened = await updatePersonalTask(fixture.db, userId, task.id, {
      status: "open",
      clientRequestId: "task-reopen",
    });
    expect(reopened).toMatchObject({ status: "open", completedAt: null });
    expect(await listEvents(fixture.db, userId, "personal_task.completed")).toHaveLength(1);
    expect(await listEvents(fixture.db, userId, "personal_task.reopened")).toHaveLength(1);
  });
});
