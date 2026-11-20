import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_CONFIG } from "@/config/defaults";
import { levelFromXp, levelUps, titleForLevel, totalXpForLevel, xpToNext } from "./levels";

const cfg = DEFAULT_CONFIG.levels;

describe("level curve (doc 04 §4)", () => {
  it("closed form matches the doc: L=35 → 11,760; L=40 → 14,640", () => {
    expect(totalXpForLevel(35, cfg)).toBe(11_760);
    expect(totalXpForLevel(40, cfg)).toBe(14_640);
  });
  it("first level-up costs 132, level 40→41 costs 612", () => {
    expect(xpToNext(0, cfg)).toBe(132);
    expect(totalXpForLevel(1, cfg)).toBe(132);
    expect(xpToNext(40, cfg)).toBe(612);
  });
  it("levelFromXp boundaries", () => {
    expect(levelFromXp(0, cfg).level).toBe(0);
    expect(levelFromXp(131.99, cfg).level).toBe(0);
    expect(levelFromXp(132, cfg).level).toBe(1);
    expect(levelFromXp(11_760, cfg).level).toBe(35);
    expect(levelFromXp(11_759, cfg).level).toBe(34);
    expect(levelFromXp(-5, cfg).level).toBe(0);
  });
  it("≈80 XP/day for 175 days lands around level 39–40 (design target)", () => {
    const l = levelFromXp(80 * 175, cfg).level;
    expect(l).toBeGreaterThanOrEqual(38);
    expect(l).toBeLessThanOrEqual(40);
  });
  it("progress within level", () => {
    const i = levelFromXp(200, cfg);
    expect(i.level).toBe(1);
    expect(i.xpIntoLevel).toBe(68);
    expect(i.xpForNext).toBe(144);
    expect(i.progress).toBeCloseTo(68 / 144);
  });
  it("titles", () => {
    expect(titleForLevel(0, cfg)).toBe("Wanderer");
    expect(titleForLevel(5, cfg)).toBe("Wanderer");
    expect(titleForLevel(6, cfg)).toBe("Initiate");
    expect(titleForLevel(40, cfg)).toBe("Ascendant");
    expect(titleForLevel(41, cfg)).toBe("Summit-Bound");
  });
  it("levelUps lists every crossed level", () => {
    expect(levelUps(100, 500, cfg)).toEqual([1, 2, 3]);
    expect(levelUps(500, 500, cfg)).toEqual([]);
  });
  it("level is monotonic in XP (property)", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 50_000, noNaN: true }), fc.double({ min: 0, max: 5_000, noNaN: true }), (xp, more) => {
        const a = levelFromXp(xp, cfg);
        const b = levelFromXp(xp + more, cfg);
        return b.level >= a.level && a.xpIntoLevel >= 0 && a.xpIntoLevel < a.xpForNext + 1e-9;
      }),
      { numRuns: 1000 },
    );
  });
});
