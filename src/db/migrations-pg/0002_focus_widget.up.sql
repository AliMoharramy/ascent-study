ALTER TABLE users
  ADD COLUMN share_task_titles_with_ai boolean NOT NULL DEFAULT false;

ALTER TABLE focus_sessions
  ADD COLUMN task_title text;

CREATE TABLE personal_tasks (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE INDEX idx_personal_tasks_user_status_created
  ON personal_tasks(user_id, status, created_at DESC);
