ALTER TABLE clients ADD COLUMN week_start_day INTEGER NOT NULL DEFAULT 1
  CHECK (week_start_day >= 0 AND week_start_day <= 6);
