CREATE TABLE IF NOT EXISTS active_timers (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  project_task  TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  started_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_timers_user ON active_timers(user_id);
