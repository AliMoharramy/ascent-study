/** Canonical PostgreSQL schema; migrations-pg owns constraints, FKs and indexes.
 * Timestamps are ISO UTC strings, days stay YYYY-MM-DD, JSON stays text, numbers stay double precision.
 */
import {
  boolean,
  customType,
  date,
  doublePrecision,
  integer,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

// Drizzle overrides pg's TIMESTAMPTZ parser, so normalize at the column boundary.
const ts = customType<{ data: string; driverData: string }>({
  dataType: () => "timestamp with time zone",
  fromDriver: (value) => new Date(value).toISOString(),
  toDriver: (value) => new Date(value).toISOString(),
});
const day = (name: string) => date(name, { mode: "string" });
const num = (name: string) => doublePrecision(name);

// ── 0001 core ───────────────────────────────────────────────
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  locale: text("locale").notNull().default("en"),
  timezone: text("timezone").notNull().default("Asia/Tehran"),
  rolloverHour: integer("rollover_hour").notNull().default(4),
  theme: text("theme").notNull().default("night"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  csrfToken: text("csrf_token").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull(),
  userAgent: text("user_agent"),
});

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  occurredAt: ts("occurred_at").notNull(),
  clientRequestId: text("client_request_id"),
  configVersion: integer("config_version"),
  source: text("source").notNull().default("app"),
  createdAt: ts("created_at").notNull(),
  gameDay: day("game_day"),
});

export type FocusKind = "video" | "tests" | "review" | "analysis" | "forge" | "other";
export type FocusStatus = "running" | "paused" | "ended";

