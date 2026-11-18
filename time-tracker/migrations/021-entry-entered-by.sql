ALTER TABLE time_entries ADD COLUMN entered_by TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_entries_entered_by ON time_entries(entered_by);
