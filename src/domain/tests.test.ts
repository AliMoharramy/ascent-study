import { describe, expect, it } from "vitest";
import { accuracy, aggregateNetPct, netPct, validateCounts } from "./tests";

describe("net percentage (F-LOG-03)", () => {
  it("4-choice: each wrong cancels 1/3 correct", () => {
    expect(netPct({ correct: 7, wrong: 2, blank: 1 })).toBe(63.33);
    expect(netPct({ correct: 10, wrong: 0, blank: 0 })).toBe(100);
    expect(netPct({ correct: 0, wrong: 0, blank: 10 })).toBe(0);
    expect(netPct({ correct: 0, wrong: 3, blank: 0 })).toBe(-33.33);
    expect(netPct({ correct: 3, wrong: 9, blank: 0 })).toBe(0);
  });
  it("other choice counts", () => {
    expect(netPct({ correct: 5, wrong: 5, blank: 0, choices: 5 })).toBe(37.5);
    expect(netPct({ correct: 5, wrong: 5, blank: 0, choices: 2 })).toBe(0);
  });
  it("zero total → 0", () => expect(netPct({ correct: 0, wrong: 0, blank: 0 })).toBe(0));
  it("accuracy over attempted", () => expect(accuracy({ correct: 3, wrong: 1, blank: 6 })).toBe(75));
  it("aggregate is question-weighted", () => {
    expect(aggregateNetPct([{ correct: 10, wrong: 0, blank: 0 }, { correct: 0, wrong: 0, blank: 10 }])).toBe(50);
  });
  it("validation", () => {
    expect(validateCounts({ correct: 1, wrong: 0, blank: 0 })).toBeNull();
    expect(validateCounts({ correct: 0, wrong: 0, blank: 0 })).toMatch(/at least one/);
    expect(validateCounts({ correct: -1, wrong: 0, blank: 0 })).toMatch(/correct/);
    expect(validateCounts({ correct: 1.5, wrong: 0, blank: 0 })).toMatch(/correct/);
    expect(validateCounts({ correct: 1, wrong: 0, blank: 0, choices: 1 })).toMatch(/choices/);
  });
});
