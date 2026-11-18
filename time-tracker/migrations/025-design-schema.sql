CREATE TABLE IF NOT EXISTS departments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_departments_sort ON departments(sort_order, name);
ALTER TABLE time_entries ADD COLUMN department_id TEXT REFERENCES departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_entries_department ON time_entries(department_id);
INSERT OR IGNORE INTO departments (id, name, sort_order, hidden) VALUES
  ('dept_admin',             'Admin',              1, 0),
  ('dept_ads_management',    'Ads Management',     2, 0),
  ('dept_graphic_design',    'Graphic Design',     3, 0),
  ('dept_project_manager',   'Project Manager',    4, 0),
  ('dept_seo',               'SEO',                5, 0),
  ('dept_social_media',      'Social Media',       6, 0),
  ('dept_technology',        'Technology',         7, 0),
  ('dept_video',             'Video',              8, 0),
  ('dept_paid_ads',          'Paid Ads',           9, 0);
UPDATE time_entries SET department_id = 'dept_admin'
 WHERE department_id IS NULL AND project_id IN (SELECT id FROM projects WHERE name = 'Admin');
UPDATE time_entries SET department_id = 'dept_ads_management'
 WHERE department_id IS NULL AND project_id IN (SELECT id FROM projects WHERE name = 'Ads Management');
UPDATE time_entries SET department_id = 'dept_graphic_design'
 WHERE department_id IS NULL AND project_id IN (SELECT id FROM projects WHERE name = 'Graphic Design');
UPDATE time_entries SET department_id = 'dept_project_manager'
 WHERE department_id IS NULL AND project_id IN (SELECT id FROM projects WHERE name = 'Project Manager');
UPDATE time_entries SET department_id = 'dept_seo'
 WHERE department_id IS NULL AND project_id IN (SELECT id FROM projects WHERE name = 'SEO');
UPDATE time_entries SET department_id = 'dept_social_media'
 WHERE department_id IS NULL AND project_id IN (SELECT id FROM projects WHERE name IN ('Social Media Management', 'Social Media Manager'));
UPDATE time_entries SET department_id = 'dept_technology'
 WHERE department_id IS NULL AND project_id IN (SELECT id FROM projects WHERE name = 'Technology');
UPDATE time_entries SET department_id = 'dept_video'
 WHERE department_id IS NULL AND project_id IN (SELECT id FROM projects WHERE name = 'Video Creator');
UPDATE time_entries SET department_id = 'dept_paid_ads'
 WHERE department_id IS NULL AND project_id IN (SELECT id FROM projects WHERE name = 'Paid Ads');
CREATE TABLE IF NOT EXISTS client_billing (
  client_id           TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  billing_model       TEXT
                      CHECK (billing_model IS NULL OR billing_model IN ('fixed_project','profit_share')),
  fixed_amount_cents  INTEGER,
  fixed_start         TEXT,
  fixed_end           TEXT,
  profit_pct          REAL,
  profit_base         TEXT,
  updated_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE clients ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS invoice_voids (
  id               TEXT PRIMARY KEY,
  invoice_id       TEXT NOT NULL,
  invoice_number   TEXT NOT NULL DEFAULT '',
  client_id        TEXT,
  voided_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  voided_by_email  TEXT NOT NULL DEFAULT '',
  reason           TEXT NOT NULL DEFAULT '',
  hours_released   REAL NOT NULL DEFAULT 0,
  entries_released INTEGER NOT NULL DEFAULT 0,
  amount_released_cents INTEGER NOT NULL DEFAULT 0,
  snapshot         TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_voids_invoice ON invoice_voids(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_voids_created ON invoice_voids(created_at);
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('goal_mode', 'auto', datetime('now')),
  ('lock_schedule', '{"cadence":"weekly","weekday":0,"time":"23:59","timezone":"America/New_York"}', datetime('now'));