export const focusSessions = pgTable("focus_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  subjectId: text("subject_id"),
  chapterId: text("chapter_id"),
  kind: text("kind").$type<FocusKind>().notNull(),
  status: text("status").$type<FocusStatus>().notNull(),
  startedAt: ts("started_at").notNull(),
  endedAt: ts("ended_at"),
  pausedAt: ts("paused_at"),
  pausedMs: integer("paused_ms").notNull().default(0),
  minutes: integer("minutes"),
  gameDay: day("game_day").notNull(),
  surge: boolean("surge").notNull().default(false),
  manual: boolean("manual").notNull().default(false),
  idlePauses: integer("idle_pauses").notNull().default(0),
  note: text("note"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const testLogs = pgTable("test_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id"),
  subjectId: text("subject_id"),
  chapterId: text("chapter_id"),
  sourceId: text("source_id"),
  correct: integer("correct").notNull(),
  wrong: integer("wrong").notNull(),
  blank: integer("blank").notNull(),
  choices: integer("choices").notNull().default(4),
  netPct: num("net_pct").notNull(),
  gameDay: day("game_day").notNull(),
  loggedAt: ts("logged_at").notNull(),
  manual: boolean("manual").notNull().default(false),
  seconds: integer("seconds"),
  interleaved: boolean("interleaved").notNull().default(false),
  groupId: text("group_id"),
  note: text("note"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const dailyCheckins = pgTable("daily_checkins", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: day("date").notNull(),
  energyMorning: integer("energy_morning"),
  energyNoon: integer("energy_noon"),
  energyNight: integer("energy_night"),
  blocker: text("blocker"),
  escapeMinutes: integer("escape_minutes"),
  escapeKind: text("escape_kind"),
  classAttended: boolean("class_attended"),
  wakeAt: text("wake_at"),
  bedAt: text("bed_at"),
  note: text("note"),
  manual: boolean("manual").notNull().default(false),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

// ── 0002 knowledge ──────────────────────────────────────────
export const subjects = pgTable("subjects", {
  id: text("id").primaryKey(),
  nameFa: text("name_fa").notNull(),
  nameEn: text("name_en").notNull(),
  group: text("group").notNull(),
  status: text("status").$type<"active" | "dropped" | "optional">().notNull(),
  mode: text("mode"),
  priorityPhase: integer("priority_phase"),
  sort: integer("sort").notNull().default(0),
  notes: text("notes"),
  updatedAt: ts("updated_at").notNull(),
});

export type Tier = "M" | "S" | "C";

export const chapters = pgTable("chapters", {
  id: text("id").primaryKey(),
  subjectId: text("subject_id").notNull(),
  no: integer("no").notNull(),
  title: text("title").notNull(),
  optional: boolean("optional").notNull().default(false),
  tier: text("tier").$type<Tier>(),
  tierLocked: boolean("tier_locked").notNull().default(false),
  eqWeight: num("eq_weight"),
  updatedAt: ts("updated_at").notNull(),
});

export type CourseKind = "teaching" | "tips_tests";

export const courses = pgTable("courses", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  subjectId: text("subject_id").notNull(),
  kind: text("kind").$type<CourseKind>().notNull(),
  title: text("title").notNull(),
  instructor: text("instructor"),
  platform: text("platform"),
  sessions: integer("sessions"),
  durationMin: integer("duration_min"),
  estHoursMin: num("est_hours_min"),
  estHoursMax: num("est_hours_max"),
  estimated: boolean("estimated").notNull().default(false),
  speed: num("speed").notNull().default(1.5),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export type LessonStatus = "todo" | "watching" | "done";

export const lessons = pgTable("lessons", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull(),
  no: integer("no").notNull(),
  title: text("title").notNull(),
  durationMin: num("duration_min").notNull().default(0),
  status: text("status").$type<LessonStatus>().notNull().default("todo"),
  watchedAt: ts("watched_at"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const lessonChapters = pgTable(
  "lesson_chapters",
  { lessonId: text("lesson_id").notNull(), chapterId: text("chapter_id").notNull() },
  (t) => [primaryKey({ columns: [t.lessonId, t.chapterId] })],
);

export const chapterState = pgTable(
  "chapter_state",
  {
    chapterId: text("chapter_id").notNull(),
    userId: text("user_id").notNull(),
    a0: num("a0"),
    a: num("a"),
    netPct: num("net_pct"),
    sessionsCleared: integer("sessions_cleared").notNull().default(0),
    clearedAt: ts("cleared_at"),
    lastTestAt: ts("last_test_at"),
    dueReviewAt: ts("due_review_at"),
  },
  (t) => [primaryKey({ columns: [t.chapterId, t.userId] })],
);

export const testSources = pgTable("test_sources", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  subjectId: text("subject_id"),
  title: text("title").notNull(),
  kind: text("kind"),
  note: text("note"),
  approxCount: integer("approx_count"),
  countDetail: text("count_detail"),
  purchased: boolean("purchased").notNull().default(false),
  sourceUrl: text("source_url"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at"),
});

// ── 0003 config + ledgers ───────────────────────────────────
export const configVersions = pgTable("config_versions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  version: integer("version").notNull(),
  json: text("json").notNull(),
  reason: text("reason").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const xpLedger = pgTable("xp_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  eventId: text("event_id"),
  amount: num("amount").notNull(),
  reason: text("reason").notNull(),
  ruleKey: text("rule_key").notNull(),
  capApplied: boolean("cap_applied").notNull().default(false),
  weekId: text("week_id").notNull(),
  gameDay: day("game_day").notNull(),
  occurredAt: ts("occurred_at").notNull(),
});

export const scoreLedger = pgTable("score_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  eventId: text("event_id"),
  amount: num("amount").notNull(),
  reason: text("reason").notNull(),
  ruleKey: text("rule_key").notNull(),
  capApplied: boolean("cap_applied").notNull().default(false),
  weekId: text("week_id").notNull(),
  gameDay: day("game_day").notNull(),
  occurredAt: ts("occurred_at").notNull(),
});

// ── 0004 game layer ─────────────────────────────────────────
export const goldLedger = pgTable("gold_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  eventId: text("event_id"),
  amount: num("amount").notNull(),
  reason: text("reason").notNull(),
  ruleKey: text("rule_key").notNull(),
  gameDay: day("game_day").notNull(),
  occurredAt: ts("occurred_at").notNull(),
});

export const kv = pgTable(
  "kv",
  {
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    json: text("json").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export type QuestKindCol = "core" | "fixed" | "pillar" | "side" | "comeback" | "bonus";
export type QuestTierCol = "seed" | "standard" | "stretch";

export const quests = pgTable("quests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: day("date").notNull(),
  kind: text("kind").$type<QuestKindCol>().notNull(),
  title: text("title").notNull(),
  whenText: text("when_text"),
  tiersJson: text("tiers_json").notNull(),
  targetJson: text("target_json").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  habitId: text("habit_id"),
  xp: num("xp").notNull().default(0),
  status: text("status").$type<"open" | "done" | "missed" | "forgiven" | "waiting">().notNull().default("open"),
  tierDone: text("tier_done").$type<QuestTierCol>(),
  progress: num("progress").notNull().default(0),
  source: text("source").notNull().default("planner"),
  sort: integer("sort").notNull().default(0),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const dayCloses = pgTable("day_closes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: day("date").notNull(),
  coreTier: text("core_tier").$type<QuestTierCol>(),
  penaltyTotal: num("penalty_total").notNull().default(0),
  standardDay: boolean("standard_day").notNull().default(false),
  seedDay: boolean("seed_day").notNull().default(false),
  missedCore: boolean("missed_core").notNull().default(false),
  shieldUsed: boolean("shield_used").notNull().default(false),
  lifeEvent: boolean("life_event").notNull().default(false),
  rulesActive: boolean("rules_active").notNull().default(true),
  json: text("json").notNull().default("{}"),
  createdAt: ts("created_at").notNull(),
});

export const shields = pgTable("shields", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  earnedOn: day("earned_on").notNull(),
  usedOn: day("used_on"),
  usedForDate: day("used_for_date"),
  createdAt: ts("created_at").notNull(),
});

export const lifeEvents = pgTable("life_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: day("date").notNull(),
  reason: text("reason").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const userAchievements = pgTable(
  "user_achievements",
  { userId: text("user_id").notNull(), key: text("key").notNull(), unlockedAt: ts("unlocked_at").notNull() },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const lootRolls = pgTable("loot_rolls", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: day("date").notNull(),
  result: text("result").notNull(),
  pityCounter: integer("pity_counter").notNull().default(0),
  createdAt: ts("created_at").notNull(),
});

export const prereqs = pgTable(
  "prereqs",
  { chapterId: text("chapter_id").notNull(), requiresChapterId: text("requires_chapter_id").notNull() },
  (t) => [primaryKey({ columns: [t.chapterId, t.requiresChapterId] })],
);

export const weeks = pgTable(
  "weeks",
  {
    userId: text("user_id").notNull(),
    no: integer("no").notNull(),
    startsOn: day("starts_on").notNull(),
    capacityH: num("capacity_h").notNull().default(0),
    resetUsed: boolean("reset_used").notNull().default(false),
    resetAt: ts("reset_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.no] })],
);

export const weekPlanItems = pgTable("week_plan_items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  weekNo: integer("week_no").notNull(),
  chapterId: text("chapter_id").notNull(),
  subjectId: text("subject_id").notNull(),
  tier: text("tier").$type<Tier>().notNull(),
  plannedMin: integer("planned_min").notNull(),
  testsTarget: integer("tests_target").notNull().default(0),
  manual: boolean("manual").notNull().default(false),
  createdAt: ts("created_at").notNull(),
});

export type ErrorCause = "concept" | "calc" | "time" | "unread" | "forgot" | "careless";

export const errorItems = pgTable("error_items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  subjectId: text("subject_id"),
  chapterId: text("chapter_id"),
  testLogId: text("test_log_id"),
  cause: text("cause").$type<ErrorCause>().notNull(),
  takeaway: text("takeaway").notNull(),
  sourceRef: text("source_ref"),
  repeatedCount: integer("repeated_count").notNull().default(0),
  gameDay: day("game_day").notNull(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const reviewCards = pgTable("review_cards", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id"),
  chapterId: text("chapter_id"),
  front: text("front").notNull(),
  back: text("back").notNull(),
  step: integer("step").notNull().default(-1),
  reps: integer("reps").notNull().default(0),
  dueOn: day("due_on").notNull(),
  lastResult: text("last_result"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const forgeArtifacts = pgTable("forge_artifacts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  chapterId: text("chapter_id"),
  kind: text("kind").notNull().default("sheet"),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export type Pillar = "mind" | "body" | "rest" | "craft" | "bonds" | "learn" | "read";
export type HabitStatus = "proposed" | "trial" | "active" | "mastered" | "archived";

export const habits = pgTable("habits", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  key: text("key"),
  title: text("title").notNull(),
  pillar: text("pillar").$type<Pillar>().notNull(),
  identity: text("identity").notNull().default(""),
  anchor: text("anchor").notNull().default(""),
  place: text("place").notNull().default(""),
  timeWindow: text("time_window").notNull().default(""),
  tiersJson: text("tiers_json").notNull(),
  metricJson: text("metric_json").notNull(),
  temptation: text("temptation").notNull().default(""),
  envPrep: text("env_prep").notNull().default(""),
  daysPerWeek: integer("days_per_week").notNull().default(7),
  contractSs: num("contract_ss").notNull().default(0),
  xp: num("xp").notNull().default(10),
  status: text("status").$type<HabitStatus>().notNull(),
  startedOn: day("started_on"),
  sort: integer("sort").notNull().default(0),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const habitLogs = pgTable("habit_logs", {
  id: text("id").primaryKey(),
  habitId: text("habit_id").notNull(),
  userId: text("user_id").notNull(),
  date: day("date").notNull(),
  tierDone: text("tier_done").$type<QuestTierCol>(),
  value: num("value"),
  note: text("note"),
  createdAt: ts("created_at").notNull(),
});

export const sleepLogs = pgTable("sleep_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: day("date").notNull(),
  bedAt: text("bed_at").notNull(),
  wakeAt: text("wake_at").notNull(),
  minutes: integer("minutes").notNull(),
  source: text("source").$type<"manual" | "csv">().notNull().default("manual"),
  createdAt: ts("created_at").notNull(),
});

export const ideas = pgTable("ideas", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  text: text("text").notNull(),
  tags: text("tags").notNull().default(""),
  value: integer("value"),
  effort: text("effort").$type<"S" | "M" | "L">(),
  whyNow: text("why_now"),
  status: text("status").$type<"parked" | "chosen" | "built" | "dropped">().notNull().default("parked"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const detours = pgTable("detours", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  startedAt: ts("started_at").notNull(),
  gameDay: day("game_day").notNull(),
  minutes: integer("minutes").notNull().default(0),
  kind: text("kind").notNull(),
  reason: text("reason"),
  wasPrompted: boolean("was_prompted").notNull().default(true),
  choice: text("choice").$type<"study_first" | "later" | "continue">().notNull(),
  createdAt: ts("created_at").notNull(),
});

export const reviews = pgTable("reviews", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").$type<"nightly" | "weekly" | "monthly">().notNull(),
  date: day("date").notNull(),
  json: text("json").notNull(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export type BossKindCol = "weekly" | "region" | "mini_trial" | "mock" | "final";

export const bosses = pgTable("bosses", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").$type<BossKindCol>().notNull(),
  weekNo: integer("week_no").notNull(),
  scheduledFor: day("scheduled_for").notNull(),
  specJson: text("spec_json").notNull(),
  thresholdPct: num("threshold_pct"),
  status: text("status").$type<"scheduled" | "done" | "skipped">().notNull().default("scheduled"),
  resultPct: num("result_pct"),
  defeated: boolean("defeated"),
  resultsJson: text("results_json"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const mockExams = pgTable("mock_exams", {
  no: integer("no").primaryKey(),
  dateJalali: text("date_jalali").notNull(),
  questions: integer("questions").notNull(),
  minutes: integer("minutes").notNull(),
  budgetJson: text("budget_json").notNull().default("{}"),
});

export const mockResults = pgTable("mock_results", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  mockNo: integer("mock_no").notNull(),
  gameDay: day("game_day").notNull(),
  correct: integer("correct").notNull(),
  wrong: integer("wrong").notNull(),
  blank: integer("blank").notNull(),
  netPct: num("net_pct").notNull(),
  netPctNoSkip: num("net_pct_no_skip").notNull(),
  rankInSite: integer("rank_in_site"),
  perSubjectJson: text("per_subject_json").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const duels = pgTable("duels", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  weekNo: integer("week_no").notNull(),
  roundsJson: text("rounds_json").notNull(),
  winner: text("winner").$type<"user" | "shadow" | "draw">().notNull(),
  goldAwarded: num("gold_awarded").notNull().default(0),
  createdAt: ts("created_at").notNull(),
});

export const rewards = pgTable("rewards", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  goldCost: num("gold_cost").notNull(),
  moneyCost: num("money_cost").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: ts("created_at").notNull(),
});

export const rewardClaims = pgTable("reward_claims", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  rewardId: text("reward_id").notNull(),
  title: text("title").notNull(),
  gold: num("gold").notNull(),
  money: num("money").notNull().default(0),
  monthKey: text("month_key").notNull(),
  claimedAt: ts("claimed_at").notNull(),
});

export const decisions = pgTable("decisions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: day("date").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  rationale: text("rationale").notNull(),
  alternatives: text("alternatives").notNull().default(""),
  status: text("status").$type<"proposed" | "accepted" | "superseded" | "rejected">().notNull().default("accepted"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

// ── 0005 reference data ─────────────────────────────────────
export const examStructure = pgTable("exam_structure", {
  id: text("id").primaryKey(),
  yearJalali: integer("year_jalali").notNull(),
  groupCode: integer("group_code").notNull(),
  nameFa: text("name_fa").notNull(),
  coefficientsJson: text("coefficients_json").notNull(),
  perSubjectJson: text("per_subject_json").notNull(),
  totalQuestions: integer("total_questions"),
  durationMin: integer("duration_min"),
  wrongPenalty: num("wrong_penalty").notNull(),
  countsAssumed: boolean("counts_assumed").notNull().default(true),
  sourceUrl: text("source_url"),
  coefficientsSourceUrl: text("coefficients_source_url"),
  note: text("note"),
  updatedAt: ts("updated_at").notNull(),
});

// ── 0006 life pillars ───────────────────────────────────────
export type IdentityVote = "for" | "against";

export const identityVotes = pgTable("identity_votes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  habitId: text("habit_id"),
  gameDay: day("game_day").notNull(),
  vote: text("vote").$type<IdentityVote>().notNull(),
  note: text("note").notNull().default(""),
  createdAt: ts("created_at").notNull(),
});

export const contractSettlements = pgTable("contract_settlements", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  habitId: text("habit_id").notNull(),
  gameDay: day("game_day").notNull(),
  amount: num("amount").notNull(),
  reason: text("reason").notNull(),
  createdAt: ts("created_at").notNull(),
});

export type ExplorationStatus = "backlog" | "trial" | "active" | "archived";

export const explorationTopics = pgTable("exploration_topics", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  why: text("why").notNull().default(""),
  value: integer("value").notNull().default(3),
  status: text("status").$type<ExplorationStatus>().notNull().default("backlog"),
  startedOn: day("started_on"),
  archivedOn: day("archived_on"),
  gateNote: text("gate_note").notNull().default(""),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export type ExplorationSessionKind = "trial" | "review" | "output";

export const explorationSessions = pgTable("exploration_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  topicId: text("topic_id").notNull(),
  gameDay: day("game_day").notNull(),
  minutes: integer("minutes").notNull().default(0),
  kind: text("kind").$type<ExplorationSessionKind>().notNull().default("trial"),
  output: text("output").notNull().default(""),
  createdAt: ts("created_at").notNull(),
});

export const bondContacts = pgTable("bond_contacts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  relation: text("relation").notNull().default(""),
  lastContactOn: day("last_contact_on"),
  reminderDays: integer("reminder_days").notNull().default(14),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export type BondKind = "message" | "call" | "meet" | "collective";

export const bondInteractions = pgTable("bond_interactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  contactId: text("contact_id").notNull(),
  gameDay: day("game_day").notNull(),
  kind: text("kind").$type<BondKind>().notNull(),
  note: text("note").notNull().default(""),
  createdAt: ts("created_at").notNull(),
});

export const readingLogs = pgTable("reading_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  gameDay: day("game_day").notNull(),
  book: text("book").notNull(),
  pages: integer("pages").notNull().default(0),
  minutes: integer("minutes").notNull().default(0),
  note: text("note").notNull().default(""),
  createdAt: ts("created_at").notNull(),
});

export const builderSessions = pgTable("builder_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  gameDay: day("game_day").notNull(),
  minutes: integer("minutes").notNull(),
  built: text("built").notNull().default(""),
  ideaId: text("idea_id"),
  createdAt: ts("created_at").notNull(),
});

export const builderBank = pgTable("builder_bank", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  gameDay: day("game_day").notNull(),
  minutes: integer("minutes").notNull(),
  reason: text("reason").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const storyOverrides = pgTable(
  "story_overrides",
  {
    userId: text("user_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    startText: text("start_text").notNull(),
    endText: text("end_text").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.chapterNo] })],
);

export type ReviewRoundStatus = "pending" | "done" | "skipped";

export const reviewRounds = pgTable("review_rounds", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  subjectId: text("subject_id").notNull(),
  round: integer("round").notNull(),
  scheduledOn: day("scheduled_on").notNull(),
  doneOn: day("done_on"),
  status: text("status").$type<ReviewRoundStatus>().notNull().default("pending"),
  note: text("note").notNull().default(""),
  createdAt: ts("created_at").notNull(),
});

export const leagueWeeks = pgTable("league_weeks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  weekNo: integer("week_no").notNull(),
  tier: integer("tier").notNull(),
  seed: text("seed").notNull(),
  myXp: num("my_xp").notNull().default(0),
  resultJson: text("result_json").notNull().default("{}"),
  settledAt: ts("settled_at"),
  createdAt: ts("created_at").notNull(),
});

export const boardClaims = pgTable("board_claims", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  gameDay: day("game_day").notNull(),
  gold: num("gold").notNull().default(0),
  loot: text("loot").notNull().default("none"),
  createdAt: ts("created_at").notNull(),
});

export const monthlyBadges = pgTable(
  "monthly_badges",
  {
    userId: text("user_id").notNull(),
    monthKey: text("month_key").notNull(),
    badge: text("badge").notNull(),
    awardedAt: ts("awarded_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.monthKey] })],
);

// ── 0007 R3 extras + R4 intelligence ────────────────────────
export const gemsLedger = pgTable("gems_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  amount: num("amount").notNull(),
  ruleKey: text("rule_key").notNull(),
  note: text("note").notNull().default(""),
  gameDay: day("game_day"),
  createdAt: ts("created_at").notNull(),
});

export const skillUnlocks = pgTable(
  "skill_unlocks",
  {
    userId: text("user_id").notNull(),
    skillId: text("skill_id").notNull(),
    tier: integer("tier").notNull(),
    costGems: num("cost_gems").notNull(),
    unlockedAt: ts("unlocked_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.skillId] })],
);

export const wellnessLogs = pgTable(
  "wellness_logs",
  {
    userId: text("user_id").notNull(),
    date: day("date").notNull(),
    mood: integer("mood"),
    energy: integer("energy"),
    winsJson: text("wins_json").notNull().default("[]"),
    winddownJson: text("winddown_json").notNull().default("[]"),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);

export const pretests = pgTable(
  "pretests",
  {
    userId: text("user_id").notNull(),
    chapterId: text("chapter_id").notNull(),
    correct: integer("correct").notNull(),
    total: integer("total").notNull(),
    gameDay: day("game_day").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.chapterId] })],
);

export const aiCalls = pgTable("ai_calls", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  provider: text("provider").notNull(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costEst: num("cost_est").notNull().default(0),
  requestSummary: text("request_summary").notNull().default(""),
  responseJson: text("response_json").notNull().default("{}"),
  createdAt: ts("created_at").notNull(),
});

export const reminders = pgTable("reminders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: day("date").notNull(),
  anchorKey: text("anchor_key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  dueAt: ts("due_at").notNull(),
  readAt: ts("read_at"),
  createdAt: ts("created_at").notNull(),
});

export const challengeCards = pgTable(
  "challenge_cards",
  {
    userId: text("user_id").notNull(),
    weekNo: integer("week_no").notNull(),
    cardId: text("card_id").notNull(),
    status: text("status").$type<"pending" | "done" | "claimed">().notNull().default("pending"),
    drawnAt: ts("drawn_at").notNull(),
    doneAt: ts("done_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekNo] })],
);

export const seasonClaims = pgTable(
  "season_claims",
  {
    userId: text("user_id").notNull(),
    weekNo: integer("week_no").notNull(),
    rewardJson: text("reward_json").notNull(),
    claimedAt: ts("claimed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekNo] })],
);

export const bossRushes = pgTable("boss_rushes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  weekNo: integer("week_no").notNull(),
  resultsJson: text("results_json").notNull(),
  finishedAt: ts("finished_at").notNull(),
  createdAt: ts("created_at").notNull(),
});

// ── 0009 experiments ────────────────────────────────────────
export const experiments = pgTable("experiments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  changeText: text("change_text").notNull(),
  metric: text("metric").$type<"consistency" | "net" | "focus">().notNull().default("consistency"),
  startDay: day("start_day").notNull(),
  endDay: day("end_day").notNull(),
  status: text("status").$type<"active" | "done" | "cancelled">().notNull().default("active"),
  baselineJson: text("baseline_json").notNull().default("{}"),
  resultJson: text("result_json"),
  createdAt: ts("created_at").notNull(),
  finishedAt: ts("finished_at"),
});

// ── 0010 push ───────────────────────────────────────────────
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: ts("created_at").notNull(),
});

/** Every table, keyed by its SQL name (used by the schema/DDL parity test). */
export const pgTables = {
  users,
  auth_sessions: authSessions,
  events,
  focus_sessions: focusSessions,
  test_logs: testLogs,
  daily_checkins: dailyCheckins,
  subjects,
  chapters,
  courses,
  lessons,
  lesson_chapters: lessonChapters,
  chapter_state: chapterState,
  test_sources: testSources,
  config_versions: configVersions,
  xp_ledger: xpLedger,
  score_ledger: scoreLedger,
  gold_ledger: goldLedger,
  kv,
  quests,
  day_closes: dayCloses,
  shields,
  life_events: lifeEvents,
  user_achievements: userAchievements,
  loot_rolls: lootRolls,
  prereqs,
  weeks,
  week_plan_items: weekPlanItems,
  error_items: errorItems,
  review_cards: reviewCards,
  forge_artifacts: forgeArtifacts,
  habits,
  habit_logs: habitLogs,
  sleep_logs: sleepLogs,
  ideas,
  detours,
  reviews,
  bosses,
  mock_exams: mockExams,
  mock_results: mockResults,
  duels,
  rewards,
  reward_claims: rewardClaims,
  decisions,
  exam_structure: examStructure,
  identity_votes: identityVotes,
  contract_settlements: contractSettlements,
  exploration_topics: explorationTopics,
  exploration_sessions: explorationSessions,
  bond_contacts: bondContacts,
  bond_interactions: bondInteractions,
  reading_logs: readingLogs,
  builder_sessions: builderSessions,
  builder_bank: builderBank,
  story_overrides: storyOverrides,
  review_rounds: reviewRounds,
  league_weeks: leagueWeeks,
  board_claims: boardClaims,
  monthly_badges: monthlyBadges,
  gems_ledger: gemsLedger,
  skill_unlocks: skillUnlocks,
  wellness_logs: wellnessLogs,
  pretests,
  ai_calls: aiCalls,
  reminders,
  challenge_cards: challengeCards,
  season_claims: seasonClaims,
  boss_rushes: bossRushes,
  experiments,
  push_subscriptions: pushSubscriptions,
} as const;
