PRAGMA foreign_keys = OFF;
CREATE TABLE invoices_new (
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
INSERT INTO invoices_new (id, client_id, created_by, invoice_number, period_start, period_end,
  status, currency, total_hours, subtotal_cents, total_cents, notes, created_at)
SELECT id, client_id, created_by, invoice_number, period_start, period_end,
  status, currency, total_hours, subtotal_cents, total_cents, notes, created_at
FROM invoices;
DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
PRAGMA foreign_keys = ON;
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
