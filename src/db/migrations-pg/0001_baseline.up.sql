-- ─────────────────────────────────────────────────────────────────────────────
-- Database V2 baseline (PostgreSQL 17) — squashed from SQLite migrations 0001…0010.
--
-- Production starts on an empty database (user decision: do not import data/app.db), so this is a
-- single baseline rather than ten incremental files. It is the source of truth for DDL; the Drizzle
-- mirror in `src/db/schema.pg.ts` is checked against the live database by `npm run test:pg`.
--
-- Type mapping applied here:
--   TEXT timestamps        → timestamptz   (pool parser returns toISOString(), preserving string compares)
--   TEXT game days / dates → date
--   INTEGER booleans       → boolean
--   REAL                   → double precision  (never `real`: 4-byte precision would change XP math)
--   JSON payloads          → text (V2 keeps event bytes identical for replay determinism; jsonb later)
--
-- V2 deltas vs the SQLite schema (approved in the plan):
--   + uq_events_client_request  UNIQUE (user_id, client_request_id)  — makes retry idempotency atomic
--   + uq_users_singleton        UNIQUE ((true))                      — first-run setup cannot race
--   + xp_ledger.week_id + idx_xp_user_week                           — removes SQLite strftime date math
--   + idx_events_user_day_type                                       — hot read path
-- Constraints and FKs are otherwise mirrored verbatim from the SQLite DDL, including its omissions
-- (e.g. experiments.user_id and week_plan_items.chapter_id have no FK today); changing those is a
-- behavioural change and is deliberately left out of the baseline.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── core: users, auth, event log, logging ────────────────────────────────────
CREATE TABLE users (
  id                text PRIMARY KEY,
  username          text NOT NULL UNIQUE,
  name              text NOT NULL,
  password_hash     text NOT NULL,
  locale            text NOT NULL DEFAULT 'en',
  timezone          text NOT NULL DEFAULT 'Asia/Tehran',
  rollover_hour     integer NOT NULL DEFAULT 4,
  theme             text NOT NULL DEFAULT 'night',
  failed_logins     integer NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL
);
-- THE single user (F-CORE-01): the database itself refuses a second account, so two concurrent
-- first-run setup requests cannot both succeed.
CREATE UNIQUE INDEX uq_users_singleton ON users ((true));

