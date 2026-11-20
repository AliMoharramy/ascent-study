import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_CONFIG as cfg, mergeConfig } from "@/config/defaults";
import { awardMany, awardXp, effectiveFocusMinutes, emptyDay, seedXp, settleWeeklyShare, type XpActivity } from "./xp";

describe("XP engine — doc 04 §12 example", () => {
  it("12.1: 30 min + 10 tests (7✓ 2✗ 1–) + 2 analysed errors = 12.4 XP", () => {
    const r = awardMany(
      [
        { kind: "focus", minutes: 30 },
        { kind: "tests", correct: 7, wrong: 2 },
        { kind: "error_analyzed", count: 2 },
      ],
      cfg,
    );
    expect(r.awards.map((a) => a.amount)).toEqual([6, 4.4, 2]);
    expect(r.total).toBe(12.4);
  });
});

describe("XP engine — focus time", () => {
  const one = (a: XpActivity, day = emptyDay()) => awardXp(a, day, cfg).awards[0]!;

  it("1 XP per 5 minutes, floored", () => {
    expect(one({ kind: "focus", minutes: 4 }).amount).toBe(0);
    expect(one({ kind: "focus", minutes: 5 }).amount).toBe(1);
    expect(one({ kind: "focus", minutes: 59 }).amount).toBe(11);
  });

  it("keeps 5-minute remainders across sessions of the same day", () => {
    const r = awardMany(
      [
        { kind: "focus", minutes: 3 },
        { kind: "focus", minutes: 3 },
        { kind: "focus", minutes: 4 },
      ],
      cfg,
    );
    expect(r.total).toBe(2);
  });

  it("daily cap 72 (6 h); flagged capApplied", () => {
    const r = awardMany([{ kind: "focus", minutes: 300 }, { kind: "focus", minutes: 120 }], cfg);
    expect(r.awards[0]!.amount).toBe(60);
    expect(r.awards[1]!.amount).toBe(12);
    expect(r.awards[1]!.capApplied).toBe(true);
    expect(r.total).toBe(72);
  });

  it("Surge ×1.2 on the first 90 minutes only", () => {
    expect(effectiveFocusMinutes(60, true, cfg.xp)).toBe(72);
    expect(effectiveFocusMinutes(120, true, cfg.xp)).toBe(138);
    expect(one({ kind: "focus", minutes: 60, surge: true }).amount).toBe(14);
    expect(one({ kind: "focus", minutes: 60, surge: true }).ruleKey).toBe("xp.focus.surge");
  });

  it("manual entry after 24h earns half", () => {
    expect(one({ kind: "focus", minutes: 60, manualLate: true }).amount).toBe(6);
    expect(one({ kind: "tests", correct: 10, wrong: 0, manualLate: true }).amount).toBe(3);
    expect(one({ kind: "focus", minutes: 60, manualLate: true }).reason).toMatch(/manual/);
  });

  it("zero / negative minutes earn nothing", () => {
    expect(one({ kind: "focus", minutes: 0 }).amount).toBe(0);
    expect(one({ kind: "focus", minutes: -10 }).amount).toBe(0);
  });
});

describe("XP engine — tests, analysis, videos, review, forge", () => {
  const total = (acts: XpActivity[]) => awardMany(acts, cfg).total;

  it("tests: 0.6 per correct, 0.1 per wrong; blanks earn nothing", () => {
    expect(total([{ kind: "tests", correct: 10, wrong: 0 }])).toBe(6);
    expect(total([{ kind: "tests", correct: 0, wrong: 10 }])).toBe(1);
  });
  it("tests daily cap 80", () => {
    expect(total([{ kind: "tests", correct: 200, wrong: 0 }])).toBe(80);
  });
  it("analysis is worth more than testing (1.0 each), cap 40", () => {
    expect(total([{ kind: "error_analyzed", count: 3 }])).toBe(3);
    expect(total([{ kind: "error_analyzed", count: 50 }])).toBe(40);
  });
  it("video lesson 5 each, cap 40", () => {
    expect(total([{ kind: "video_lesson" }])).toBe(5);
    expect(total([{ kind: "video_lesson", count: 10 }])).toBe(40);
  });
  it("review card 2 each, cap 30", () => {
    expect(total([{ kind: "review_card", count: 5 }])).toBe(10);
    expect(total([{ kind: "review_card", count: 100 }])).toBe(30);
  });
  it("forge 8 each, cap 24", () => {
    expect(total([{ kind: "forge_artifact", count: 2 }])).toBe(16);
    expect(total([{ kind: "forge_artifact", count: 5 }])).toBe(24);
  });
  it("caps are per bucket — one bucket's cap does not block another", () => {
    expect(total([{ kind: "tests", correct: 200, wrong: 0 }, { kind: "error_analyzed", count: 5 }])).toBe(85);
  });
});

