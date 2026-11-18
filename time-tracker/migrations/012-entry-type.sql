ALTER TABLE time_entries ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'work'
  CHECK (entry_type IN ('work', 'break', 'time_off', 'sick', 'holiday'));