-- id = sha256(session token); the raw token only lives in the HttpOnly cookie
CREATE TABLE auth_sessions (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL,
  user_agent    text
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE events (
  id                 text PRIMARY KEY,
  user_id            text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type               text NOT NULL,
  payload_json       text NOT NULL DEFAULT '{}',
  occurred_at        timestamptz NOT NULL,
  client_request_id  text,
  config_version     integer,
  source             text NOT NULL DEFAULT 'app',
  created_at         timestamptz NOT NULL,
  game_day           date,
  -- Retry idempotency is enforced by the database, not by a read-then-insert (NULLs stay distinct).
  CONSTRAINT uq_events_client_request UNIQUE (user_id, client_request_id)
);
CREATE INDEX idx_events_user_time ON events(user_id, occurred_at);
CREATE INDEX idx_events_type ON events(user_id, type);
CREATE INDEX idx_events_user_day ON events(user_id, game_day);
CREATE INDEX idx_events_user_day_type ON events(user_id, game_day, type);

CREATE TABLE focus_sessions (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id    text,
  chapter_id    text,
  kind          text NOT NULL CHECK (kind IN ('video','tests','review','analysis','forge','other')),
  status        text NOT NULL CHECK (status IN ('running','paused','ended')),
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  paused_at     timestamptz,
  paused_ms     integer NOT NULL DEFAULT 0,
  minutes       integer,
  game_day      date NOT NULL,
  surge         boolean NOT NULL DEFAULT false,
  manual        boolean NOT NULL DEFAULT false,
  idle_pauses   integer NOT NULL DEFAULT 0,
  note          text,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);
CREATE INDEX idx_focus_user_day ON focus_sessions(user_id, game_day);
-- at most one open (running/paused) session per user
CREATE UNIQUE INDEX uq_focus_open ON focus_sessions(user_id) WHERE status <> 'ended';

CREATE TABLE test_logs (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    text REFERENCES focus_sessions(id) ON DELETE SET NULL,
  subject_id    text,
  chapter_id    text,
  source_id     text,
  correct       integer NOT NULL CHECK (correct >= 0),
  wrong         integer NOT NULL CHECK (wrong >= 0),
  blank         integer NOT NULL CHECK (blank >= 0),
  choices       integer NOT NULL DEFAULT 4 CHECK (choices >= 2),
  net_pct       double precision NOT NULL,
  game_day      date NOT NULL,
  logged_at     timestamptz NOT NULL,
  manual        boolean NOT NULL DEFAULT false,
  seconds       integer,
  interleaved   boolean NOT NULL DEFAULT false,
  group_id      text,
  note          text,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);
CREATE INDEX idx_tests_user_day ON test_logs(user_id, game_day);

CREATE TABLE daily_checkins (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "date"          date NOT NULL,
  energy_morning  integer CHECK (energy_morning BETWEEN 1 AND 5),
  energy_noon     integer CHECK (energy_noon BETWEEN 1 AND 5),
  energy_night    integer CHECK (energy_night BETWEEN 1 AND 5),
  blocker         text,
  escape_minutes  integer CHECK (escape_minutes >= 0),
  escape_kind     text,
  class_attended  boolean,
  wake_at         text,
  bed_at          text,
  note            text,
  manual          boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  UNIQUE (user_id, "date")
);

-- ── knowledge map: subjects, chapters, courses, lessons ─────────────────────
CREATE TABLE subjects (
  id              text PRIMARY KEY,
  name_fa         text NOT NULL,
  name_en         text NOT NULL,
  "group"         text NOT NULL,
  status          text NOT NULL CHECK (status IN ('active','dropped','optional')),
  mode            text,
  priority_phase  integer,
  sort            integer NOT NULL DEFAULT 0,
  notes           text,
  updated_at      timestamptz NOT NULL
);

CREATE TABLE chapters (
  id            text PRIMARY KEY,
  subject_id    text NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  no            integer NOT NULL,
  title         text NOT NULL,
  optional      boolean NOT NULL DEFAULT false,
  tier          text CHECK (tier IN ('M','S','C')),
  tier_locked   boolean NOT NULL DEFAULT false,
  eq_weight     double precision,
  updated_at    timestamptz NOT NULL,
  UNIQUE (subject_id, no)
);

CREATE TABLE courses (
  id             text PRIMARY KEY,
  user_id        text REFERENCES users(id) ON DELETE CASCADE,
  subject_id     text NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('teaching','tips_tests')),
  title          text NOT NULL,
  instructor     text,
  platform       text,
  sessions       integer,
  duration_min   integer,
  est_hours_min  double precision,
  est_hours_max  double precision,
  estimated      boolean NOT NULL DEFAULT false,
  speed          double precision NOT NULL DEFAULT 1.5,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL
);

CREATE TABLE lessons (
  id            text PRIMARY KEY,
  course_id     text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  no            integer NOT NULL,
  title         text NOT NULL,
  duration_min  double precision NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','watching','done')),
  watched_at    timestamptz,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  UNIQUE (course_id, no)
);

CREATE TABLE lesson_chapters (
  lesson_id   text NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  chapter_id  text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  PRIMARY KEY (lesson_id, chapter_id)
);

CREATE TABLE chapter_state (
  chapter_id        text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  user_id           text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  a0                double precision,
  a                 double precision,
  net_pct           double precision,
  sessions_cleared  integer NOT NULL DEFAULT 0,
  cleared_at        timestamptz,
  last_test_at      timestamptz,
  due_review_at     timestamptz,
  PRIMARY KEY (chapter_id, user_id)
);

CREATE TABLE test_sources (
  id            text PRIMARY KEY,
  user_id       text REFERENCES users(id) ON DELETE CASCADE,
  subject_id    text REFERENCES subjects(id) ON DELETE SET NULL,
  title         text NOT NULL,
  kind          text,
  note          text,
  approx_count  integer,
  count_detail  text,
  purchased     boolean NOT NULL DEFAULT false,
  source_url    text,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz
);

-- ── config versions + ledgers (projections of events) ───────────────────────
CREATE TABLE config_versions (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  json        text NOT NULL,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL,
  UNIQUE (user_id, version)
);

