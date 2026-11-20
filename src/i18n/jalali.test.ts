import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  formatJalali,
  isLeapJalaliYear,
  isoToJalali,
  jalaliMonthLength,
  jalaliToIso,
  toEnDigits,
  toFaDigits,
  toGregorian,
  toJalali,
  weekStartSaturday,
  weekdayIndexSatFirst,
} from "./jalali";

describe("jalali conversion", () => {
  it("project start: 1405-08-22 ↔ 2026-11-13 (F-CORE-03 AC)", () => {
    expect(isoToJalali("2026-11-13")).toBe("1405-08-22");
    expect(jalaliToIso("1405-08-22")).toBe("2026-11-13");
  });

  it("exam day: 1406-02-17 ↔ 2027-05-07", () => {
    expect(jalaliToIso("1406-02-17")).toBe("2027-05-07");
    expect(isoToJalali("2027-05-07")).toBe("1406-02-17");
  });

  it.each([
    ["2024-03-20", "1403-01-01"],
    ["2025-03-21", "1404-01-01"],
    ["2026-03-21", "1405-01-01"],
    ["2027-03-21", "1406-01-01"],
    ["2025-03-20", "1403-12-30"], // 1403 is leap
    ["2000-01-01", "1378-10-11"],
    ["1979-02-11", "1357-11-22"],
  ])("%s → %s", (g, j) => {
    expect(isoToJalali(g)).toBe(j);
    expect(jalaliToIso(j)).toBe(g);
  });

  it("leap years", () => {
    expect(isLeapJalaliYear(1399)).toBe(true);
    expect(isLeapJalaliYear(1403)).toBe(true);
    expect(isLeapJalaliYear(1404)).toBe(false);
    expect(isLeapJalaliYear(1405)).toBe(false);
    expect(jalaliMonthLength(1405, 12)).toBe(29);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1405, 1)).toBe(31);
    expect(jalaliMonthLength(1405, 7)).toBe(30);
  });

  it("rejects invalid dates", () => {
    expect(() => toGregorian(1405, 12, 30)).toThrow();
    expect(() => toGregorian(1405, 13, 1)).toThrow();
  });

  it("round-trips every day 1990–2040 (property)", () => {
    const start = Date.UTC(1990, 0, 1);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 365 * 50 }), (offset) => {
        const d = new Date(start + offset * 86_400_000);
        const j = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
        const g = toGregorian(j.jy, j.jm, j.jd);
        return g.gy === d.getUTCFullYear() && g.gm === d.getUTCMonth() + 1 && g.gd === d.getUTCDate();
      }),
      { numRuns: 2000 },
    );
  });
});

describe("weeks start on Saturday", () => {
  it("2026-11-13 is a Friday → index 6; week starts 2026-11-07", () => {
    expect(weekdayIndexSatFirst("2026-11-13")).toBe(6);
    expect(weekStartSaturday("2026-11-13")).toBe("2026-11-07");
    expect(weekStartSaturday("2026-11-14")).toBe("2026-11-14");
  });
});

describe("formatting & digits", () => {
  it("formats", () => {
    expect(formatJalali("2026-11-13")).toBe("22 Aban 1405");
    expect(formatJalali("2026-11-13", "fa")).toBe("۲۲ آبان ۱۴۰۵");
  });
  it("digits", () => {
    expect(toFaDigits(1405)).toBe("۱۴۰۵");
    expect(toEnDigits("۱۲٣")).toBe("123");
  });
});
