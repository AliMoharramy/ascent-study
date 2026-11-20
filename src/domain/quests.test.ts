import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG as cfg } from "@/config/defaults";
import { advanceStreak, canUseShield, closeDay, comebackSettlement, consistencyRate, emptyStreak, lifeEventAllowed, rollLoot, selectDailyQuests, threeTier, tierReached, type QuestSpec } from "./quests";
import { resetWeekCorrection } from "./score";
import { seedXp } from "./xp";

const spec = (kind: QuestSpec["kind"], title = kind): QuestSpec => ({ kind, title, tiers: { seed: "s", standard: "m", stretch: "x" }, target: threeTier("minutes", 60, 5, cfg) });

describe("quests (T-R1-06, doc 04 §12)", () => {
  it("three tiers: seed 5, standard 60, stretch +25%", () => {
    const t = threeTier("minutes", 60, 5, cfg);
    expect(t).toEqual({ metric: "minutes", seed: 5, standard: 60, stretch: 75 });
    expect(tierReached(t, 3)).toBeNull();
    expect(tierReached(t, 5)).toBe("seed");
    expect(tierReached(t, 61)).toBe("standard");
    expect(tierReached(t, 80)).toBe("stretch");
  });

  it("max 5 active quests, core first", () => {
    const r = selectDailyQuests([spec("pillar"), spec("pillar"), spec("pillar"), spec("fixed"), spec("fixed"), spec("core")], cfg);
    expect(r.active).toHaveLength(5);
    expect(r.active[0]!.kind).toBe("core");
    expect(r.waiting).toHaveLength(1);
  });

  it("scenario 2: core + fixed missed → −26, more misses floored at −40", () => {
    const r = closeDay({ quests: [{ kind: "core", title: "c", tierDone: null }, { kind: "fixed", title: "f", tierDone: null }], weekPenaltiesSoFar: 0 }, cfg);
    expect(r.penaltyTotal).toBe(-26);
    expect(r.missedCore).toBe(true);
    const r2 = closeDay(
      { quests: [{ kind: "core", title: "c", tierDone: null }, { kind: "fixed", title: "f", tierDone: null }, { kind: "fixed", title: "g", tierDone: null }, { kind: "pillar", title: "p", tierDone: null }, { kind: "pillar", title: "q", tierDone: null }], weekPenaltiesSoFar: 0 },
      cfg,
    );
    expect(r2.penaltyTotal).toBe(-40);
  });

  it("scenario 3: Seed done → no penalty, XP 25%", () => {
    const r = closeDay({ quests: [{ kind: "core", title: "c", tierDone: "seed" }], weekPenaltiesSoFar: 0 }, cfg);
    expect(r.penaltyTotal).toBe(0);
    expect(r.seedDay).toBe(true);
    expect(r.standardDay).toBe(false);
    expect(seedXp(10, cfg)).toBe(2.5);
  });

  it("scenario 4: three missed days — comeback refunds 50%, each day floored, no debt carried", () => {
    let week = 0;
    const days = [0, 1, 2].map(() => {
      const r = closeDay({ quests: [{ kind: "core", title: "c", tierDone: null }, { kind: "fixed", title: "f", tierDone: null }, { kind: "fixed", title: "g", tierDone: null }, { kind: "pillar", title: "p", tierDone: null }], weekPenaltiesSoFar: week }, cfg);
      week += r.penaltyTotal;
      return r;
    });
    expect(days.every((d) => d.penaltyTotal >= -40)).toBe(true);
    expect(days[0]!.penaltyTotal).toBe(-36);
    expect(comebackSettlement(days[0]!.penaltyTotal, "seed", cfg)!.amount).toBe(18);
    expect(comebackSettlement(days[0]!.penaltyTotal, null, cfg)).toBeNull();
    expect(week).toBeGreaterThanOrEqual(-120);
  });

  it("scenario 5: Reset Week limits the week to −50", () => {
    expect(resetWeekCorrection(-110, cfg)!.amount).toBe(60);
    expect(resetWeekCorrection(-30, cfg)).toBeNull();
  });

  it("shield / life event forgive, baseline never penalises", () => {
    const q = [{ kind: "core" as const, title: "c", tierDone: null }];
    expect(closeDay({ quests: q, weekPenaltiesSoFar: 0, shieldUsed: true }, cfg).penaltyTotal).toBe(0);
    expect(closeDay({ quests: q, weekPenaltiesSoFar: 0, lifeEvent: true }, cfg).missedCore).toBe(false);
    expect(closeDay({ quests: q, weekPenaltiesSoFar: 0, rulesActive: false }, cfg).penaltyTotal).toBe(0);
  });

  it("rest day pass: no penalties, no comeback, flame untouched", () => {
    const q = [
      { kind: "core" as const, title: "c", tierDone: null },
      { kind: "fixed" as const, title: "f", tierDone: null },
    ];
    const r = closeDay({ quests: q, weekPenaltiesSoFar: 0, restDay: true }, cfg);
    expect(r.penaltyTotal).toBe(0);
    expect(r.missedCore).toBe(false);
    expect(r.penalties).toHaveLength(0);
    const s = { ...emptyStreak(), flame: 12, shieldProgress: 2, shields: 1 };
    const kept = advanceStreak(s, { standardDay: false, restDay: true }, cfg).state;
    expect(kept.flame).toBe(12);
    expect(kept.shieldProgress).toBe(2);
    expect(advanceStreak(s, { standardDay: false }, cfg).state.flame).toBe(0);
  });

  it("shields: 1 per 5 standard days, cap 3; miss resets flame", () => {
    let s = emptyStreak();
    let earned = 0;
    for (let i = 0; i < 20; i++) {
      const r = advanceStreak(s, { standardDay: true }, cfg);
      s = r.state;
      if (r.shieldEarned) earned++;
    }
    expect(s.shields).toBe(3);
    expect(earned).toBe(3);
    expect(s.flame).toBe(20);
    expect(advanceStreak(s, { standardDay: false }, cfg).state.flame).toBe(0);
    const end = new Date("2026-11-20T00:30:00Z");
    expect(canUseShield(end, new Date("2026-11-20T10:00:00Z"), 1, cfg).ok).toBe(true);
    expect(canUseShield(end, new Date("2026-11-22T10:00:00Z"), 1, cfg).ok).toBe(false);
    expect(canUseShield(end, end, 0, cfg).ok).toBe(false);
  });

  it("consistency + life events + loot pity", () => {
    expect(consistencyRate(["seed", null, "standard", null])).toBe(0.5);
    expect(lifeEventAllowed(2, 2, cfg).ok).toBe(false);
    expect(lifeEventAllowed(1, 4, cfg).reflect).toBe(true);
    let pity = 0;
    for (let i = 0; i < 6; i++) pity = rollLoot(0, pity, cfg).pity;
    expect(pity).toBe(6);
    expect(rollLoot(0, pity, cfg).result).not.toBe("none");
  });
});