CREATE TABLE xp_ledger (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id     text REFERENCES events(id) ON DELETE CASCADE,
  amount       double precision NOT NULL CHECK (amount >= 0),
  reason       text NOT NULL,
  rule_key     text NOT NULL,
  cap_applied  boolean NOT NULL DEFAULT false,
  week_id      text NOT NULL,
  game_day     date NOT NULL,
  occurred_at  timestamptz NOT NULL
);
CREATE INDEX idx_xp_user_day ON xp_ledger(user_id, game_day);
CREATE INDEX idx_xp_user_week ON xp_ledger(user_id, week_id);

CREATE TABLE score_ledger (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id     text REFERENCES events(id) ON DELETE CASCADE,
  amount       double precision NOT NULL,
  reason       text NOT NULL,
  rule_key     text NOT NULL,
  cap_applied  boolean NOT NULL DEFAULT false,
  week_id      text NOT NULL,
  game_day     date NOT NULL,
  occurred_at  timestamptz NOT NULL
);
CREATE INDEX idx_score_user_week ON score_ledger(user_id, week_id);

-- ── game layer ───────────────────────────────────────────────────────────────
CREATE TABLE gold_ledger (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id     text REFERENCES events(id) ON DELETE CASCADE,
  amount       double precision NOT NULL,
  reason       text NOT NULL,
  rule_key     text NOT NULL,
  game_day     date NOT NULL,
  occurred_at  timestamptz NOT NULL
);
CREATE INDEX idx_gold_user_day ON gold_ledger(user_id, game_day);

CREATE TABLE kv (
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         text NOT NULL,
  json        text NOT NULL,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE quests (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "date"       date NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('core','fixed','pillar','side','comeback','bonus')),
  title        text NOT NULL,
  when_text    text,
  tiers_json   text NOT NULL,
  target_json  text NOT NULL,
  ref_type     text,
  ref_id       text,
  habit_id     text,
  xp           double precision NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','missed','forgiven','waiting')),
  tier_done    text CHECK (tier_done IN ('seed','standard','stretch')),
  progress     double precision NOT NULL DEFAULT 0,
  source       text NOT NULL DEFAULT 'planner',
  sort         integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL
);
CREATE INDEX idx_quests_user_date ON quests(user_id, "date");

CREATE TABLE day_closes (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "date"          date NOT NULL,
  core_tier       text,
  penalty_total   double precision NOT NULL DEFAULT 0,
  standard_day    boolean NOT NULL DEFAULT false,
  seed_day        boolean NOT NULL DEFAULT false,
  missed_core     boolean NOT NULL DEFAULT false,
  shield_used     boolean NOT NULL DEFAULT false,
  life_event      boolean NOT NULL DEFAULT false,
  rules_active    boolean NOT NULL DEFAULT true,
  json            text NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL,
  UNIQUE (user_id, "date")
);

CREATE TABLE shields (
  id             text PRIMARY KEY,
  user_id        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  earned_on      date NOT NULL,
  used_on        date,
  used_for_date  date,
  created_at     timestamptz NOT NULL
);

CREATE TABLE life_events (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "date"      date NOT NULL,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL,
  UNIQUE (user_id, "date")
);

