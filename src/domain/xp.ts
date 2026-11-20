import type { GameConfig } from "@/config/schema";

/**
 * XP engine (doc 04 §4, doc 07 §6.2). Pure: `awardXp(activity, day, cfg)` → awards + next day state.
 * XP never decreases. Every award carries a `ruleKey` and `capApplied` so the UI can answer "why?".
 */

export type XpBucket =
  | "focus"
  | "video"
  | "tests"
  | "analysis"
  | "review"
  | "forge"
  | "pillars"
  | "chapter"
  | "boss";

/** Buckets that count as study (Mind). Everything else is non-study and subject to the weekly share rule. */
export const STUDY_BUCKETS: ReadonlySet<XpBucket> = new Set(["focus", "video", "tests", "analysis", "review", "chapter", "boss"]);

export type XpActivity =
  | { kind: "focus"; minutes: number; surge?: boolean; manualLate?: boolean }
  | { kind: "video_lesson"; count?: number; manualLate?: boolean }
  | { kind: "tests"; correct: number; wrong: number; manualLate?: boolean; interleaved?: boolean }
  | { kind: "error_analyzed"; count?: number }
  | { kind: "chapter_clear"; tier: "M" | "S" | "C" }
  | { kind: "review_card"; count?: number }
  | { kind: "forge_artifact"; count?: number }
  | { kind: "mini_trial"; netPct: number }
  | { kind: "weekly_boss"; netPct: number }
  | { kind: "mock_exam"; netPct: number; beatShadow?: boolean }
  | { kind: "pillar_quest"; sleepOnTime?: boolean };

export interface XpDayState {
  /** XP already earned today, per bucket (after caps). */
  earned: Partial<Record<XpBucket, number>>;
  /** Effective focus minutes logged today (surge-weighted, manual-late halved) — keeps 5-min remainders. */
  focusEffMinutes: number;
}

export interface XpAward {
  amount: number;
  bucket: XpBucket;
  ruleKey: string;
  reason: string;
  capApplied: boolean;
}

export const emptyDay = (): XpDayState => ({ earned: {}, focusEffMinutes: 0 });

export const round2 = (n: number) => Math.round(n * 100) / 100;

function capped(
  day: XpDayState,
  bucket: XpBucket,
  raw: number,
  cap: number | null,
  ruleKey: string,
  reason: string,
): { award: XpAward; day: XpDayState } {
  const before = day.earned[bucket] ?? 0;
  const room = cap === null ? Infinity : Math.max(0, cap - before);
  const amount = round2(Math.max(0, Math.min(raw, room)));
  const capApplied = raw > room + 1e-9;
  return {
    award: { amount, bucket, ruleKey, reason: capApplied ? `${reason} (daily cap ${cap})` : reason, capApplied },
    day: { ...day, earned: { ...day.earned, [bucket]: round2(before + amount) } },
  };
}

/** Surge-weighted effective minutes: ×multiplier on the first `surgeMaxMinutes` only. */
export function effectiveFocusMinutes(minutes: number, surge: boolean, cfg: GameConfig["xp"]): number {
  const m = Math.max(0, minutes);
  if (!surge) return m;
  const boosted = Math.min(m, cfg.surgeMaxMinutes);
  return boosted * cfg.surgeMultiplier + (m - boosted);
}

