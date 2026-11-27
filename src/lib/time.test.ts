import { describe, expect, it } from "vitest";
import { gameDay, gameDayBounds, localParts, localToUtc } from "./time";

describe("time / game day", () => {
  it("Tehran is UTC+03:30", () => {
    expect(localParts(new Date("2026-11-13T20:30:00Z")).date).toBe("2026-11-14");
    expect(localParts(new Date("2026-11-13T20:30:00Z")).hour).toBe(0);
  });

  it("activity at 01:30 Tehran belongs to the previous game day (rollover 04:00)", () => {
    // 2026-11-14 01:30 Tehran = 2026-11-13 22:00 UTC
    expect(gameDay(new Date("2026-11-13T22:00:00Z"))).toBe("2026-11-13");
    // 04:00 Tehran = 00:30 UTC → new day
    expect(gameDay(new Date("2026-11-14T00:30:00Z"))).toBe("2026-11-14");
    expect(gameDay(new Date("2026-11-14T00:29:00Z"))).toBe("2026-11-13");
  });

  it("uses local wall-clock rollover through a daylight-saving transition", () => {
    expect(gameDay(new Date("2026-03-08T07:30:00Z"), "America/New_York", 4)).toBe("2026-03-07");
    expect(gameDay(new Date("2026-03-08T08:30:00Z"), "America/New_York", 4)).toBe("2026-03-08");
  });

  it("ends game-day bounds at the next local rollover through DST changes", () => {
    const springForward = gameDayBounds("2026-03-07", "America/New_York", 4);
    expect(springForward.start.toISOString()).toBe("2026-03-07T09:00:00.000Z");
    expect(springForward.end.toISOString()).toBe("2026-03-08T08:00:00.000Z");

    const fallBack = gameDayBounds("2026-10-31", "America/New_York", 4);
    expect(fallBack.start.toISOString()).toBe("2026-10-31T08:00:00.000Z");
    expect(fallBack.end.toISOString()).toBe("2026-11-01T09:00:00.000Z");
  });

  it("moves a skipped local rollover forward through the spring gap", () => {
    expect(localToUtc("2026-03-29", "02:00", "Europe/Paris").toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });

  it("localToUtc and bounds", () => {
    expect(localToUtc("2026-11-14", "04:00").toISOString()).toBe("2026-11-14T00:30:00.000Z");
    const b = gameDayBounds("2026-11-14");
    expect(b.start.toISOString()).toBe("2026-11-14T00:30:00.000Z");
    expect(b.end.toISOString()).toBe("2026-11-15T00:30:00.000Z");
  });
});
