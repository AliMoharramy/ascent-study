import { afterEach, describe, expect, it, vi } from "vitest";
import { type Db } from "@/db/client";
import { chapters, focusSessions, subjects } from "@/db/schema";
import { memoryDb, closeTestDb } from "@/db/testing";
import { newId, nowIso } from "@/lib/ids";
import { createUser } from "./auth";
import { updateConfig } from "./config";
import { sendCoachMessage } from "./coach";

const remoteCall = vi.hoisted(() => vi.fn());
vi.mock("@/server/ai", () => ({ remoteCall }));

const databases: Db[] = [];
const today = "2026-11-20";

async function setup(username: string) {
  const db = await memoryDb();
  databases.push(db);
  const userId = await createUser(db, { username, name: username, password: "correct horse battery" });
  return { db, userId };
}

async function seedSession(
  db: Db,
  userId: string,
  session: {
    gameDay: string;
    status?: "ended" | "running" | "paused";
    minutes?: number;
    taskTitle?: string;
    subjectId?: string;
    chapterId?: string;
    note?: string;
  },
) {
  const startedAt = `${session.gameDay}T06:00:00.000Z`;
  await db.insert(focusSessions).values({
    id: newId(),
    userId,
    kind: "video",
    status: session.status ?? "ended",
    startedAt,
    ...(session.status === "ended" || !session.status ? { endedAt: `${session.gameDay}T07:00:00.000Z` } : {}),
    minutes: session.minutes,
    gameDay: session.gameDay,
    subjectId: session.subjectId ?? null,
    chapterId: session.chapterId ?? null,
    taskTitle: session.taskTitle ?? null,
    note: session.note ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

afterEach(async () => {
  for (const db of databases.splice(0)) await closeTestDb(db);
  vi.unstubAllEnvs();
  remoteCall.mockReset();
});

describe("Archie study reports", () => {
  it("uses only the user's completed sessions in the requested period and keeps details local", async () => {
    const { db, userId } = await setup("StudyReportOwner");
    await db.insert(subjects).values({
      id: "math",
      nameFa: "ریاضی",
      nameEn: "Mathematics",
      group: "core",
      status: "active",
      updatedAt: nowIso(),
    });
    await db
      .insert(chapters)
      .values({ id: "algebra", subjectId: "math", no: 1, title: "Algebra", updatedAt: nowIso() });
    await seedSession(db, userId, {
      gameDay: "2026-11-12",
      minutes: 90,
      subjectId: "math",
      chapterId: "algebra",
      taskTitle: "Algebra lesson",
      note: "private session note",
    });
    await seedSession(db, userId, {
      gameDay: "2026-11-12",
      minutes: 30,
      subjectId: "math",
      chapterId: "algebra",
      taskTitle: "Review exercise",
    });
    await seedSession(db, userId, { gameDay: "2026-11-12", status: "paused" });
    await seedSession(db, userId, {
      gameDay: "2026-11-06",
      minutes: 60,
      taskTitle: "Outside requested week",
    });

    await updateConfig(db, userId, { flags: { ai: true }, ai: { baseUrl: "" } }, "study report privacy test");
    vi.stubEnv("AI_KEY", "test-provider-key");
    vi.stubEnv("AI_BASE_URL", "https://provider.example/v1");
    remoteCall.mockResolvedValue({ value: { reply: "remote response" } });

    const result = await sendCoachMessage(db, userId, "How much did I study last week?", today, "UTC");
    const reply = result.messages.at(-1)?.text ?? "";

    expect(result.provider).toBe("local");
    expect(reply).toContain("2 h");
    expect(reply).toContain("2 completed sessions");
    expect(reply).toContain("Mathematics");
    expect(reply).toContain("Algebra lesson");
    expect(reply).not.toContain("private session note");
    expect(reply).not.toContain("Outside requested week");
    expect(remoteCall).not.toHaveBeenCalled();
  });
});