CREATE TABLE user_achievements (
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key          text NOT NULL,
  unlocked_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE loot_rolls (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "date"        date NOT NULL,
  result        text NOT NULL,
  pity_counter  integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL,
  UNIQUE (user_id, "date")
);

CREATE TABLE prereqs (
  chapter_id           text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  requires_chapter_id  text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  PRIMARY KEY (chapter_id, requires_chapter_id)
);

CREATE TABLE weeks (
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  no           integer NOT NULL,
  starts_on    date NOT NULL,
  capacity_h   double precision NOT NULL DEFAULT 0,
  reset_used   boolean NOT NULL DEFAULT false,
  reset_at     timestamptz,
  PRIMARY KEY (user_id, no)
);

CREATE TABLE week_plan_items (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_no       integer NOT NULL,
  chapter_id    text NOT NULL,
  subject_id    text NOT NULL,
  tier          text NOT NULL CHECK (tier IN ('M','S','C')),
  planned_min   integer NOT NULL,
  tests_target  integer NOT NULL DEFAULT 0,
  manual        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL
);
CREATE INDEX idx_plan_user_week ON week_plan_items(user_id, week_no);

CREATE TABLE error_items (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id      text,
  chapter_id      text,
  test_log_id     text,
  cause           text NOT NULL CHECK (cause IN ('concept','calc','time','unread','forgot','careless')),
  takeaway        text NOT NULL,
  source_ref      text,
  repeated_count  integer NOT NULL DEFAULT 0,
  game_day        date NOT NULL,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL
);
CREATE INDEX idx_errors_user ON error_items(user_id, created_at);

CREATE TABLE review_cards (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref_type     text NOT NULL,
  ref_id       text,
  chapter_id   text,
  front        text NOT NULL,
  back         text NOT NULL,
  step         integer NOT NULL DEFAULT -1,
  reps         integer NOT NULL DEFAULT 0,
  due_on       date NOT NULL,
  last_result  text,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL
);
CREATE INDEX idx_cards_due ON review_cards(user_id, due_on);

CREATE TABLE forge_artifacts (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id  text,
  kind        text NOT NULL DEFAULT 'sheet',
  title       text NOT NULL,
  body_md     text NOT NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);

CREATE TABLE habits (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key           text,
  title         text NOT NULL,
  pillar        text NOT NULL CHECK (pillar IN ('mind','body','rest','craft','bonds','learn','read')),
  identity      text NOT NULL DEFAULT '',
  anchor        text NOT NULL DEFAULT '',
  place         text NOT NULL DEFAULT '',
  time_window   text NOT NULL DEFAULT '',
  tiers_json    text NOT NULL,
  metric_json   text NOT NULL,
  temptation    text NOT NULL DEFAULT '',
  env_prep      text NOT NULL DEFAULT '',
  days_per_week integer NOT NULL DEFAULT 7,
  contract_ss   double precision NOT NULL DEFAULT 0,
  xp            double precision NOT NULL DEFAULT 10,
  status        text NOT NULL CHECK (status IN ('proposed','trial','active','mastered','archived')),
  started_on    date,
  sort          integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);

CREATE TABLE habit_logs (
  id          text PRIMARY KEY,
  habit_id    text NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "date"      date NOT NULL,
  tier_done   text CHECK (tier_done IN ('seed','standard','stretch')),
  value       double precision,
  note        text,
  created_at  timestamptz NOT NULL,
  UNIQUE (habit_id, "date")
);

CREATE TABLE sleep_logs (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "date"      date NOT NULL,
  bed_at      text NOT NULL,
  wake_at     text NOT NULL,
  minutes     integer NOT NULL,
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','csv')),
  created_at  timestamptz NOT NULL,
  UNIQUE (user_id, "date")
);

CREATE TABLE ideas (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        text NOT NULL,
  tags        text NOT NULL DEFAULT '',
  value       integer CHECK (value BETWEEN 1 AND 5),
  effort      text CHECK (effort IN ('S','M','L')),
  why_now     text,
  status      text NOT NULL DEFAULT 'parked' CHECK (status IN ('parked','chosen','built','dropped')),
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);

CREATE TABLE detours (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at    timestamptz NOT NULL,
  game_day      date NOT NULL,
  minutes       integer NOT NULL DEFAULT 0,
  kind          text NOT NULL,
  reason        text,
  was_prompted  boolean NOT NULL DEFAULT true,
  choice        text NOT NULL CHECK (choice IN ('study_first','later','continue')),
  created_at    timestamptz NOT NULL
);

CREATE TABLE reviews (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('nightly','weekly','monthly')),
  "date"      date NOT NULL,
  json        text NOT NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  UNIQUE (user_id, kind, "date")
);

CREATE TABLE bosses (
  id             text PRIMARY KEY,
  user_id        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('weekly','region','mini_trial','mock','final')),
  week_no        integer NOT NULL,
  scheduled_for  date NOT NULL,
  spec_json      text NOT NULL,
  threshold_pct  double precision,
  status         text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','skipped')),
  result_pct     double precision,
  defeated       boolean,
  results_json   text,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  UNIQUE (user_id, kind, week_no)
);

CREATE TABLE mock_exams (
  no           integer PRIMARY KEY,
  date_jalali  text NOT NULL,
  questions    integer NOT NULL,
  minutes      integer NOT NULL,
  budget_json  text NOT NULL DEFAULT '{}'
);

CREATE TABLE mock_results (
  id                 text PRIMARY KEY,
  user_id            text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mock_no            integer NOT NULL,
  game_day           date NOT NULL,
  correct            integer NOT NULL,
  wrong              integer NOT NULL,
  blank              integer NOT NULL,
  net_pct            double precision NOT NULL,
  net_pct_no_skip    double precision NOT NULL,
  rank_in_site       integer,
  per_subject_json   text NOT NULL,
  created_at         timestamptz NOT NULL
);

