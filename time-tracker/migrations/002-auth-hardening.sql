PRAGMA foreign_keys = ON;
ALTER TABLE sessions ADD COLUMN last_used_at TEXT;
ALTER TABLE users ADD COLUMN email_verified     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verify_token TEXT;
UPDATE users SET email_verified = 1 WHERE role IN ('admin', 'employee');
CREATE TABLE IF NOT EXISTS login_attempts (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  success    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip    ON login_attempts(ip, created_at);
DROP TABLE IF EXISTS invoice_counters;
CREATE TABLE invoice_counters (
  year     INTEGER PRIMARY KEY,
  next_seq INTEGER NOT NULL DEFAULT 1
);
