import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_CONFIG as cfg } from "@/config/defaults";
import { clearStatus } from "./mastery";
import { duel, nextPace, shadowAccuracy, simulateRival } from "./rival";
import { bossOutcome, distribute, weeklyBossSpec, weeklyThreshold } from "./boss";
import { answerCard, newCard } from "./review";
import { bedOnTime, bodyStep, holdCheck, programTargets, sleepMinutes, wakeOnTime } from "./sleep";
import { ACHIEVEMENTS, detectAnomalies, evaluateAchievements, type PlayerStats } from "./achievements";
import { DEFAULT_HABITS, habitSpecSchema, lifecycle } from "./habits";
import { bestBlocks, goalUpgrade, scoutingA0, topFrictions } from "./baseline";
import { diffDaysIso } from "@/i18n/jalali";

const log = (gameDay: string, correct: number, wrong = 0, blank = 0) => ({ gameDay, correct, wrong, blank, choices: 4 });

describe("chapter clear rule (T-R2-02)", () => {
  it("two passing sessions ≥ 2 days apart clear the chapter", () => {
    const s = clearStatus([log("2026-12-01", 8, 1), log("2026-12-03", 7, 0)], cfg);
    expect(s.cleared).toBe(true);
    expect(s.clearedOn).toBe("2026-12-03");
  });
  it("anti-gaming: same-day cram, tiny sessions, guessing don't clear", () => {
    expect(clearStatus([log("2026-12-01", 8), log("2026-12-01", 8)], cfg).cleared).toBe(false);
    expect(clearStatus([log("2026-12-01", 8), log("2026-12-02", 8)], cfg).cleared).toBe(false);
    expect(clearStatus([log("2026-12-01", 3), log("2026-12-05", 3)], cfg).cleared).toBe(false);
    expect(clearStatus([log("2026-12-01", 6, 4), log("2026-12-05", 6, 4)], cfg).cleared).toBe(false); // 46.7 % net
    expect(clearStatus([log("2026-12-01", 6, 4)], cfg).why).toMatch(/Needs/);
  });
});

describe("Shadow Rival (T-R2-03)", () => {
  it("pace stays in [0.85, 1.10]", () => {
    expect(nextPace(1, 10, cfg)).toBe(1.1);
    expect(nextPace(1, 0, cfg)).toBe(0.85);
  });
  it("property: Shadow never exceeds 110 % of the plan, rests when user is far behind", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.float({ min: 0, max: 20, noNaN: true }), fc.float({ min: 0, max: 30, noNaN: true })), { minLength: 1, maxLength: 25 }), (incs) => {
        let plan = 0;
        let user = 0;
        const weeks = incs.map(([p, u], i) => ({ week: i + 1, planMp: (plan += p), userMp: (user += u) }));
        return simulateRival(weeks, cfg).every((w, i) => w.shadowMp <= weeks[i]!.planMp * 1.1 + 0.01 && w.pace >= 0.85 && w.pace <= 1.1);
      }),
    );
    const lazy = Array.from({ length: 6 }, (_, i) => ({ week: i + 1, planMp: (i + 1) * 10, userMp: 0 }));
    expect(simulateRival(lazy, cfg).some((w) => w.rested)).toBe(true);
  });
  it("accuracy is linear to the target; duel is best of 5", () => {
    expect(shadowAccuracy(1, 10, cfg)).toBe(10);
    expect(shadowAccuracy(24, 10, cfg)).toBe(40); // ADR-0006
    const d = duel({ mp: 14, netPct: 41, analyses: 22, consistency: 0.86, bossPct: 48 }, { mp: 15, netPct: 36, analyses: 18, consistency: 0.8, bossPct: 45 });
    expect(d.score).toEqual([4, 1]);
    expect(d.winner).toBe("user");
  });
});

describe("bosses (T-R2-04)", () => {
  it("threshold rises with level 40 → 55", () => {
    expect(weeklyThreshold(0, cfg)).toBe(40);
    expect(weeklyThreshold(10, cfg)).toBe(45);
    expect(weeklyThreshold(80, cfg)).toBe(55);
  });
  it("spec: 25 questions, 80/20 split, no questions stored — only counts", () => {
    const s = weeklyBossSpec([{ id: "ai-3", weight: 2 }, { id: "ai-4", weight: 1 }], [{ id: "ai-1", weight: 1 }], 0, cfg);
    expect(s.chapters.reduce((a, c) => a + c.questions, 0)).toBe(25);
    expect(s.chapters.find((c) => c.chapterId === "ai-1")!.questions).toBe(5);
    expect(distribute(10, [{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }]).reduce((s, x) => s + x.questions, 0)).toBe(10);
  });
  it("outcome: net %, HP and defeat", () => {
    const o = bossOutcome([{ chapterId: "ai-3", correct: 15, wrong: 3, blank: 2 }, { chapterId: "ai-1", correct: 3, wrong: 1, blank: 1 }], 40);
    expect(o.netPct).toBeCloseTo(66.67, 1);
    expect(o.defeated).toBe(true);
    expect(o.hpLeft).toBe(0);
    expect(bossOutcome([{ chapterId: "x", correct: 5, wrong: 0, blank: 20 }], 40).hpLeft).toBe(50);
  });
});