export function awardXp(activity: XpActivity, day: XpDayState, cfg: GameConfig): { awards: XpAward[]; day: XpDayState } {
  const x = cfg.xp;
  const late = "manualLate" in activity && activity.manualLate ? x.manualLateFraction : 1;
  const lateNote = late < 1 ? ` ×${late} (manual entry after ${x.manualLateAfterHours}h)` : "";

  switch (activity.kind) {
    case "focus": {
      const eff = effectiveFocusMinutes(activity.minutes, !!activity.surge, x) * late;
      const blocks = (m: number) => Math.floor(m / x.focusBlockMinutes + 1e-9);
      const raw = (blocks(day.focusEffMinutes + eff) - blocks(day.focusEffMinutes)) * x.perFocusBlock;
      const next = { ...day, focusEffMinutes: round2(day.focusEffMinutes + eff) };
      const ruleKey = activity.surge ? "xp.focus.surge" : "xp.focus";
      const reason = `${activity.minutes} min focus${activity.surge ? ` (Surge ×${x.surgeMultiplier} up to ${x.surgeMaxMinutes} min)` : ""}${lateNote}`;
      const r = capped(next, "focus", raw, x.focusDailyCap, ruleKey, reason);
      return { awards: [r.award], day: r.day };
    }
    case "video_lesson": {
      const n = activity.count ?? 1;
      const r = capped(day, "video", n * x.videoLesson * late, x.videoDailyCap, "xp.video", `${n} video lesson(s)${lateNote}`);
      return { awards: [r.award], day: r.day };
    }
    case "tests": {
      const mix = activity.interleaved && cfg.learning.interleaving ? 1 + cfg.learning.interleaveXpBonus : 1;
      const raw = (activity.correct * x.testCorrect + activity.wrong * x.testWrong) * late * mix;
      const r = capped(
        day,
        "tests",
        raw,
        x.testsDailyCap,
        "xp.tests",
        `${activity.correct} correct × ${x.testCorrect} + ${activity.wrong} wrong × ${x.testWrong}${lateNote}${mix > 1 ? ` ×${mix} (interleaved)` : ""}`,
      );
      return { awards: [r.award], day: r.day };
    }
    case "error_analyzed": {
      const n = activity.count ?? 1;
      const r = capped(day, "analysis", n * x.errorAnalyzed, x.analysisDailyCap, "xp.analysis", `${n} analysed error(s)`);
      return { awards: [r.award], day: r.day };
    }
    case "chapter_clear": {
      const f = x.chapterClearTierFactor[activity.tier];
      const r = capped(day, "chapter", x.chapterClearBase * f, null, "xp.chapter.clear", `chapter cleared (tier ${activity.tier} ×${f})`);
      return { awards: [r.award], day: r.day };
    }
    case "review_card": {
      const n = activity.count ?? 1;
      const r = capped(day, "review", n * x.reviewCard, x.reviewDailyCap, "xp.review", `${n} review card(s)`);
      return { awards: [r.award], day: r.day };
    }
    case "forge_artifact": {
      const n = activity.count ?? 1;
      const r = capped(day, "forge", n * x.forgeArtifact, x.forgeDailyCap, "xp.forge", `${n} Forge artifact(s)`);
      return { awards: [r.award], day: r.day };
    }
    case "mini_trial":
    case "weekly_boss": {
      const c = activity.kind === "mini_trial" ? x.miniTrial : x.weeklyBoss;
      const pct = Math.max(0, activity.netPct);
      const r = capped(day, "boss", c.base + c.perNetPct * pct, null, `xp.${activity.kind}`, `${activity.kind.replace("_", " ")}: ${c.base} + ${c.perNetPct}×${pct}%`);
      return { awards: [r.award], day: r.day };
    }
    case "mock_exam": {
      const pct = Math.max(0, activity.netPct);
      const r1 = capped(day, "boss", x.mockExam.base + x.mockExam.perNetPct * pct, null, "xp.mock_exam", `mock exam: ${x.mockExam.base} + ${x.mockExam.perNetPct}×${pct}%`);
      if (!activity.beatShadow) return { awards: [r1.award], day: r1.day };
      const r2 = capped(r1.day, "boss", x.mockExam.beatShadowBonus, null, "xp.mock_exam.beat_shadow", "beat the Shadow");
      return { awards: [r1.award, r2.award], day: r2.day };
    }
    case "pillar_quest": {
      const raw = activity.sleepOnTime ? x.pillarSleepOnTime : x.pillarQuest;
      const r = capped(day, "pillars", raw, x.pillarsDailyCap, activity.sleepOnTime ? "xp.pillar.sleep" : "xp.pillar", activity.sleepOnTime ? "slept on time" : "pillar quest");
      return { awards: [r.award], day: r.day };
    }
  }
}

/** Applies a sequence of activities to a day (convenience for tests/replay). */
export function awardMany(activities: XpActivity[], cfg: GameConfig, start: XpDayState = emptyDay()) {
  let day = start;
  const awards: XpAward[] = [];
  for (const a of activities) {
    const r = awardXp(a, day, cfg);
    awards.push(...r.awards);
    day = r.day;
  }
  return { awards, day, total: round2(awards.reduce((s, a) => s + a.amount, 0)) };
}

/** Seed-tier quest: a fraction of the XP of the full (Standard) quest. */
export function seedXp(standardXp: number, cfg: GameConfig): number {
  return round2(Math.max(0, standardXp) * cfg.xp.seedFraction);
}

/**
 * Weekly study-share rule: non-study XP may make up at most `nonStudyWeeklyShareMax` of the XP that counts
 * toward Level; the surplus converts to Gold at `gold.surplusXpRate`.
 */
export function settleWeeklyShare(studyXp: number, nonStudyXp: number, cfg: GameConfig) {
  const share = cfg.xp.nonStudyWeeklyShareMax;
  const s = Math.max(0, studyXp);
  const n = Math.max(0, nonStudyXp);
  const allowed = share >= 1 ? n : Math.min(n, (share / (1 - share)) * s);
  const surplus = round2(n - allowed);
  return {
    levelXp: round2(s + allowed),
    nonStudyCounted: round2(allowed),
    surplusXp: surplus,
    gold: Math.floor(surplus * cfg.gold.surplusXpRate),
  };
}
