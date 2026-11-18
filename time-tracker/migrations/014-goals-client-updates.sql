CREATE TABLE IF NOT EXISTS client_updates (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_start    TEXT NOT NULL,
  week_label    TEXT NOT NULL DEFAULT '',
  team_member   TEXT NOT NULL DEFAULT '',
  goals         TEXT NOT NULL DEFAULT '',
  achievements  TEXT NOT NULL DEFAULT '',
  department    TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT '',
  is_internal   INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_client_updates_client ON client_updates(client_id);
CREATE INDEX IF NOT EXISTS idx_client_updates_week   ON client_updates(week_start);
CREATE INDEX IF NOT EXISTS idx_client_updates_combo  ON client_updates(client_id, week_start);
CREATE TABLE IF NOT EXISTS client_north_stars (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  statement     TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(client_id)
);