CREATE TABLE duels (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_no       integer NOT NULL,
  rounds_json   text NOT NULL,
  winner        text NOT NULL CHECK (winner IN ('user','shadow','draw')),
  gold_awarded  double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL,
  UNIQUE (user_id, week_no)
);

CREATE TABLE rewards (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  gold_cost   double precision NOT NULL CHECK (gold_cost >= 0),
  money_cost  double precision NOT NULL DEFAULT 0 CHECK (money_cost >= 0),
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL
);

CREATE TABLE reward_claims (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_id   text NOT NULL,
  title       text NOT NULL,
  gold        double precision NOT NULL,
  money       double precision NOT NULL DEFAULT 0,
  month_key   text NOT NULL,
  claimed_at  timestamptz NOT NULL
);

CREATE TABLE decisions (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "date"        date NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL DEFAULT '',
  rationale     text NOT NULL,
  alternatives  text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'accepted' CHECK (status IN ('proposed','accepted','superseded','rejected')),
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);

-- ── reference data (seed-owned, global rows) ────────────────────────────────
CREATE TABLE exam_structure (
  id                        text PRIMARY KEY,
  year_jalali               integer NOT NULL,
  group_code                integer NOT NULL,
  name_fa                   text NOT NULL,
  coefficients_json         text NOT NULL,
  per_subject_json          text NOT NULL,
  total_questions           integer,
  duration_min              integer,
  wrong_penalty             double precision NOT NULL,
  counts_assumed            boolean NOT NULL DEFAULT true,
  source_url                text,
  coefficients_source_url   text,
  note                      text,
  updated_at                timestamptz NOT NULL
);

-- ── life pillars ────────────────────────────────────────────────────────────
CREATE TABLE identity_votes (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id    text,
  game_day    date NOT NULL,
  vote        text NOT NULL CHECK (vote IN ('for','against')),
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL,
  UNIQUE (user_id, habit_id, game_day)
);

CREATE TABLE contract_settlements (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id    text NOT NULL,
  game_day    date NOT NULL,
  amount      double precision NOT NULL,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL,
  UNIQUE (user_id, habit_id, game_day)
);

CREATE TABLE exploration_topics (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  why          text NOT NULL DEFAULT '',
  value        integer NOT NULL DEFAULT 3 CHECK (value BETWEEN 1 AND 5),
  status       text NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','trial','active','archived')),
  started_on   date,
  archived_on  date,
  gate_note    text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL
);

CREATE TABLE exploration_sessions (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id    text NOT NULL,
  game_day    date NOT NULL,
  minutes     integer NOT NULL DEFAULT 0,
  kind        text NOT NULL DEFAULT 'trial' CHECK (kind IN ('trial','review','output')),
  output      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL
);
CREATE INDEX idx_exploration_sessions_user_day ON exploration_sessions(user_id, game_day);

CREATE TABLE bond_contacts (
  id               text PRIMARY KEY,
  user_id          text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  relation         text NOT NULL DEFAULT '',
  last_contact_on  date,
  reminder_days    integer NOT NULL DEFAULT 14 CHECK (reminder_days BETWEEN 1 AND 365),
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL
);

CREATE TABLE bond_interactions (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id  text NOT NULL,
  game_day    date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('message','call','meet','collective')),
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL
);
CREATE INDEX idx_bond_interactions_user_day ON bond_interactions(user_id, game_day);

CREATE TABLE reading_logs (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_day    date NOT NULL,
  book        text NOT NULL,
  pages       integer NOT NULL DEFAULT 0,
  minutes     integer NOT NULL DEFAULT 0,
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL,
  UNIQUE (user_id, game_day, book)
);

CREATE TABLE builder_sessions (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_day    date NOT NULL,
  minutes     integer NOT NULL,
  built       text NOT NULL DEFAULT '',
  idea_id     text,
  created_at  timestamptz NOT NULL
);

CREATE TABLE builder_bank (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_day    date NOT NULL,
  minutes     integer NOT NULL,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL
);
CREATE INDEX idx_builder_bank_user_day ON builder_bank(user_id, game_day);

