PRAGMA foreign_keys = ON;
ALTER TABLE clients ADD COLUMN billing_model TEXT NOT NULL DEFAULT 'hourly'
  CHECK (billing_model IN ('hourly','milestone_weekly','monthly_retainer'));
ALTER TABLE clients ADD COLUMN weekly_rate_cents INTEGER;
ALTER TABLE clients ADD COLUMN monthly_retainer_cents INTEGER;
CREATE TABLE IF NOT EXISTS member_client_weights (
  user_id                        TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  client_id                      TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  logged_hours_per_allotment_hour REAL NOT NULL DEFAULT 1
                                 CHECK (logged_hours_per_allotment_hour > 0),
  created_at                     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_mcw_client ON member_client_weights(client_id);
