ALTER TABLE study_logs
  ADD COLUMN request_fingerprint text;

ALTER TABLE ai_calls
  ADD COLUMN game_day date,
  ADD COLUMN budget_month text;

CREATE TABLE ai_budget_reservations (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id    text NOT NULL,
  purpose       text NOT NULL,
  game_day      date NOT NULL,
  budget_month  text NOT NULL CHECK (budget_month ~ '^[0-9]{4}-[0-9]{2}$'),
  reserved_cost double precision NOT NULL CHECK (reserved_cost >= 0),
  settled_cost  double precision NOT NULL DEFAULT 0 CHECK (settled_cost >= 0),
  status        text NOT NULL CHECK (status IN ('reserved', 'settled', 'uncertain')),
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  UNIQUE (user_id, request_id)
);
CREATE INDEX idx_ai_budget_reservations_user_day ON ai_budget_reservations(user_id, game_day, status);
CREATE INDEX idx_ai_budget_reservations_user_month ON ai_budget_reservations(user_id, budget_month, status);

ALTER TABLE ai_calls
  ADD COLUMN reservation_id text REFERENCES ai_budget_reservations(id) ON DELETE SET NULL;
