import { configSchema, type GameConfig } from "./schema";

/** Default config v1 — values from doc 04 (game design v0.1). Recalibrated after the Baseline week (v2). */
export const DEFAULT_CONFIG: GameConfig = configSchema.parse({
  xp: {
    perFocusBlock: 1,
    focusBlockMinutes: 5,
    focusDailyCap: 72,
    videoLesson: 5,
    videoDailyCap: 40,
    testCorrect: 0.6,
    testWrong: 0.1,
    testsDailyCap: 80,
    errorAnalyzed: 1.0,
    analysisDailyCap: 40,
    chapterClearBase: 60,
    chapterClearTierFactor: { M: 1, S: 0.7, C: 0.4 },
    reviewCard: 2,
    reviewDailyCap: 30,
    forgeArtifact: 8,
    forgeDailyCap: 24,
    miniTrial: { base: 20, perNetPct: 2 },
    weeklyBoss: { base: 80, perNetPct: 2 },
    mockExam: { base: 60, perNetPct: 3, beatShadowBonus: 100 },
    pillarQuest: 10,
    pillarSleepOnTime: 15,
    pillarsDailyCap: 35,
    surgeMultiplier: 1.2,
    surgeMaxMinutes: 90,
    seedFraction: 0.25,
    manualLateFraction: 0.5,
    manualLateAfterHours: 24,
    nonStudyWeeklyShareMax: 0.3,
  },
  levels: {
    base: 120,
    step: 12,
    titles: [
      { from: 1, title: "Wanderer" },
      { from: 6, title: "Initiate" },
      { from: 11, title: "Scholar" },
      { from: 16, title: "Adept" },
      { from: 21, title: "Strategist" },
      { from: 26, title: "Warden" },
      { from: 31, title: "Champion" },
      { from: 36, title: "Ascendant" },
      { from: 41, title: "Summit-Bound" },
    ],
  },
  score: {
    missCore: -20,
    missFixed: -6,
    missPillar: -4,
    skipWeeklyBoss: -40,
    dailyFloor: -40,
    weeklyFloor: -120,
    resetWeekFloor: -50,
    comebackRefund: 0.5,
  },
  shields: { streakDaysPerShield: 5, max: 3, useWithinHours: 24 },
  lifeEvents: { perWeekMax: 2, reflectAfterPerMonth: 4 },
  quests: { maxPerDay: 5, stretchFactor: 1.25 },
  gold: { standardDay: 10, stretchBonus: 5, weeklyBossDefeated: 50, duelWin: 100, regionBoss: 150, surplusXpRate: 1 },
  tests: { defaultChoices: 4 },
  time: { rolloverHour: 4, timezone: "Asia/Tehran", idleMinutes: 5 },
  capacity: { scenarios: { cautious: 0.55, base: 0.65, optimistic: 0.8 }, defaultFocusFactor: 0.65, movingWeeks: 3, reserveFraction: 0.1, fixedDailyMinutes: 45 },
  triage: { mustCoverage: 0.7, shouldCoverage: 0.9, a0Clip: 0.8, a0Unknown: 0.2, defaultChapterHours: 4, tierWeights: { M: 3, S: 2, C: 1 }, rerunEveryDays: 14 },
  planner: { fillFraction: 0.9, testsPerHour: 20 },
  clear: { minSessions: 2, minGapDays: 2, minNetPct: 60, minQuestions: 5 },
  rival: { paceMin: 0.85, paceMax: 1.1, paceStart: 1, userPaceBoost: 1.05, targetNetPct: 40, restsBehind: 0.2, restsWeeks: 2, restsGapCut: 0.1 },
  boss: {
    weeklyQuestions: 25,
    weeklyMinutes: 60,
    weeklyThresholdStart: 40,
    weeklyThresholdMax: 55,
    thresholdPerLevel: 0.5,
    weeklyReviewShare: 0.2,
    regionQuestions: 40,
    regionMinutes: 100,
    regionThreshold: 45,
    miniTrialQuestions: 25,
    miniTrialMinutes: 60,
    miniTrialEveryWeeks: 2,
  },
  review: { intervals: [1, 3, 7, 14, 30] },
  sleep: { targetWake: "05:30", targetBed: "22:30", stepMinutes: 20, startWeek: 2, minSleepHours: 6.25, maxWakeDeviationMinutes: 45, fridayGraceMinutes: 45, wakeToleranceMinutes: 15, bedToleranceMinutes: 20 },
  goal: { defaultMinutes: 120, goldOnComplete: 10, upgradeEveryDays: 1, upgradeFactor: 1.02, upgradeHitRate: 0.8 },
  loot: { none: 0.6, codex: 0.25, cosmetic: 0.1, shield: 0.05, pity: 7 },
  shop: { monthlyMoneyBudget: 0 },
  undo: { windowMinutes: 10 },
  builder: { minConsistency: 0.7, minCoreDays: 4, weeklyCapMinutes: 180, bankCapMinutes: 360 },
  anomaly: { maxTestsPerDay: 200, perfectAccuracyMinTests: 50, maxFocusHoursPerDay: 14, manualShareWarn: 0.4 },
  gems: { chapterClear: 2, bossWin: 5, duelWin: 2, streakMilestone: 10, perfectRun: 3 },
  skillTree: { tierCosts: [10, 25, 60] },
  learning: { interleaving: true, pretest: true, mastery: true, scheduler: true, interleaveXpBonus: 0.1, pretestA0Weight: 0.5, round2GapDays: 7, round3GapDays: 21 },
  wellness: {
    winddown: ["Screens away 30 min before bed", "Tomorrow's book open on the desk", "Light stretch or 4 slow breaths", "Bedroom cool and dark"],
    sleepDebtWeekHours: 7,
  },
  burnout: { lowEnergyAvg: 2, lowMoodAvg: 2, minCheckins: 3, highConsistency: 0.8, highLoadHours: 25, watchPoints: 2, warnPoints: 4 },
  experiment: { days: 14, minDays: 7, consistencyDeltaPp: 5, netDeltaPp: 3, focusDeltaPct: 10 },
  sound: { volume: 0.5 },
  ai: { baseUrl: "", model: "gpt-4o-mini", monthlyCostCapUsd: 5, maxCallsPerDay: 20, pricePer1kIn: 0.00015, pricePer1kOut: 0.0006 },
  reminders: { enabled: true, tone: "playful", maxPerDay: 5 },
  notifications: { push: { enabled: false }, telegram: { enabled: true, chatId: "" } },
  rank: {
    source: "Aggregated public score reports (assumed curve; edit in Config when real data arrives — T-DATA-04)",
    assumed: true,
    curve: [
      { pct: 10, rank: 6000 },
      { pct: 20, rank: 3500 },
      { pct: 30, rank: 2000 },
      { pct: 40, rank: 1100 },
      { pct: 50, rank: 600 },
      { pct: 60, rank: 300 },
      { pct: 70, rank: 120 },
      { pct: 80, rank: 40 },
      { pct: 90, rank: 10 },
    ],
    bandFactor: 1.6,
  },
  flags: { rival: true, bosses: true, loot: true, shop: true, sleepProgram: true, ghostLeague: true, ai: true, sounds: false, mascots: true, fog: true, bossRush: true, seasonPass: true, challengeCards: true, anomalyAlerts: true, calm: false },
});

/** Deep-merges a partial override onto a base config and validates the result. */
export function mergeConfig(base: GameConfig, patch: unknown): GameConfig {
  const merge = (a: unknown, b: unknown): unknown => {
    if (Array.isArray(b)) return b;
    if (b && typeof b === "object" && a && typeof a === "object" && !Array.isArray(a)) {
      const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = merge(out[k], v);
      return out;
    }
    return b === undefined ? a : b;
  };
  return configSchema.parse(merge(base, patch));
}
