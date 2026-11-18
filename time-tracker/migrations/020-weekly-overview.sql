ALTER TABLE time_entries ADD COLUMN source TEXT
  CHECK (source IS NULL OR source IN ('timer','manual','import'));
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
