import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/config/defaults";
import { answerEV, energyPattern, forecastNet, mistakeMining, rankEstimate, skipCurve, skipThreshold, timePerQuestion, weakPoints, whatIf } from "./insights";
import { interleavePick, masteryLevel, pretestA0, roundDates } from "./learning";
import { applySkillPerks, CARD_POOL, drawCard, rushAvailable, secTarget, SEASON_TRACK } from "./extras";
import { shapingSuggestion, sleepDebt } from "./wellness";
import { estimateCost, guardSummary, localAnomalies, localNarrative, localWeeklyReview, reminderText, weeklyReviewSchema } from "./ai";

const cfg = DEFAULT_CONFIG;

describe("forecast + confidence band (#95)", () => {
  it("empty samples → zero forecast, n=0", () => {
    expect(forecastNet([])).toEqual({ pct: 0, lo: 0, hi: 0, n: 0 });
  });
  it("scarce data widens the band by 6 points", () => {
    const one = forecastNet([{ day: "2026-11-14", netPct: 50, questions: 10 }]);
    const many = forecastNet(Array.from({ length: 10 }, (_, i) => ({ day: `2026-11-${14 + i}`, netPct: 50, questions: 10 })));
    expect(one.hi - one.lo).toBeGreaterThan(many.hi - many.lo);
    expect(one.hi - one.lo).toBeGreaterThanOrEqual(20);
  });
  it("recent days weigh more than old days", () => {
    const f = forecastNet([
      { day: "2026-11-01", netPct: 10, questions: 10 },
      { day: "2026-11-20", netPct: 70, questions: 10 },
    ]);
    expect(f.pct).toBeGreaterThan(40);
    expect(f.lo).toBeLessThanOrEqual(f.pct);
    expect(f.hi).toBeGreaterThanOrEqual(f.pct);
  });
});

describe("energy pattern (#95)", () => {
  it("weights minutes by local hour and reports top-3 peaks", () => {
    const { heat, peaks } = energyPattern(
      [
        { startedAt: "2026-11-14T06:30:00Z", minutes: 60 }, // 10:00 Tehran
        { startedAt: "2026-11-15T06:45:00Z", minutes: 30 }, // 10:15 Tehran
        { startedAt: "2026-11-14T18:00:00Z", minutes: 20 }, // 21:30 Tehran
      ],
      "Asia/Tehran",
    );
    expect(heat[10]).toBe(90);
    expect(heat[21]).toBe(20);
    expect(peaks[0]).toBe(10);
    expect(peaks.length).toBeLessThanOrEqual(3);
  });
  it("no sessions → no peaks", () => {
    expect(energyPattern([], "Asia/Tehran").peaks).toEqual([]);
  });
});

describe("weak-point hunter + mistake mining (#95, #100)", () => {
  it("uncleared low-net chapters with repeated errors rank first", () => {
    const rows = weakPoints([
      { chapterId: "a", subjectId: "s", netPct: 80, errors: 0, cleared: true },
      { chapterId: "b", subjectId: "s", netPct: 20, errors: 3, cleared: false },
      { chapterId: "c", subjectId: "s", netPct: null, errors: 0, cleared: false },
    ]);
    expect(rows[0]!.chapterId).toBe("b");
    expect(rows[0]!.mission).toContain("25-min");
    expect(rows.length).toBeLessThanOrEqual(10);
  });
  it("mining counts causes and keeps only repeated non-stopword concepts", () => {
    const m = mistakeMining([
      { cause: "concept", chapterId: null, subjectId: null, takeaway: "limit of a sequence forgot the definition" },
      { cause: "concept", chapterId: null, subjectId: null, takeaway: "the limit again — sequence definition mixed up" },
      { cause: "careless", chapterId: null, subjectId: null, takeaway: "sign error" },
    ]);
    expect(m.causes[0]).toEqual({ cause: "concept", count: 2 });
    const words = m.concepts.map((c) => c.word);
    expect(words).toContain("limit");
    expect(words).toContain("sequence");
    expect(words).not.toContain("the");
    expect(words).not.toContain("sign"); // appears once
  });
});

describe("time-per-question + skip strategy (#100)", () => {
  it("ignores untimed logs and averages seconds per question", () => {
    const t = timePerQuestion([
      { seconds: 600, correct: 6, wrong: 2, blank: 2 },
      { seconds: null, correct: 9, wrong: 0, blank: 0 },
      { seconds: 0, correct: 5, wrong: 5, blank: 0 },
    ]);
    expect(t.secPerQ).toBe(60);
    expect(t.slow).toBe(false);
  });
  it("no timed questions → null, not NaN", () => {
    expect(timePerQuestion([{ seconds: null, correct: 3, wrong: 1, blank: 0 }]).secPerQ).toBeNull();
  });
  it("EV break-even is exactly 25 % with 4 choices and negative marking", () => {
    expect(skipThreshold(4)).toBe(0.25);
    expect(answerEV(0.25)).toBeCloseTo(0, 10);
    expect(answerEV(1)).toBe(1);
    expect(answerEV(0)).toBeCloseTo(-1 / 3, 10);
    const curve = skipCurve(4);
    expect(curve[0]!.ev).toBe(-0.333);
    expect(curve[curve.length - 1]!.ev).toBe(1);
  });
});