describe("spaced review ladder", () => {
  it("1, 3, 7, 14, 30; hard steps back; again resets", () => {
    let c = newCard("2026-12-01", cfg);
    expect(c.dueOn).toBe("2026-12-02");
    const days: number[] = [];
    for (let i = 0; i < 6; i++) {
      c = answerCard(c, "good", "2026-12-01", cfg);
      days.push(diffDaysIso(c.dueOn, "2026-12-01"));
    }
    expect(days).toEqual([1, 3, 7, 14, 30, 30]);
    expect(answerCard({ ...c, step: 3 }, "hard", "2026-12-01", cfg).step).toBe(2);
    expect(answerCard(c, "again", "2026-12-01", cfg).dueOn).toBe("2026-12-02");
  });
});

describe("sleep + body (T-R2-09)", () => {
  const night = (date: string, bed: string, wake: string, weekday = 1) => ({ date, bed, wake, weekday });
  it("guard 1: avg < 6h15 → hold; guard 2: spread > 45 min → hold; Friday graced", () => {
    expect(sleepMinutes({ bed: "01:10", wake: "08:24" })).toBe(434);
    const short = [night("a", "01:00", "06:30"), night("b", "01:00", "07:00"), night("c", "01:00", "07:10")];
    expect(holdCheck(short, "07:00", cfg).hold).toBe(true);
    const spread = [night("a", "23:00", "06:00"), night("b", "23:00", "07:00"), night("c", "23:00", "06:10")];
    expect(holdCheck(spread, "06:00", cfg).reasons[0]).toMatch(/varied/);
    const friday = [night("a", "23:00", "06:00"), night("b", "23:00", "06:10"), night("c", "23:00", "06:40", 6)];
    expect(holdCheck(friday, "06:00", cfg).hold).toBe(false);
  });
  it("targets shift 20 min/week from week 2, stop on hold, floor 05:30", () => {
    const t = programTargets("08:24", "01:10", 12, { 3: ["x"] }, cfg);
    expect(t[0]!.wakeTarget).toBe("08:24");
    expect(t[1]!.wakeTarget).toBe("08:04");
    expect(t[2]!.wakeTarget).toBe("08:04"); // held
    expect(t[11]!.wakeTarget).toBe("05:30");
    expect(t[1]!.bedTarget).toBe("00:50");
    expect(wakeOnTime("08:15", "08:04", cfg)).toBe(true);
    expect(bedOnTime("01:20", "00:50", cfg)).toBe(false);
    expect(bodyStep(5, true).minutes).toBe(5); // Seed on hold
    expect(bodyStep(8, false).minutes).toBe(30);
  });
});

describe("achievements, anomalies, habits, baseline", () => {
  it("≥ 20 achievements, unlocked by stats", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    const zero = Object.fromEntries(Object.keys({ chaptersCleared: 0 }).map((k) => [k, 0])) as unknown as PlayerStats;
    const s = { ...Object.fromEntries(ACHIEVEMENTS.map(() => ["x", 0])), ...zero, chaptersCleared: 1, testsTotal: 120 } as PlayerStats;
    const got = evaluateAchievements(s, new Set());
    expect(got).toContain("first_light");
    expect(got).toContain("hundred_tests");
    expect(evaluateAchievements(s, new Set(["first_light"]))).not.toContain("first_light");
  });
  it("anomalies warn only", () => {
    const a = detectAnomalies([{ day: "d", tests: 250, correct: 250, focusMin: 900, manualItems: 3, totalItems: 4 }], cfg);
    expect(a.map((x) => x.rule).sort()).toEqual(["focus_hours", "manual_share", "perfect_accuracy", "tests_per_day"]);
  });
  it("default habits validate; implementation intention enforced", () => {
    for (const h of DEFAULT_HABITS) expect(habitSpecSchema.safeParse(h).success, h.title).toBe(true);
    const bad = habitSpecSchema.safeParse({ title: "Run", pillar: "body", tiers: { seed: "", standard: "run" }, metric: { type: "check" }, status: "trial" });
    expect(bad.success).toBe(false);
    expect(lifecycle("trial", 14, 0)).toBe("active");
    expect(lifecycle("active", 70, 0.85)).toBe("mastered");
  });
  it("baseline helpers", () => {
    expect(bestBlocks([{ startedAtLocal: { weekday: 1, hour: 10 }, minutes: 90 }, { startedAtLocal: { weekday: 1, hour: 11 }, minutes: 30 }, { startedAtLocal: { weekday: 3, hour: 16 }, minutes: 60 }])[0]).toEqual({ weekday: 1, from: 10, to: 12, minutes: 120 });
    expect(topFrictions(["Tired", "tired", "phone", null])[0]).toEqual({ text: "Tired", count: 2 });
    expect(scoutingA0([{ chapterId: "ai-3", correct: 2, wrong: 0, blank: 1, choices: 4 }, { chapterId: "ai-4", correct: 1, wrong: 0, blank: 0, choices: 4 }])).toEqual({ "ai-3": { a0: 0.67, questions: 3 } });
    const up = goalUpgrade({ minutes: 120, tier: "standard", setOn: "2026-11-14" }, "2026-11-15", [true], cfg, diffDaysIso);
    expect(up).toEqual({ suggest: true, minutes: 125, hitRate: 1 });
    const finalStep = goalUpgrade({ minutes: 235, tier: "standard", setOn: "2026-11-14" }, "2026-11-15", [true], cfg, diffDaysIso);
    expect(finalStep).toEqual({ suggest: true, minutes: 240, hitRate: 1 });
    const atCeiling = goalUpgrade({ minutes: 240, tier: "standard", setOn: "2026-11-14" }, "2026-11-15", [true], cfg, diffDaysIso);
    expect(atCeiling).toEqual({ suggest: false, minutes: 240, hitRate: 1 });
  });
});
