import { describe, expect, it } from "vitest";
import * as studyLog from "./studyLog";

const schedule = (evidence: string) => ({
  decision: "schedule" as const,
  reason: "The source contains four distinct concepts worth revisiting.",
  reviews: [0, 1, 2, 3].map((n) => ({ front: `Question ${n + 1}`, back: `Answer ${n + 1}`, evidence })),
});

describe("study-log domain", () => {
  it("calculates fixed review dates with calendar-day arithmetic across leap day", () => {
    expect(studyLog.reviewDatesForStudyDay("2024-02-28")).toEqual([
      { offsetDays: 3, scheduledOn: "2024-03-02" },
      { offsetDays: 7, scheduledOn: "2024-03-06" },
      { offsetDays: 14, scheduledOn: "2024-03-13" },
      { offsetDays: 30, scheduledOn: "2024-03-29" },
    ]);
  });

  it("uses the user's timezone and rollover hour for the default study game day", () => {
    const instant = new Date("2026-11-14T00:30:00Z");
    expect(studyLog.currentStudyGameDay(instant, "Asia/Tehran", 4)).toBe("2026-11-14");
    expect(studyLog.currentStudyGameDay(instant, "America/Los_Angeles", 4)).toBe("2026-11-13");
  });

  it("rejects blank or oversized source and impossible ISO study dates", () => {
    const input = { topic: "BFS", sourceText: " ", studiedOn: "2026-02-28", clientRequestId: "request-001" };
    expect(studyLog.studyLogSubmissionSchema.safeParse(input)).toMatchObject({ success: false });
    expect(studyLog.studyLogSubmissionSchema.safeParse({ ...input, sourceText: "x".repeat(20_001) })).toMatchObject({ success: false });
    expect(studyLog.studyLogSubmissionSchema.safeParse({ ...input, sourceText: "BFS uses a queue.", studiedOn: "2026-02-30" })).toMatchObject({ success: false });
  });

  it("requires exactly four source-backed prompts for a schedule decision", () => {
    const candidate = { ...schedule("BFS uses a queue to explore vertices by distance."), reviews: schedule("BFS uses a queue to explore vertices by distance.").reviews.slice(0, 3) };
    expect(studyLog.studyLogDecisionSchema.safeParse(candidate)).toMatchObject({ success: false });
  });

  it("accepts evidence found after Unicode and whitespace normalization", () => {
    const source = "BFS uses a queue\n to explore vertices by distance.";
    const result = studyLog.validateStudyLogDecision(source, schedule("BFS uses a queue to explore vertices by distance."));
    expect(result).toMatchObject({ decision: "schedule" });
  });

  it("rejects a schedule whose evidence is absent from the submitted source", () => {
    const source = "BFS uses a queue to explore vertices by distance.";
    expect(() => studyLog.validateStudyLogDecision(source, schedule("Depth-first search uses a stack."))).toThrow();
  });
});
