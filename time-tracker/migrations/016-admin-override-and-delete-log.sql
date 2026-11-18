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
DROP TRIGGER IF EXISTS trg_time_entries_locked_no_update;
CREATE TRIGGER trg_time_entries_locked_no_update
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
DROP TRIGGER IF EXISTS trg_time_entries_locked_no_delete;
CREATE TRIGGER trg_time_entries_locked_no_delete
BEFORE DELETE ON time_entries
FOR EACH ROW WHEN OLD.locked = 1
  AND NOT (OLD.invoice_id IS NULL AND EXISTS (SELECT 1 FROM entry_edit_override o WHERE o.entry_id = OLD.id))
BEGIN
  SELECT RAISE(ABORT, 'time_entry is approved+locked and immutable');
END;