CREATE TABLE story_overrides (
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_no  integer NOT NULL,
  start_text  text NOT NULL,
  end_text    text NOT NULL,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, chapter_no)
);

CREATE TABLE review_rounds (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id    text NOT NULL,
  round         integer NOT NULL CHECK (round IN (1,2,3)),
  scheduled_on  date NOT NULL,
  done_on       date,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  note          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL,
  UNIQUE (user_id, subject_id, round)
);

CREATE TABLE league_weeks (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_no      integer NOT NULL,
  tier         integer NOT NULL CHECK (tier BETWEEN 1 AND 10),
  seed         text NOT NULL,
  my_xp        double precision NOT NULL DEFAULT 0,
  result_json  text NOT NULL DEFAULT '{}',
  settled_at   timestamptz,
  created_at   timestamptz NOT NULL,
  UNIQUE (user_id, week_no)
);

CREATE TABLE board_claims (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_day    date NOT NULL,
  gold        double precision NOT NULL DEFAULT 0,
  loot        text NOT NULL DEFAULT 'none',
  created_at  timestamptz NOT NULL,
  UNIQUE (user_id, game_day)
);

CREATE TABLE monthly_badges (
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_key   text NOT NULL,
  badge       text NOT NULL,
  awarded_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, month_key)
);

-- ── R3 extras + R4 intelligence ─────────────────────────────────────────────
CREATE TABLE gems_ledger (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      double precision NOT NULL,
  rule_key    text NOT NULL,
  note        text NOT NULL DEFAULT '',
  game_day    date,
  created_at  timestamptz NOT NULL
);

CREATE TABLE skill_unlocks (
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id     text NOT NULL,
  tier         integer NOT NULL,
  cost_gems    double precision NOT NULL,
  unlocked_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE wellness_logs (
  user_id        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "date"         date NOT NULL,
  mood           integer,
  energy         integer,
  wins_json      text NOT NULL DEFAULT '[]',
  winddown_json  text NOT NULL DEFAULT '[]',
  updated_at     timestamptz NOT NULL,
  PRIMARY KEY (user_id, "date")
);

CREATE TABLE pretests (
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id  text NOT NULL,
  correct     integer NOT NULL,
  total       integer NOT NULL,
  game_day    date NOT NULL,
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, chapter_id)
);

CREATE TABLE ai_calls (
  id               text PRIMARY KEY,
  user_id          text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose          text NOT NULL,
  model            text NOT NULL,
  provider         text NOT NULL,
  tokens_in        integer NOT NULL DEFAULT 0,
  tokens_out       integer NOT NULL DEFAULT 0,
  cost_est         double precision NOT NULL DEFAULT 0,
  request_summary  text NOT NULL DEFAULT '',
  response_json    text NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL
);

CREATE TABLE reminders (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "date"      date NOT NULL,
  anchor_key  text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  due_at      timestamptz NOT NULL,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL,
  UNIQUE (user_id, "date", anchor_key)
);

CREATE TABLE challenge_cards (
  user_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_no   integer NOT NULL,
  card_id   text NOT NULL,
  status    text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','claimed')),
  drawn_at  timestamptz NOT NULL,
  done_at   timestamptz,
  PRIMARY KEY (user_id, week_no)
);

CREATE TABLE season_claims (
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_no      integer NOT NULL,
  reward_json  text NOT NULL,
  claimed_at   timestamptz NOT NULL,
  PRIMARY KEY (user_id, week_no)
);

CREATE TABLE boss_rushes (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_no       integer NOT NULL,
  results_json  text NOT NULL,
  finished_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL
);

-- ── experiments ─────────────────────────────────────────────────────────────
CREATE TABLE experiments (
  id             text PRIMARY KEY,
  user_id        text NOT NULL,
  change_text    text NOT NULL,
  metric         text NOT NULL DEFAULT 'consistency',
  start_day      date NOT NULL,
  end_day        date NOT NULL,
  status         text NOT NULL DEFAULT 'active',
  baseline_json  text NOT NULL DEFAULT '{}',
  result_json    text,
  created_at     timestamptz NOT NULL,
  finished_at    timestamptz
);
CREATE INDEX idx_experiments_user ON experiments(user_id, status);

-- ── push subscriptions (opt-in) ─────────────────────────────────────────────
CREATE TABLE push_subscriptions (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz NOT NULL
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