describe("what-if planner + rank estimate (#99)", () => {
  const rows = [
    { chapterId: "m1", tier: "M" as const, plannedMin: 100 },
    { chapterId: "m2", tier: "M" as const, plannedMin: 100 },
    { chapterId: "s1", tier: "S" as const, plannedMin: 50 },
  ];
  it("dropping a Must chapter cuts coverage and the forecast transparently", () => {
    const w = whatIf(rows, ["m1"], [], 50);
    expect(w.minutes).toBe(150);
    expect(w.deltaMin).toBe(-100);
    expect(w.coverage).toBe(0.5);
    expect(w.forecast).toBe(40);
  });
  it("adding chapters raises load without touching base coverage", () => {
    const w = whatIf(rows, [], [{ chapterId: "m3", tier: "M", plannedMin: 80 }], 50);
    expect(w.minutes).toBe(330);
    expect(w.coverage).toBe(1.5);
    expect(w.forecast).toBe(60);
  });
  it("rank curve is monotone, clamped at both ends, with a widening band", () => {
    const lo = rankEstimate(5, cfg.rank);
    const mid = rankEstimate(55, cfg.rank);
    const hi = rankEstimate(95, cfg.rank);
    expect(lo.rank).toBe(6000);
    expect(hi.rank).toBe(10);
    expect(mid.rank).toBeLessThan(lo.rank);
    expect(mid.rank).toBeGreaterThan(hi.rank);
    expect(mid.lo).toBeLessThan(mid.rank);
    expect(mid.hi).toBeGreaterThan(mid.rank);
    expect(mid.assumed).toBe(true);
  });
});

describe("mastery + pretest + interleaving + scheduler (#89)", () => {
  it("five levels ladder from Seen to Legendary", () => {
    const base = { hasStudy: false, hasPassing: false, cleared: false, round3Done: false, pretested: false };
    expect(masteryLevel(base)).toBe(0);
    expect(masteryLevel({ ...base, hasStudy: true })).toBe(1);
    expect(masteryLevel({ ...base, hasPassing: true })).toBe(2);
    expect(masteryLevel({ ...base, pretested: true })).toBe(2);
    expect(masteryLevel({ ...base, cleared: true })).toBe(3);
    expect(masteryLevel({ ...base, cleared: true, round3Done: true })).toBe(4);
  });
  it("pretest a0 is accuracy × weight, clamped to [0,1]", () => {
    expect(pretestA0(2, 4, 0.5)).toBe(0.25);
    expect(pretestA0(0, 3, 0.5)).toBe(0);
    expect(pretestA0(3, 3, 2)).toBe(1);
  });
  it("interleave pick spans up to 3 different subjects", () => {
    const chapters = [
      { id: "a1", subjectId: "math" },
      { id: "a2", subjectId: "math" },
      { id: "b1", subjectId: "bio" },
      { id: "c1", subjectId: "chem" },
      { id: "d1", subjectId: "phys" },
    ];
    for (const seed of [1, 2, 7, 25]) {
      const picked = interleavePick(chapters, seed);
      expect(picked.length).toBe(3);
      expect(new Set(picked.map((p) => p.subjectId)).size).toBe(3);
    }
    expect(interleavePick(chapters.slice(0, 2), 1).length).toBe(1);
  });
  it("round 2/3 dates chain from round 1 completion", () => {
    expect(roundDates("2026-11-14", 7, 21)).toEqual({ round2: "2026-11-21", round3: "2026-12-12" });
  });
});

describe("skill perks, season track, card draw, rush gate (#87, #91)", () => {
  it("perks fold into config: surge window and review cap", () => {
    const next = applySkillPerks(cfg, [
      { skillId: "focus", tier: 2 },
      { skillId: "review", tier: 1 },
    ]);
    expect(next.xp.surgeMaxMinutes).toBe(cfg.xp.surgeMaxMinutes + 20);
    expect(next.xp.reviewDailyCap).toBe(cfg.xp.reviewDailyCap + 5);
    expect(secTarget([{ skillId: "speed", tier: 3 }])).toBe(60);
  });
  it("season track is 25 free stops with bigger chests every 5th week", () => {
    expect(SEASON_TRACK.length).toBe(25);
    expect(SEASON_TRACK[4]!.gems).toBeGreaterThan(SEASON_TRACK[0]!.gems);
    expect(SEASON_TRACK.every((s) => s.gold > 0)).toBe(true);
  });
  it("weekly card draw is deterministic per user+week and stays in the pool", () => {
    const a = drawCard("user-1", 3);
    expect(drawCard("user-1", 3)).toEqual(a);
    expect(CARD_POOL).toContainEqual(a);
    expect(drawCard("user-2", 3).id).not.toBe("");
  });
  it("Boss Rush only opens in week 25 or the last 7 days, and only when enabled", () => {
    expect(rushAvailable(25, 100, true)).toBe(true);
    expect(rushAvailable(20, 7, true)).toBe(true);
    expect(rushAvailable(20, 8, true)).toBe(false);
    expect(rushAvailable(25, 100, false)).toBe(false);
  });
});

