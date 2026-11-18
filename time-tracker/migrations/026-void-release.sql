SELECT 1 FROM invoice_voids LIMIT 1;
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
  OR (OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS NOT OLD.invoice_id
      AND NOT EXISTS (SELECT 1 FROM invoice_voids v WHERE v.invoice_id = OLD.invoice_id))
  )
BEGIN
  SELECT RAISE(ABORT, 'time_entry is approved+locked and immutable');
END;
