import { describe, expect, it } from "vitest";
import { answeredCount, applyMark, clock, examCounts, examNet, suspectCount, type ExamMark } from "./exam";

describe("exam simulator scoring (F-LRN-01)", () => {
  it("computes exact net with negative marking", () => {
    const marks: ExamMark[] = ["correct", "correct", "wrong", "wrong", "blank"];
    expect(examCounts(marks)).toEqual({ correct: 2, wrong: 2, blank: 1 });
    // (2 − 2/3) / 5 = 26.666…%
    expect(examNet(marks)).toBe(26.67);
    expect(answeredCount(marks)).toBe(4);
  });

  it("can go negative and treats an empty sheet as 0", () => {
    expect(examNet(["wrong", "wrong", "wrong", "wrong"])).toBe(-33.33);
    expect(examNet([])).toBe(0);
  });

  it("cycles marks and toggles suspect without touching the answer", () => {
    expect(applyMark("blank", false, "correct")).toEqual({ mark: "correct", suspect: false });
    expect(applyMark("correct", false, "wrong")).toEqual({ mark: "wrong", suspect: false });
    expect(applyMark("wrong", true, "suspect")).toEqual({ mark: "wrong", suspect: false });
    expect(applyMark("correct", false, "suspect")).toEqual({ mark: "correct", suspect: true });
    expect(applyMark("wrong", true, "clear")).toEqual({ mark: "blank", suspect: false });
  });

  it("counts suspect flags independently of correctness", () => {
    expect(suspectCount([true, false, true, true])).toBe(3);
  });

  it("formats the countdown clock", () => {
    expect(clock(0)).toBe("00:00");
    expect(clock(65)).toBe("01:05");
    expect(clock(605)).toBe("10:05");
    expect(clock(-4)).toBe("00:00");
  });
});
