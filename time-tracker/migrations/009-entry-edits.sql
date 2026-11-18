CREATE TABLE IF NOT EXISTS entry_edits (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_name  TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entry_edits_entry ON entry_edits(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_edits_created ON entry_edits(created_at);
