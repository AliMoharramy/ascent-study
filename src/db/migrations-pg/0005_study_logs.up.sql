CREATE TABLE study_logs (
  id                  text PRIMARY KEY,
  user_id             text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_request_id   text NOT NULL,
  topic               text NOT NULL,
  course_id           text,
  lesson_id           text,
  chapter_id          text,
  studied_on          date NOT NULL,
  source_text         text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'retryable', 'needs_material', 'no_sequence', 'scheduled')),
  decision            text
                        CHECK (decision IS NULL OR decision IN ('schedule', 'no_sequence', 'needs_material')),
  reason              text NOT NULL DEFAULT '',
  analysis_started_at timestamptz,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  UNIQUE (user_id, client_request_id),
  UNIQUE (id, user_id)
);
CREATE INDEX idx_study_logs_user_created ON study_logs(user_id, created_at DESC);

CREATE TABLE study_log_reviews (
  id           text PRIMARY KEY,
  user_id      text NOT NULL,
  study_log_id text NOT NULL,
  checkpoint   integer NOT NULL,
  offset_days  integer NOT NULL,
  front        text NOT NULL,
  back         text NOT NULL,
  scheduled_on date NOT NULL,
  due_on       date NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'done', 'skipped', 'canceled')),
  done_on      date,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  CHECK ((checkpoint, offset_days) IN ((1, 3), (2, 7), (3, 14), (4, 30))),
  UNIQUE (study_log_id, offset_days),
  FOREIGN KEY (study_log_id, user_id) REFERENCES study_logs(id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_study_log_reviews_user_due ON study_log_reviews(user_id, due_on) WHERE status = 'pending';
CREATE INDEX idx_study_log_reviews_log ON study_log_reviews(study_log_id, checkpoint);
