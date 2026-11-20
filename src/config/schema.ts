import { z } from "zod";

/**
 * Game-rule configuration (doc 04 §4, §6, §9; doc 07 §4.3). Every constant the engines use lives here
 * so the user owns the rules (F-CORE-09) and Replay can pick the version that was active at the time.
 */
const nonNeg = z.number().min(0);
const cap = z.number().min(0);

export const configSchema = z.object({
  xp: z.object({
    perFocusBlock: nonNeg, // XP per block of focus minutes
    focusBlockMinutes: z.number().int().min(1),
    focusDailyCap: cap,
    videoLesson: nonNeg,
    videoDailyCap: cap,
    testCorrect: nonNeg,
    testWrong: nonNeg,
    testsDailyCap: cap,
    errorAnalyzed: nonNeg,
    analysisDailyCap: cap,
    chapterClearBase: nonNeg,
    chapterClearTierFactor: z.object({ M: nonNeg, S: nonNeg, C: nonNeg }),
    reviewCard: nonNeg,
    reviewDailyCap: cap,
    forgeArtifact: nonNeg,
    forgeDailyCap: cap,
    miniTrial: z.object({ base: nonNeg, perNetPct: nonNeg }),
    weeklyBoss: z.object({ base: nonNeg, perNetPct: nonNeg }),
    mockExam: z.object({ base: nonNeg, perNetPct: nonNeg, beatShadowBonus: nonNeg }),
    pillarQuest: nonNeg,
    pillarSleepOnTime: nonNeg,
    pillarsDailyCap: cap,
    surgeMultiplier: z.number().min(1),
    surgeMaxMinutes: z.number().int().min(0),
    seedFraction: z.number().min(0).max(1),
    manualLateFraction: z.number().min(0).max(1),
    manualLateAfterHours: z.number().min(0),
    nonStudyWeeklyShareMax: z.number().min(0).max(1),
  }),
  levels: z.object({
    base: z.number().positive(), // xp_to_next(n) = base + step·n
    step: z.number().min(0),
    titles: z.array(z.object({ from: z.number().int().min(1), title: z.string().min(1) })).min(1),
  }),
  score: z.object({
    missCore: z.number().max(0),
    missFixed: z.number().max(0),
    missPillar: z.number().max(0),
    skipWeeklyBoss: z.number().max(0),
    dailyFloor: z.number().max(0),
    weeklyFloor: z.number().max(0),
    resetWeekFloor: z.number().max(0),
    comebackRefund: z.number().min(0).max(1),
  }),
  shields: z.object({ streakDaysPerShield: z.number().int().min(1), max: z.number().int().min(0), useWithinHours: nonNeg }),
  lifeEvents: z.object({ perWeekMax: z.number().int().min(0), reflectAfterPerMonth: z.number().int().min(0) }),
  quests: z.object({ maxPerDay: z.number().int().min(1), stretchFactor: z.number().min(1) }),
  gold: z.object({
    standardDay: nonNeg,
    stretchBonus: nonNeg,
    weeklyBossDefeated: nonNeg,
    duelWin: nonNeg,
    regionBoss: nonNeg,
    surplusXpRate: nonNeg,
  }),
  tests: z.object({ defaultChoices: z.number().int().min(2) }),
  time: z.object({ rolloverHour: z.number().int().min(0).max(23), timezone: z.string().min(1), idleMinutes: z.number().int().min(1) }),
  // ── R1/R2 sections (doc 03, 04 §7-9, 05) ──
  capacity: z.object({
    scenarios: z.object({ cautious: z.number().min(0).max(1), base: z.number().min(0).max(1), optimistic: z.number().min(0).max(1) }),
    defaultFocusFactor: z.number().min(0).max(1),
    movingWeeks: z.number().int().min(1),
    reserveFraction: z.number().min(0).max(0.5),
    fixedDailyMinutes: nonNeg, // foundations + English, booked outside the chapter plan
  }),
  triage: z.object({
    mustCoverage: z.number().min(0).max(1),
    shouldCoverage: z.number().min(0).max(1),
    a0Clip: z.number().min(0).max(1),
    a0Unknown: z.number().min(0).max(1),
    defaultChapterHours: z.number().positive(),
    tierWeights: z.object({ M: nonNeg, S: nonNeg, C: nonNeg }),
    rerunEveryDays: z.number().int().min(1),
  }),
  planner: z.object({ fillFraction: z.number().min(0.1).max(1), testsPerHour: nonNeg }),
  clear: z.object({ minSessions: z.number().int().min(1), minGapDays: z.number().int().min(0), minNetPct: z.number(), minQuestions: z.number().int().min(1) }),
  rival: z.object({
    paceMin: z.number().positive(),
    paceMax: z.number().positive(),
    paceStart: z.number().positive(),
    userPaceBoost: z.number().positive(),
    targetNetPct: z.number(),
    restsBehind: z.number().min(0).max(1),
    restsWeeks: z.number().int().min(1),
    restsGapCut: z.number().min(0).max(1),
  }),
  boss: z.object({
    weeklyQuestions: z.number().int().min(1),
    weeklyMinutes: z.number().int().min(1),
    weeklyThresholdStart: z.number(),
    weeklyThresholdMax: z.number(),
    thresholdPerLevel: nonNeg,
    weeklyReviewShare: z.number().min(0).max(1),
    regionQuestions: z.number().int().min(1),
    regionMinutes: z.number().int().min(1),
    regionThreshold: z.number(),
    miniTrialQuestions: z.number().int().min(1),
    miniTrialMinutes: z.number().int().min(1),
    miniTrialEveryWeeks: z.number().int().min(1),
  }),
  review: z.object({ intervals: z.array(z.number().int().positive()).min(1) }),
  sleep: z.object({
    targetWake: z.string().regex(/^\d{2}:\d{2}$/),
    targetBed: z.string().regex(/^\d{2}:\d{2}$/),
    stepMinutes: z.number().int().min(0),
    startWeek: z.number().int().min(1),
    minSleepHours: z.number().positive(),
    maxWakeDeviationMinutes: z.number().int().min(0),
    fridayGraceMinutes: z.number().int().min(0),
    wakeToleranceMinutes: z.number().int().min(0),
    bedToleranceMinutes: z.number().int().min(0),
  }),
  goal: z.object({ defaultMinutes: z.number().int().min(5), goldOnComplete: nonNeg, upgradeEveryDays: z.number().int().min(1), upgradeFactor: z.number().min(1), upgradeHitRate: z.number().min(0).max(1) }),
  loot: z.object({ none: nonNeg, codex: nonNeg, cosmetic: nonNeg, shield: nonNeg, pity: z.number().int().min(1) }),
  shop: z.object({ monthlyMoneyBudget: nonNeg }),
  undo: z.object({ windowMinutes: z.number().int().min(1) }),
  builder: z.object({ minConsistency: z.number().min(0).max(1), minCoreDays: z.number().int().min(0), weeklyCapMinutes: z.number().int().min(0), bankCapMinutes: z.number().int().min(0) }),
  anomaly: z.object({ maxTestsPerDay: z.number().int().min(1), perfectAccuracyMinTests: z.number().int().min(1), maxFocusHoursPerDay: z.number().positive(), manualShareWarn: z.number().min(0).max(1) }),
  // ── R3 extras + R4 intelligence (issues #86–#100) ──
  gems: z.object({ chapterClear: nonNeg, bossWin: nonNeg, duelWin: nonNeg, streakMilestone: nonNeg, perfectRun: nonNeg }),
  skillTree: z.object({ tierCosts: z.array(nonNeg).length(3) }),
  learning: z.object({
    interleaving: z.boolean(),
    pretest: z.boolean(),
    mastery: z.boolean(),
    scheduler: z.boolean(),
    interleaveXpBonus: z.number().min(0).max(0.5),
    pretestA0Weight: z.number().min(0).max(1),
    round2GapDays: z.number().int().min(1),
    round3GapDays: z.number().int().min(1),
  }),
  wellness: z.object({ winddown: z.array(z.string().min(1)).min(1).max(8), sleepDebtWeekHours: z.number().positive() }),
  /** Burnout radar (#101, F-WEL-06): every threshold is visible in the UI next to the observed value. */
  burnout: z.object({
    lowEnergyAvg: z.number().min(1).max(5),
    lowMoodAvg: z.number().min(1).max(5),
    minCheckins: z.number().int().min(1).max(7),
    highConsistency: z.number().min(0).max(1),
    highLoadHours: z.number().positive(),
    watchPoints: z.number().int().min(1),
    warnPoints: z.number().int().min(1),
  }),
  /** Experiment Lab (#105, F-DUO-17): one 14-day experiment at a time; verdict thresholds are transparent. */
  experiment: z.object({
    days: z.number().int().min(7).max(28),
    minDays: z.number().int().min(3),
    consistencyDeltaPp: z.number().min(0),
    netDeltaPp: z.number().min(0),
    focusDeltaPct: z.number().min(0),
  }),
  /** Sound volume (#106): playback itself is gated by flags.sounds (default off) and calm mode. */
  sound: z.object({ volume: z.number().min(0).max(1) }),
  ai: z.object({
    baseUrl: z.string(),
    model: z.string().min(1),
    monthlyCostCapUsd: nonNeg,
    maxCallsPerDay: z.number().int().min(0),
    pricePer1kIn: nonNeg,
    pricePer1kOut: nonNeg,
  }),
  reminders: z.object({ enabled: z.boolean(), tone: z.enum(["calm", "playful", "direct"]), maxPerDay: z.number().int().min(0).max(5) }),
  /** Outbound notifications (#109, F-NOT-02/03): Push needs per-device consent; Telegram needs a token and chat id. */
  notifications: z.object({
    push: z.object({ enabled: z.boolean() }),
    telegram: z.object({ enabled: z.boolean(), chatId: z.string().trim().max(40) }),
  }),
  rank: z.object({
    source: z.string().min(1),
    assumed: z.boolean(),
    curve: z.array(z.object({ pct: z.number(), rank: z.number().int().min(1) })).min(2),
    bandFactor: z.number().min(1).max(3),
  }),
  /** F-OPS-06 feature flags — every flip is a config version + `config.changed` event. */
  flags: z.object({
    rival: z.boolean(),
    bosses: z.boolean(),
    loot: z.boolean(),
    shop: z.boolean(),
    sleepProgram: z.boolean(),
    ghostLeague: z.boolean(),
    ai: z.boolean(),
    sounds: z.boolean(),
    /** Mascot illustrations (F-DUO-14). Off = calm mode: no character art anywhere. */
    mascots: z.boolean(),
    /** Territory Fog on the map (F-GM-09). Off = every node stays fully readable. */
    fog: z.boolean(),
    /** Boss Rush in the final week (F-GM-01). */
    bossRush: z.boolean(),
    /** Free 25-week Season Pass (F-GM-03). No real money, ever. */
    seasonPass: z.boolean(),
    /** Weekly random challenge card (F-GM-14). */
    challengeCards: z.boolean(),
    /** Gentle anomaly alerts (F-AI-05). Off = anomalies still logged, never surfaced. */
    anomalyAlerts: z.boolean(),
    /** Calm mode (#106): no confetti, no springs, no sounds, no mascot art — simple fades only. */
    calm: z.boolean(),
  }),
});

export type GameConfig = z.infer<typeof configSchema>;
