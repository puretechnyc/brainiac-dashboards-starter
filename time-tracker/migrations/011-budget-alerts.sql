CREATE TABLE IF NOT EXISTS budget_alerts_sent (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_start  TEXT NOT NULL,
  threshold   TEXT NOT NULL CHECK (threshold IN ('warning_80', 'exceeded_100', 'under_target_friday')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(client_id, week_start, threshold)
);
CREATE INDEX IF NOT EXISTS idx_budget_alerts_client_week ON budget_alerts_sent(client_id, week_start);
