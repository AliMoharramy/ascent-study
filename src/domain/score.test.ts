import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_CONFIG as cfg } from "@/config/defaults";
import { bossScore, comebackRefund, dayPenalties, resetWeekCorrection, weekScore, type Miss } from "./score";

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

describe("Score engine — doc 04 §12 scenarios", () => {
  it("12.2: missed Core without excuse −20, plus missed Fixed −6 (within −40 floor)", () => {
    const e = dayPenalties([{ kind: "core" }, { kind: "fixed" }], { weekPenaltiesSoFar: 0 }, cfg);
    expect(e.map((x) => x.amount)).toEqual([-20, -6]);
    expect(sum(e)).toBe(-26);
  });

  it("12.2b: a terrible day is floored at −40", () => {
    const misses: Miss[] = [{ kind: "core" }, { kind: "fixed" }, { kind: "fixed" }, { kind: "fixed" }, { kind: "pillar" }];
    const e = dayPenalties(misses, { weekPenaltiesSoFar: 0 }, cfg);
    expect(sum(e)).toBe(-40);
    expect(e.at(-1)!.capApplied).toBe(true);
    expect(e.at(-1)!.reason).toMatch(/daily floor/);
  });

  it("12.3: Seed done → no miss → no penalty", () => {
    expect(dayPenalties([], { weekPenaltiesSoFar: 0 }, cfg)).toEqual([]);
  });

  it("12.4: three missed days — Comeback refunds 50% of day 1; days 2–3 floored; no debt carried", () => {
    const day = [{ kind: "core" }, { kind: "fixed" }, { kind: "fixed" }, { kind: "pillar" }] as Miss[];
    const d1 = dayPenalties(day, { weekPenaltiesSoFar: 0 }, cfg);
    expect(sum(d1)).toBe(-36);
    expect(comebackRefund(sum(d1), cfg).amount).toBe(18);
    const d2 = dayPenalties(day, { weekPenaltiesSoFar: sum(d1) }, cfg);
    const d3 = dayPenalties(day, { weekPenaltiesSoFar: sum(d1) + sum(d2) }, cfg);
    expect(sum(d2)).toBe(-36);
    expect(sum(d3)).toBe(-36);
    // each day stands alone: penalties never exceed a single day's floor
    for (const d of [d1, d2, d3]) expect(sum(d)).toBeGreaterThanOrEqual(cfg.score.dailyFloor);
  });

  it("12.5: Reset Week limits the week's penalties to −50", () => {
    expect(resetWeekCorrection(-110, cfg)!.amount).toBe(60);
    expect(resetWeekCorrection(-30, cfg)).toBeNull();
    const e = dayPenalties([{ kind: "core" }, { kind: "core" }], { weekPenaltiesSoFar: -45, weekReset: true }, cfg);
    expect(sum(e)).toBe(-5);
  });
});

describe("Score engine — floors, shields, life events", () => {
  it("weekly floor −120", () => {
    const e = dayPenalties([{ kind: "core" }, { kind: "fixed" }], { weekPenaltiesSoFar: -110 }, cfg);
    expect(sum(e)).toBe(-10);
    expect(e[0]!.reason).toMatch(/weekly floor/);
  });
  it("week already at floor → zero penalties", () => {
    expect(sum(dayPenalties([{ kind: "core" }], { weekPenaltiesSoFar: -120 }, cfg))).toBe(0);
  });
  it("Shield forgives the day", () => {
    const e = dayPenalties([{ kind: "core" }], { weekPenaltiesSoFar: 0, shieldUsed: true }, cfg);
    expect(sum(e)).toBe(0);
    expect(e[0]!.ruleKey).toBe("ss.shield");
  });
  it("Life Event forgives the day", () => {
    expect(dayPenalties([{ kind: "core" }], { weekPenaltiesSoFar: 0, lifeEvent: true }, cfg)[0]!.ruleKey).toBe("ss.life_event");
  });
  it("skipping the Weekly Boss costs −40", () => {
    expect(sum(dayPenalties([{ kind: "weekly_boss" }], { weekPenaltiesSoFar: 0 }, cfg))).toBe(-40);
  });
  it("pillar miss −4", () => {
    expect(sum(dayPenalties([{ kind: "pillar" }], { weekPenaltiesSoFar: 0 }, cfg))).toBe(-4);
  });
  it("boss SS follows net % (negative marking hurts)", () => {
    expect(bossScore(42.5, "weekly_boss").amount).toBe(42.5);
    expect(bossScore(-8, "mock_exam").amount).toBe(-8);
  });
  it("week score = study XP + bosses + penalties + corrections", () => {
    expect(weekScore({ studyXp: 500, bossEntries: 40, penalties: -46, corrections: 10 })).toBe(504);
    expect(weekScore({ studyXp: 0, bossEntries: 0, penalties: -120 })).toBe(-120);
  });
  it("every entry has a rule_key", () => {
    for (const e of dayPenalties([{ kind: "core" }, { kind: "pillar" }], { weekPenaltiesSoFar: 0 }, cfg)) expect(e.ruleKey).toMatch(/^ss\./);
  });
});

describe("Score properties", () => {
  const miss = fc.constantFrom<Miss>({ kind: "core" }, { kind: "fixed" }, { kind: "pillar" }, { kind: "weekly_boss" });

  it("penalties of a week never go below −120 and of a day never below −40", () => {
    fc.assert(
      fc.property(fc.array(fc.array(miss, { maxLength: 8 }), { minLength: 7, maxLength: 7 }), (week) => {
        let weekTotal = 0;
        for (const day of week) {
          const d = sum(dayPenalties(day, { weekPenaltiesSoFar: weekTotal }, cfg));
          if (d < cfg.score.dailyFloor - 1e-9 || d > 0) return false;
          weekTotal += d;
        }
        return weekTotal >= cfg.score.weeklyFloor - 1e-9;
      }),
      { numRuns: 500 },
    );
  });
});
