import { describe, expect, it } from "vitest";
import {
  boardMissions,
  boardProgress,
  builderBalance,
  builderEligibility,
  builderWeekCredit,
  capWeeklyContract,
  contractAmount,
  explorationBudget,
  explorationSuspended,
  ghostField,
  leagueBaseline,
  leagueOutcome,
  maxStandardRun,
  monthlyProgress,
  monthlyTheme,
  sparkPattern,
  specialNode,
  streakSociety,
  type BoardMetric,
} from "./pillars";
import { applyStoryOverrides, chapterForWeek, rivalEvents, STORY_CHAPTERS } from "./story";

describe("life-pillar rules", () => {
  it("habit contracts are capped per day and per week", () => {
    expect(contractAmount(-4)).toBe(-4);
    expect(contractAmount(-20)).toBe(-8);
    expect(contractAmount(0)).toBe(0);
    expect(capWeeklyContract(-8, [-4, -4, -4])).toEqual([-4, 0, 0]);
    expect(capWeeklyContract(0, [-8, -4])).toEqual([-8, -4]);
  });

  it("exploration is ≤ 10 % of study and suspended in Trials/Arena/Final", () => {
    expect(explorationBudget(600, 30, 20)).toMatchObject({ capMinutes: 60, usedMinutes: 50, over: false });
    expect(explorationBudget(600, 50, 20).over).toBe(true);
    expect(explorationBudget(0, 0, 0).capMinutes).toBe(0);
    expect(explorationSuspended(10).suspended).toBe(false);
    expect(explorationSuspended(20).suspended).toBe(true);
    expect(explorationSuspended(23).suspended).toBe(true);
    expect(explorationSuspended(25).suspended).toBe(true);
  });

  it("Builder Hour needs 70 % / 4 Core days, adds boss+duel hours, respects cap and bank", () => {
    expect(builderEligibility(0.69, 4, 0.7, 4).eligible).toBe(false);
    expect(builderEligibility(0.7, 4, 0.7, 4).eligible).toBe(true);
    expect(builderWeekCredit(true, 0, 0, 180)).toBe(60);
    expect(builderWeekCredit(true, 2, 1, 180)).toBe(180);
    expect(builderWeekCredit(false, 2, 1, 180)).toBe(0);
    expect(builderBalance([{ minutes: 300 }, { minutes: -30 }], 360)).toEqual({ raw: 270, balance: 270 });
    expect(builderBalance([{ minutes: 1000 }], 360).balance).toBe(360);
  });

  it("ghost league is deterministic, median ≈ recent user XP, σ 0.25, and promotes/demotes", () => {
    const a = ghostField(400, "u1:12:3");
    const b = ghostField(400, "u1:12:3");
    expect(a).toEqual(b);
    const median = [...a.map((g) => g.xp)].sort((x, y) => x - y)[4]!;
    expect(Math.abs(median - 400)).toBeLessThanOrEqual(2);
    expect(a.filter((g) => g.ghost).length).toBe(9);
    const high = ghostField(400, "u1:12:3").map((g) => g.xp).sort((x, y) => y - x)[0]!;
    expect(high).toBeGreaterThan(400);
    expect(leagueBaseline([100, 300, 500, 400, 999])).toBe(450);
    expect(leagueOutcome(1, 3)).toBe("promoted");
    expect(leagueOutcome(9, 3)).toBe("demoted");
    expect(leagueOutcome(9, 1)).toBe("stayed");
    expect(leagueOutcome(1, 10)).toBe("stayed");
  });

  it("streak medals need both the streak and 80 % consistency; legendary = round three or hard boss", () => {
    const gold = streakSociety(70, 0.85);
    expect(gold.filter((m) => m.reached).map((m) => m.days)).toEqual([7, 30, 60]);
    expect(streakSociety(100, 0.79).every((m) => !m.reached)).toBe(true);
    expect(specialNode(10, false, false)).toBe("checkpoint");
    expect(specialNode(3, true, false)).toBe("legendary");
    expect(specialNode(3, false, true)).toBe("legendary");
    expect(specialNode(3, false, false)).toBeNull();
  });

  it("monthly themes rotate and Spark patterns need 14 days", () => {
    expect(monthlyTheme("2026-11").key).toBeDefined();
    expect(monthlyTheme("2026-11")).toEqual(monthlyTheme("2026-11"));
    const sparks = Array.from({ length: 13 }, (_, i) => ({ day: `d${i}`, text: "focus at the desk" }));
    expect(sparkPattern(sparks).ready).toBe(false);
    const p = sparkPattern([...sparks, { day: "d14", text: "focus at the desk" }]);
    expect(p.ready).toBe(true);
    expect(p.topWords[0]!.word).toBe("focus");
  });

  it("story has six chapters, each with start and end text, and rival dispatches are stable", () => {
    expect(STORY_CHAPTERS).toHaveLength(6);
    for (const c of STORY_CHAPTERS) {
      expect(c.start.length).toBeGreaterThan(40);
      expect(c.end.length).toBeGreaterThan(40);
    }
    const e1 = rivalEvents({ weekNo: 4, enabled: true, gap: 10, duelsWonThisWeek: 1, nextBoss: "Weekly Boss" });
    const e2 = rivalEvents({ weekNo: 4, enabled: true, gap: 10, duelsWonThisWeek: 1, nextBoss: "Weekly Boss" });
    expect(e1).toEqual(e2);
    expect(e1.map((e) => e.kind)).toEqual(["rival", "bonus"]);
    expect(rivalEvents({ weekNo: 4, enabled: false, gap: 0, duelsWonThisWeek: 0, nextBoss: null })[0]!.title).toMatch(/Shadow rests/);
    expect(chapterForWeek(1).no).toBe(1);
    expect(chapterForWeek(19).no).toBe(2);
    expect(chapterForWeek(20).no).toBe(3);
    expect(chapterForWeek(25).no).toBe(5);
    expect(chapterForWeek(26).no).toBe(6);
    expect(applyStoryOverrides(STORY_CHAPTERS[0]!, [{ chapterNo: 1, startText: "mine", endText: "" }]).start).toBe("mine");
  });

  it("quest board shows three distinct deterministic missions and pays only when all three are done", () => {
    const a = boardMissions("2026-11-16");
    expect(a).toHaveLength(3);
    expect(new Set(a.map((m) => m.key)).size).toBe(3);
    expect(boardMissions("2026-11-16")).toEqual(a);
    const metrics = { tests: 20, errors: 0, cards: 0, core: 1, pages: 0, bonds: 0, body: 0 } as Record<BoardMetric, number>;
    const done = boardProgress(a, Object.fromEntries(Object.keys(metrics).map((k) => [k, 99])) as Record<BoardMetric, number>);
    expect(done.allDone).toBe(true);
    expect(done.gold).toBe(a.reduce((s, m) => s + m.gold, 0));
    expect(boardProgress(a, metrics).allDone).toBe(false);
  });

  it("streak medals use the longest run; monthly challenge progress is capped", () => {
    expect(maxStandardRun([true, true, false, true, true, true])).toBe(3);
    expect(maxStandardRun([])).toBe(0);
    const theme = monthlyTheme("2026-11");
    expect(monthlyProgress(theme, { standardDays: 999, errorAnalyses: 999, duelsWon: 999, builderMinutes: 999 }).done).toBe(true);
    expect(monthlyProgress(theme, { standardDays: 0, errorAnalyses: 0, duelsWon: 0, builderMinutes: 0 }).pct).toBe(0);
  });
});