describe("XP engine — chapters, bosses, exams, pillars", () => {
  const total = (acts: XpActivity[]) => awardMany(acts, cfg).total;

  it.each([
    ["M", 60],
    ["S", 42],
    ["C", 24],
  ] as const)("chapter clear tier %s → %d", (tier, xp) => {
    expect(total([{ kind: "chapter_clear", tier }])).toBe(xp);
  });
  it("mini trial 20 + 2×net%", () => expect(total([{ kind: "mini_trial", netPct: 30 }])).toBe(80));
  it("weekly boss 80 + 2×net%", () => expect(total([{ kind: "weekly_boss", netPct: 45 }])).toBe(170));
  it("negative net% never reduces boss XP below base", () => expect(total([{ kind: "weekly_boss", netPct: -10 }])).toBe(80));
  it("mock exam 60 + 3×net%, +100 for beating the Shadow", () => {
    expect(total([{ kind: "mock_exam", netPct: 35 }])).toBe(165);
    const r = awardMany([{ kind: "mock_exam", netPct: 35, beatShadow: true }], cfg);
    expect(r.total).toBe(265);
    expect(r.awards.map((a) => a.ruleKey)).toEqual(["xp.mock_exam", "xp.mock_exam.beat_shadow"]);
  });
  it("pillar quest 10, on-time sleep 15, pillars cap 35", () => {
    expect(total([{ kind: "pillar_quest" }])).toBe(10);
    expect(total([{ kind: "pillar_quest", sleepOnTime: true }])).toBe(15);
    expect(total([{ kind: "pillar_quest" }, { kind: "pillar_quest" }, { kind: "pillar_quest", sleepOnTime: true }, { kind: "pillar_quest" }])).toBe(35);
  });
  it("seed tier = 25% of the standard XP", () => {
    expect(seedXp(20, cfg)).toBe(5);
    expect(seedXp(-3, cfg)).toBe(0);
  });
  it("every award has a rule_key and a reason", () => {
    const r = awardMany([{ kind: "focus", minutes: 25 }, { kind: "tests", correct: 1, wrong: 1 }, { kind: "pillar_quest" }], cfg);
    for (const a of r.awards) {
      expect(a.ruleKey).toMatch(/^xp\./);
      expect(a.reason.length).toBeGreaterThan(0);
    }
  });
  it("config is honoured (owner can change the rules)", () => {
    const c2 = mergeConfig(cfg, { xp: { testCorrect: 1, testsDailyCap: 5 } });
    expect(awardMany([{ kind: "tests", correct: 3, wrong: 0 }], c2).total).toBe(3);
    expect(awardMany([{ kind: "tests", correct: 30, wrong: 0 }], c2).total).toBe(5);
  });
});

describe("weekly study-share rule (≤30% non-study)", () => {
  it("under the share: everything counts", () => {
    expect(settleWeeklyShare(700, 200, cfg)).toEqual({ levelXp: 900, nonStudyCounted: 200, surplusXp: 0, gold: 0 });
  });
  it("over the share: surplus becomes Gold", () => {
    const r = settleWeeklyShare(700, 400, cfg);
    expect(r.nonStudyCounted).toBe(300);
    expect(r.levelXp).toBe(1000);
    expect(r.surplusXp).toBe(100);
    expect(r.gold).toBe(100);
    expect(r.nonStudyCounted / r.levelXp).toBeCloseTo(0.3, 5);
  });
  it("no study at all → no non-study XP counts", () => {
    expect(settleWeeklyShare(0, 50, cfg).levelXp).toBe(0);
  });
});

describe("XP properties", () => {
  const activity = fc.oneof(
    fc.record({ kind: fc.constant("focus" as const), minutes: fc.integer({ min: -30, max: 600 }), surge: fc.boolean(), manualLate: fc.boolean() }),
    fc.record({ kind: fc.constant("tests" as const), correct: fc.integer({ min: 0, max: 300 }), wrong: fc.integer({ min: 0, max: 300 }), manualLate: fc.boolean() }),
    fc.record({ kind: fc.constant("error_analyzed" as const), count: fc.integer({ min: 0, max: 80 }) }),
    fc.record({ kind: fc.constant("video_lesson" as const), count: fc.integer({ min: 0, max: 20 }) }),
    fc.record({ kind: fc.constant("pillar_quest" as const), sleepOnTime: fc.boolean() }),
    fc.record({ kind: fc.constant("weekly_boss" as const), netPct: fc.double({ min: -33, max: 100, noNaN: true }) }),
  );

  it("XP is never negative and capped buckets never exceed their caps", () => {
    fc.assert(
      fc.property(fc.array(activity, { maxLength: 40 }), (acts) => {
        const r = awardMany(acts as XpActivity[], cfg);
        if (r.awards.some((a) => a.amount < 0)) return false;
        const e = r.day.earned;
        return (
          (e.focus ?? 0) <= cfg.xp.focusDailyCap &&
          (e.tests ?? 0) <= cfg.xp.testsDailyCap + 1e-9 &&
          (e.analysis ?? 0) <= cfg.xp.analysisDailyCap &&
          (e.video ?? 0) <= cfg.xp.videoDailyCap &&
          (e.pillars ?? 0) <= cfg.xp.pillarsDailyCap
        );
      }),
      { numRuns: 500 },
    );
  });

  it("splitting focus into sessions never earns more than one long session", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 90 }), { minLength: 1, maxLength: 10 }), (parts) => {
        const split = awardMany(parts.map((m) => ({ kind: "focus" as const, minutes: m })), cfg).total;
        const whole = awardMany([{ kind: "focus", minutes: parts.reduce((a, b) => a + b, 0) }], cfg).total;
        return split === whole;
      }),
    );
  });
});
