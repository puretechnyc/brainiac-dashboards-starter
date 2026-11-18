CREATE TABLE IF NOT EXISTS user_weekly_budgets (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start    TEXT,
  budget_hours  REAL NOT NULL CHECK (budget_hours > 0),
  set_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_weekly_budgets_week
  ON user_weekly_budgets(user_id, week_start) WHERE week_start IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_weekly_budgets_standing
  ON user_weekly_budgets(user_id) WHERE week_start IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_weekly_budgets_user ON user_weekly_budgets(user_id);
CREATE TABLE IF NOT EXISTS hour_budget_grants (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start    TEXT NOT NULL,
  extra_hours   REAL NOT NULL CHECK (extra_hours > 0),
  request_id    TEXT,
  granted_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hour_budget_grants_user_week
  ON hour_budget_grants(user_id, week_start);
CREATE TABLE IF NOT EXISTS hour_budget_requests (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start     TEXT NOT NULL,
  hours          REAL NOT NULL CHECK (hours > 0),
  reason         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','denied')),
  granted_hours  REAL,
  decided_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at     TEXT,
  decision_note  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hour_budget_requests_week
  ON hour_budget_requests(week_start, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hour_budget_requests_pending
  ON hour_budget_requests(user_id, week_start) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS hour_budget_alerts_sent (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start  TEXT NOT NULL,
  threshold   TEXT NOT NULL CHECK (threshold IN ('warning_80','limit_100')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, week_start, threshold)
);
CREATE INDEX IF NOT EXISTS idx_hour_budget_alerts_user_week
  ON hour_budget_alerts_sent(user_id, week_start);
