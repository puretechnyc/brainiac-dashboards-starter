CREATE TABLE IF NOT EXISTS member_weights (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  weight     REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
