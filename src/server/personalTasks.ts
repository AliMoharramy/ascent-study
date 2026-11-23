import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserTransaction, type Db } from "@/db/client";
import { personalTasks } from "@/db/schema";
import { appendEvent, EventRequestConflict, replayOf } from "@/events/store";
import { newId, nowIso } from "@/lib/ids";

export const createPersonalTaskInput = z.object({
  title: z.string().trim().min(1).max(200),
  clientRequestId: z.string().min(1).max(80),
});

export const updatePersonalTaskInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["open", "done"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export async function listPersonalTasks(db: Db, userId: string) {
  return await db.select().from(personalTasks)
    .where(eq(personalTasks.userId, userId))
    .orderBy(desc(personalTasks.createdAt));
}

export async function createPersonalTask(db: Db, userId: string, input: unknown) {
  const { title, clientRequestId } = createPersonalTaskInput.parse(input);
  return await withUserTransaction(db, userId, async (tx) => {
    const prior = await replayOf(tx, userId, "personal_task.created", clientRequestId, { title });
    if (prior) {
      const taskId = prior.payload.taskId;
      if (typeof taskId !== "string") throw new EventRequestConflict();
      const original = (await tx.select().from(personalTasks)
        .where(and(eq(personalTasks.id, taskId), eq(personalTasks.userId, userId))).limit(1))[0];
      if (!original) throw new EventRequestConflict();
      return original;
    }

    const now = nowIso();
    const row = { id: newId(), userId, title, status: "open" as const, createdAt: now, updatedAt: now, completedAt: null };
    await tx.insert(personalTasks).values(row);
    await appendEvent(tx, {
      userId,
      type: "personal_task.created",
      payload: { taskId: row.id, request: { title } },
      clientRequestId,
    });
    return row;
  });
}

export async function updatePersonalTask(db: Db, userId: string, taskId: string, input: unknown) {
  const changes = updatePersonalTaskInput.parse(input);
  return await withUserTransaction(db, userId, async (tx) => {
    const current = (await tx.select().from(personalTasks)
      .where(and(eq(personalTasks.id, taskId), eq(personalTasks.userId, userId))).limit(1))[0];
    if (!current) throw new Error("Unknown personal task");

    const now = nowIso();
    const title = changes.title ?? current.title;
    const status = changes.status ?? current.status;
    const completedAt = status === "done" ? (current.completedAt ?? now) : null;
    const updated = {
      ...current,
      title,
      status,
      completedAt,
      updatedAt: now,
    };
    await tx.update(personalTasks).set({ title, status, completedAt, updatedAt: now })
      .where(and(eq(personalTasks.id, taskId), eq(personalTasks.userId, userId)));

    if (current.status !== status) {
      await appendEvent(tx, {
        userId,
        type: status === "done" ? "personal_task.completed" : "personal_task.reopened",
        payload: { taskId },
      });
    } else if (current.title !== title) {
      await appendEvent(tx, { userId, type: "personal_task.updated", payload: { taskId } });
    }
    return updated;
  });
}
