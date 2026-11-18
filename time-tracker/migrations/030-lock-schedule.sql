CREATE TABLE IF NOT EXISTS lock_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  through_date      TEXT    NOT NULL,
  entries_locked    INTEGER NOT NULL DEFAULT 0,
  timesheets_locked INTEGER NOT NULL DEFAULT 0,
  source            TEXT    NOT NULL,
  ran_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  ran_by            TEXT
);
CREATE INDEX IF NOT EXISTS idx_lock_runs_ran ON lock_runs(ran_at);
