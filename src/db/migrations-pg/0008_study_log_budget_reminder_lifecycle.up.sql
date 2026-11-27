ALTER TABLE ai_calls
  ADD COLUMN usage_status text NOT NULL DEFAULT 'estimated'
    CHECK (usage_status IN ('actual', 'estimated', 'unknown'));

ALTER TABLE reminders
  ADD COLUMN dismissed_at timestamptz;
