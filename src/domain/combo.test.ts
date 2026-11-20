import { describe, expect, it } from "vitest";
import { comboAfter, comboState, isCleanLog, isComboMilestone } from "./combo";

describe("combo meter (F-GM-10)", () => {
  it("counts consecutive clean logs, newest first", () => {
    expect(comboState([{ correct: 10, wrong: 0 }, { correct: 3, wrong: 0 }, { correct: 8, wrong: 1 }]).current).toBe(2);
    expect(comboState([{ correct: 0, wrong: 2 }]).current).toBe(0);
    expect(comboState([]).current).toBe(0);
  });

  it("a clean log needs at least one correct answer", () => {
    expect(isCleanLog({ correct: 0, wrong: 0 })).toBe(false);
    expect(isCleanLog({ correct: 1, wrong: 0 })).toBe(true);
    expect(isCleanLog({ correct: 5, wrong: 1 })).toBe(false);
  });

  it("advances on clean logs and resets on a wrong answer", () => {
    expect(comboAfter(3, { correct: 7, wrong: 0 })).toBe(4);
    expect(comboAfter(3, { correct: 7, wrong: 1 })).toBe(0);
  });

  it("knows its milestones and the next target", () => {
    expect(isComboMilestone(5)).toBe(true);
    expect(isComboMilestone(6)).toBe(false);
    expect(comboState([{ correct: 4, wrong: 0 }]).nextMilestone).toBe(3);
    expect(comboState(Array.from({ length: 10 }, () => ({ correct: 2, wrong: 0 }))).nextMilestone).toBe(15);
  });
});