describe("sleep debt + habit shaping (#88, #96)", () => {
  it("debt sums only the last 7 logged nights, never future ones", () => {
    const d = sleepDebt(
      [
        { date: "2026-11-16", minutes: 360 }, // 2 h short
        { date: "2026-11-10", minutes: 420 }, // 1 h short
        { date: "2026-11-09", minutes: 60 }, // outside window
        { date: "2026-11-17", minutes: 60 }, // future
      ],
      8,
      "2026-11-16",
    );
    expect(d.logged).toBe(2);
    expect(d.debtHours).toBe(3);
  });
  it("shaping waits for 7 consecutive successful days", () => {
    const days = Array.from({ length: 6 }, (_, i) => `2026-11-${10 + i}`);
    expect(shapingSuggestion(days, "2026-11-15", 20).propose).toBeNull();
    const seven = [...days, "2026-11-16"];
    expect(shapingSuggestion(seven, "2026-11-16", 20)).toEqual({ streak: 7, propose: 21 });
  });
  it("step is +5 % but at least +1; check habits never propose", () => {
    const seven = Array.from({ length: 7 }, (_, i) => `2026-11-${10 + i}`);
    expect(shapingSuggestion(seven, "2026-11-16", 10).propose).toBe(11);
    expect(shapingSuggestion(seven, "2026-11-16", 100).propose).toBe(105);
    expect(shapingSuggestion(seven, "2026-11-16", null).propose).toBeNull();
  });
  it("a broken streak resets the count", () => {
    const days = ["2026-11-16", "2026-11-15", "2026-11-13"];
    expect(shapingSuggestion(days, "2026-11-16", 20).streak).toBe(2);
  });
});

describe("AI guard + local provider (#92–#94, #97)", () => {
  it("guard strips names and free text, keeps only aggregates, caps causes at 6", () => {
    const g = guardSummary({ weekNo: 2, hours: 10, xp: 500, testsNet: 44, consistency: 0.8, sleepAvgHours: 7, name: "Ali", notes: "private diary", topCauses: Array.from({ length: 9 }, (_, i) => ({ cause: `c${i}`, count: i })) });
    expect(g).not.toHaveProperty("name");
    expect(g).not.toHaveProperty("notes");
    expect(g.topCauses.length).toBe(6);
  });
  it("cost estimate uses per-1k prices", () => {
    expect(estimateCost(1000, 1000, cfg.ai)).toBe(Math.round((cfg.ai.pricePer1kIn + cfg.ai.pricePer1kOut) * 10000) / 10000);
  });
  it("local weekly review satisfies the same schema as remote output", () => {
    const s = guardSummary({ weekNo: 2, hours: 9, xp: 400, testsNet: 35, consistency: 0.5, sleepAvgHours: 6, topCauses: [{ cause: "concept", count: 4 }] });
    const r = localWeeklyReview(s, [{ cause: "concept", count: 4, concepts: ["limit"] }]);
    expect(() => weeklyReviewSchema.parse(r)).not.toThrow();
    expect(r.oneChange).toContain("concept");
    expect(r.errorGroups[0]!.mission).toContain("limit");
  });
  it("anomaly alerts are informational, never punitive", () => {
    const a = localAnomalies({ perfectAccuracy: true, overHours: true, manualShare: false, testsFlood: false });
    expect(a.alerts.length).toBe(2);
    expect(a.alerts.every((x) => /no penalty|nothing is deducted|never|part of the plan|protect/i.test(x.message))).toBe(true);
    expect(localAnomalies({ perfectAccuracy: false, overHours: false, manualShare: false, testsFlood: false }).alerts).toEqual([]);
  });
  it("reminder tones differ but never blame", () => {
    const calm = reminderText("Morning walk", "calm");
    const playful = reminderText("Morning walk", "playful");
    const direct = reminderText("Morning walk", "direct");
    expect(new Set([calm.title, playful.title, direct.title]).size).toBe(3);
    for (const t of [calm, playful, direct]) expect(t.body).not.toMatch(/fail|lazy|must|should have/i);
  });
  it("local narrative stays inside the schema limits", () => {
    const n = localNarrative({ chapterNo: 3, cleared: 10, total: 120, weekNo: 4 });
    expect(n.text.length).toBeLessThanOrEqual(900);
    expect(n.title).toContain("Chapter 3");
  });
});