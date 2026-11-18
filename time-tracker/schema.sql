PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  rate_cents    INTEGER NOT NULL DEFAULT 0,
  hours_cap     REAL,
  contact_name  TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  paypal_email  TEXT NOT NULL DEFAULT '',
  currency      TEXT NOT NULL DEFAULT 'USD',
  archived      INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  pbkdf2_iters  INTEGER NOT NULL DEFAULT 210000,
  role          TEXT NOT NULL DEFAULT 'employee'
                CHECK (role IN ('admin','employee','client')),
  client_id     TEXT REFERENCES clients(id) ON DELETE CASCADE,
  email_verified     INTEGER NOT NULL DEFAULT 0,
  email_verify_token TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (role = 'client'   AND client_id IS NOT NULL) OR
    (role IN ('admin','employee') AND client_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_users_client ON users(client_id);
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  success    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip    ON login_attempts(ip, created_at);
CREATE TABLE IF NOT EXISTS timesheets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  week_start   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','submitted','approved','rejected')),
  approved_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at  TEXT,
  submitted_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, client_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_timesheets_user   ON timesheets(user_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_client ON timesheets(client_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_week   ON timesheets(week_start);
CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets(status);
CREATE TRIGGER IF NOT EXISTS trg_timesheets_approved_no_regress
BEFORE UPDATE ON timesheets
FOR EACH ROW WHEN OLD.status = 'approved' AND NEW.status <> 'approved'
BEGIN
  SELECT RAISE(ABORT, 'timesheet is approved and immutable');
END;
CREATE TABLE IF NOT EXISTS time_entries (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  project_task    TEXT NOT NULL DEFAULT '',
  entry_date      TEXT NOT NULL,
  hours           REAL NOT NULL CHECK (hours >= 0),
  rate_cents      INTEGER NOT NULL DEFAULT 0,
  is_billable     INTEGER NOT NULL DEFAULT 1,
  notes           TEXT NOT NULL DEFAULT '',
  approval_status TEXT NOT NULL DEFAULT 'open'
                  CHECK (approval_status IN ('open','submitted','approved','rejected')),
  approved_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TEXT,
  locked          INTEGER NOT NULL DEFAULT 0,
  invoice_id      TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  timesheet_id    TEXT REFERENCES timesheets(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entries_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_entries_client ON time_entries(client_id);
CREATE INDEX IF NOT EXISTS idx_entries_date ON time_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_entries_invoice ON time_entries(invoice_id);
CREATE INDEX IF NOT EXISTS idx_entries_status ON time_entries(approval_status);
CREATE INDEX IF NOT EXISTS idx_entries_timesheet ON time_entries(timesheet_id);
CREATE TABLE IF NOT EXISTS entry_edit_override (
  entry_id   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS entry_deletions (
  id           TEXT PRIMARY KEY,
  entry_id     TEXT NOT NULL,
  deleted_by   TEXT NOT NULL,
  reason       TEXT NOT NULL DEFAULT '',
  was_approved INTEGER NOT NULL DEFAULT 0,
  snapshot     TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entry_deletions_entry ON entry_deletions(entry_id);
CREATE TRIGGER IF NOT EXISTS trg_time_entries_locked_no_update
BEFORE UPDATE ON time_entries
FOR EACH ROW WHEN OLD.locked = 1
  AND NOT (OLD.invoice_id IS NULL AND EXISTS (SELECT 1 FROM entry_edit_override o WHERE o.entry_id = OLD.id))
  AND (
     NEW.hours           <> OLD.hours
  OR NEW.rate_cents       <> OLD.rate_cents
  OR NEW.entry_date       <> OLD.entry_date
  OR NEW.client_id        <> OLD.client_id
  OR NEW.user_id          <> OLD.user_id
  OR NEW.project_task     <> OLD.project_task
  OR NEW.is_billable      <> OLD.is_billable
  OR NEW.notes            <> OLD.notes
  OR NEW.approval_status  <> OLD.approval_status
  OR NEW.locked           <> OLD.locked
  OR NEW.timesheet_id IS NOT OLD.timesheet_id
  OR (OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS NOT OLD.invoice_id)
)
BEGIN
  SELECT RAISE(ABORT, 'time_entry is approved+locked and immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_time_entries_locked_no_delete
BEFORE DELETE ON time_entries
FOR EACH ROW WHEN OLD.locked = 1
  AND NOT (OLD.invoice_id IS NULL AND EXISTS (SELECT 1 FROM entry_edit_override o WHERE o.entry_id = OLD.id))
BEGIN
  SELECT RAISE(ABORT, 'time_entry is approved+locked and immutable');
END;
CREATE TABLE IF NOT EXISTS invoices (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  period_start   TEXT NOT NULL,
  period_end     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','sent','paid','void','partially_paid')),
  currency       TEXT NOT NULL DEFAULT 'USD',
  total_hours    REAL NOT NULL DEFAULT 0,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL DEFAULT 0,
  notes          TEXT NOT NULL DEFAULT '',
  due_date       TEXT,
  paid_at        TEXT,
  paid_amount_cents INTEGER NOT NULL DEFAULT 0,
  sent_at        TEXT,
  sent_to        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE TABLE IF NOT EXISTS invoice_payments (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_method TEXT NOT NULL DEFAULT '',
  reference      TEXT NOT NULL DEFAULT '',
  paid_at        TEXT NOT NULL DEFAULT (datetime('now')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  time_entry_id TEXT REFERENCES time_entries(id) ON DELETE SET NULL,
  description   TEXT NOT NULL DEFAULT '',
  hours         REAL NOT NULL DEFAULT 0,
  rate_cents    INTEGER NOT NULL DEFAULT 0,
  amount_cents  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lineitems_invoice ON invoice_line_items(invoice_id);
CREATE TABLE IF NOT EXISTS invoice_counters (
  year     INTEGER PRIMARY KEY,
  next_seq INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  page        TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','done')),
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
