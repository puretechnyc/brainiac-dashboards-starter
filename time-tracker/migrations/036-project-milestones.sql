CREATE TABLE IF NOT EXISTS client_project_milestones (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label         TEXT NOT NULL DEFAULT '',
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  release_date  TEXT NOT NULL,
  released      INTEGER NOT NULL DEFAULT 0 CHECK (released IN (0,1)),
  landed_date   TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_client_project_milestones_client
  ON client_project_milestones(client_id, release_date);
CREATE INDEX IF NOT EXISTS idx_client_project_milestones_release
  ON client_project_milestones(release_date);
