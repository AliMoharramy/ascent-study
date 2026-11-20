import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG as cfg } from "@/config/defaults";
import { addDaysIso } from "@/i18n/jalali";
import { dayCapacityMinutes, focusFactor, rawWeeklyHours, SAMPLE_WINDOWS, scenarios, weekCapacityHours, weekdaySat } from "./capacity";
import { checkOverride, runTriage, type TriageChapter } from "./triage";
import { burnGap, plan, rebalance, todayCore, weekPhase, type PlanChapter, type PlanWeek } from "./planner";

describe("capacity (T-R1-07)", () => {
  it("sample week = 45h raw, base ≈ 30h, three scenarios", () => {
    expect(rawWeeklyHours(SAMPLE_WINDOWS)).toBe(45);
    const s = scenarios(SAMPLE_WINDOWS, cfg);
    expect(s.map((x) => x.key)).toEqual(["cautious", "base", "optimistic"]);
    expect(Math.round(s[1]!.hours)).toBe(29);
    expect(s[0]!.hours).toBeLessThan(26);
    expect(s[2]!.hours).toBeGreaterThan(35);
  });
  it("moving factor over 3 weeks, default when no data", () => {
    expect(focusFactor([], cfg)).toEqual({ factor: 0.65, source: "default", weeks: 0 });
    const f = focusFactor([{ focusMinutes: 100, rawMinutes: 1000 }, { focusMinutes: 1200, rawMinutes: 2700 }, { focusMinutes: 1500, rawMinutes: 2700 }, { focusMinutes: 1350, rawMinutes: 2700 }], cfg);
    expect(f.weeks).toBe(3);
    expect(f.factor).toBe(0.5);
  });
  it("weekday mapping, exceptions and life events", () => {
    expect(weekdaySat("2026-11-14")).toBe(0); // Saturday
    expect(weekdaySat("2026-11-20")).toBe(6); // Friday
    expect(dayCapacityMinutes("2026-11-15", SAMPLE_WINDOWS, [], 1)).toBe(420);
    expect(dayCapacityMinutes("2026-11-15", SAMPLE_WINDOWS, [{ date: "2026-11-15", minutes: 60 }], 0.5)).toBe(30);
    expect(dayCapacityMinutes("2026-11-15", SAMPLE_WINDOWS, [], 1, { lifeEvent: true })).toBe(0);
    expect(weekCapacityHours("2026-11-14", SAMPLE_WINDOWS, [], 1, addDaysIso)).toBe(45);
  });
});

const ch = (subjectId: string, no: number, eq: number, extra: Partial<TriageChapter> = {}): TriageChapter => ({ id: `${subjectId}-${no}`, subjectId, no, eq, a0: null, hours: 4, ...extra });

describe("triage (T-R1-08, doc 03 §6)", () => {
  it("ROI ordering fills M to ~70% of Eq, then S, then C; optional → C", () => {
    const chapters = [ch("ai", 1, 0.5), ch("ai", 2, 0.25), ch("ai", 3, 0.15), ch("ai", 4, 0.1), ch("ai", 5, 0.05, { optional: true })];
    const { results } = runTriage(chapters, [], cfg);
    const t = Object.fromEntries(results.map((r) => [r.id, r.tier]));
    expect(t).toEqual({ "ai-1": "M", "ai-2": "M", "ai-3": "S", "ai-4": "C", "ai-5": "C" });
    expect(results[0]!.why).toMatch(/ROI/);
  });
  it("a0 lowers ROI: a mastered chapter drops a tier", () => {
    const { results } = runTriage([ch("x", 1, 0.3, { a0: 0.8 }), ch("x", 2, 0.35), ch("x", 3, 0.35)], [], cfg);
    expect(results.find((r) => r.id === "x-1")!.tier).not.toBe("M");
  });
  it("locked overrides stay; prereq of M is raised out of C with a reason, locked C warns", () => {
    const chapters = [ch("a", 1, 0.9), ch("b", 1, 0.95), ch("b", 2, 0.05)];
    const prereqs = [{ chapterId: "a-1", requires: "b-2" }];
    const r = runTriage(chapters, prereqs, cfg);
    expect(r.results.find((x) => x.id === "b-2")!.tier).toBe("S");
    expect(r.results.find((x) => x.id === "b-2")!.why).toMatch(/prerequisite/);
    const locked = runTriage([ch("a", 1, 0.9), ch("b", 1, 0.95), ch("b", 2, 0.05, { lockedTier: "C" })], prereqs, cfg);
    expect(locked.warnings[0]).toMatch(/prerequisite/);
  });
  it("override needs a reason and warns on M→C prereq", () => {
    const cur = new Map([["a-1", "M" as const]]);
    expect(checkOverride("b-2", "C", "", cur, [{ chapterId: "a-1", requires: "b-2" }]).ok).toBe(false);
    expect(checkOverride("b-2", "C", "too long", cur, [{ chapterId: "a-1", requires: "b-2" }]).warnings).toHaveLength(1);
  });
});

const weeks: PlanWeek[] = Array.from({ length: 25 }, (_, i) => ({ no: i + 1, startsOn: addDaysIso("2026-11-14", i * 7), capacityH: 30 }));
const pc = (id: string, subjectId: string, tier: "M" | "S" | "C", phase: number, h: number): PlanChapter => ({ id, subjectId, no: Number(id.split("-")[1]), tier, phase, hoursRemaining: h });

describe("planner", () => {
  it("phases and load ratio ≤ 0.9 when filling", () => {
    expect(weekPhase(1).key).toBe("awakening");
    expect(weekPhase(9).realm).toBe(2);
    expect(weekPhase(25).key).toBe("final");
    const r = plan(weeks, [pc("ai-1", "ai", "M", 1, 20), pc("discrete-1", "discrete", "M", 1, 10), pc("ai-2", "ai", "S", 1, 5)], cfg);
    expect(r.items.filter((i) => i.week === 2).map((i) => i.chapterId)).toEqual(["ai-1", "discrete-1"]);
    expect(r.items.every((i) => i.week >= 2 && i.week <= 6)).toBe(true);
    expect(r.weeks.every((w) => w.loadRatio <= 0.9)).toBe(true);
    expect(r.overflow).toEqual([]);
  });
  it("behind scenario: rebalance drops C, no debt, suggests S→C", () => {
    const big = [...Array.from({ length: 8 }, (_, i) => pc(`ai-${i + 1}`, "ai", i < 5 ? "M" : i < 7 ? "S" : "C", 1, 60))];
    const r = rebalance(weeks, big, 5, cfg);
    expect(r.droppedC).toContain("ai-8");
    expect(r.items.every((i) => i.week >= 5)).toBe(true);
    expect(r.suggestions[0]).toMatch(/S chapters to C/);
    const g = burnGap(big, weeks, 5, cfg);
    expect(g.gapH).toBeGreaterThan(0);
  });
  it("today core sized to capacity; zero capacity → Seed only", () => {
    const items = plan(weeks, [pc("ai-1", "ai", "M", 1, 10)], cfg).items.filter((i) => i.week === 2);
    const c = todayCore(items, {}, 300, 5, cfg);
    expect(c.chapterId).toBe("ai-1");
    expect(c.standardMin).toBe(120);
    expect(c.stretchMin).toBe(150);
    expect(todayCore(items, {}, 0, 5, cfg).standardMin).toBe(5);
    expect(todayCore(items, { "ai-1": 999 }, 300, 5, cfg).chapterId).toBeNull();
  });
});
