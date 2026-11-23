import { describe, expect, it } from "vitest";
import { focusSessions } from "@/db/schema";
import { startFocusInput, view } from "./focus";

describe("focus task title", () => {
  it("accepts a task title when starting a focus session", () => {
    const input = startFocusInput.parse({ kind: "video", taskTitle: "Review chapter 4" });
    expect(input.taskTitle).toBe("Review chapter 4");
  });

  it("includes the selected task title in the synced focus view", () => {
    const session = {
      id: "focus-1",
      kind: "video",
      subjectId: "math",
      chapterId: "math-4",
      status: "running",
      startedAt: "2026-11-23T08:00:00.000Z",
      pausedAt: null,
      pausedMs: 0,
      endedAt: null,
      minutes: null,
      surge: false,
      gameDay: "2026-11-23",
      taskTitle: "Review chapter 4",
    } as typeof focusSessions.$inferSelect;

    expect(view(session, new Date("2026-11-23T08:01:00.000Z")).taskTitle).toBe("Review chapter 4");
  });
});
