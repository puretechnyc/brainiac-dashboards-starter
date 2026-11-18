CREATE TABLE IF NOT EXISTS staff_roles (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('manager')),
  granted_by TEXT,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role)
);
CREATE TABLE IF NOT EXISTS client_assignments (
  user_id     TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  assigned_by TEXT,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_client_assignments_client ON client_assignments(client_id);
CREATE TABLE IF NOT EXISTS client_work_requests (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','denied')),
  note          TEXT NOT NULL DEFAULT '',
  requested_at  TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by    TEXT,
  decided_at    TEXT,
  decision_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_requests_user ON client_work_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_work_requests_status ON client_work_requests(status, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_requests_pending
  ON client_work_requests(user_id, client_id) WHERE status = 'pending';
