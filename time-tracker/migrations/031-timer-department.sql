ALTER TABLE active_timers ADD COLUMN department_id TEXT REFERENCES departments(id) ON DELETE SET NULL;
