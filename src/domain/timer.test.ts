import { describe, expect, it } from "vitest";
import { elapsedMs, focusedMinutes, formatClock, pauseTimer, resumeTimer, startTimer, stopTimer, TimerError } from "./timer";

const at = (min: number) => new Date(Date.UTC(2026, 10, 14, 8, 0, 0) + min * 60_000);

describe("focus timer (F-LOG-01)", () => {
  it("start → stop measures wall time", () => {
    const s = stopTimer(startTimer(at(0)), at(30));
    expect(s.status).toBe("ended");
    expect(focusedMinutes(s, at(999))).toBe(30);
  });
  it("paused time is excluded", () => {
    let s = startTimer(at(0));
    s = pauseTimer(s, at(10));
    expect(focusedMinutes(s, at(25))).toBe(10); // frozen while paused
    s = resumeTimer(s, at(25));
    s = stopTimer(s, at(45));
    expect(focusedMinutes(s, at(45))).toBe(30);
    expect(s.pausedMs).toBe(15 * 60_000);
  });
  it("stopping while paused closes the pause", () => {
    let s = pauseTimer(startTimer(at(0)), at(20));
    s = stopTimer(s, at(50));
    expect(focusedMinutes(s, at(50))).toBe(20);
  });
  it("is derived purely from timestamps → survives refresh", () => {
    const s = startTimer(at(0));
    const restored = JSON.parse(JSON.stringify(s));
    expect(elapsedMs(restored, at(12))).toBe(12 * 60_000);
  });
  it("invalid transitions throw", () => {
    const s = startTimer(at(0));
    expect(() => resumeTimer(s, at(1))).toThrow(TimerError);
    const e = stopTimer(s, at(1));
    expect(() => stopTimer(e, at(2))).toThrow(TimerError);
    expect(() => pauseTimer(e, at(2))).toThrow(TimerError);
  });
  it("clock format", () => {
    expect(formatClock(65_000)).toBe("01:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
});
