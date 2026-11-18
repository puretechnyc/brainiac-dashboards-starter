CREATE TABLE IF NOT EXISTS goals_sync_runs (
  id                    TEXT PRIMARY KEY,
  started_at            TEXT NOT NULL,
  finished_at           TEXT NOT NULL,
  created_count         INTEGER NOT NULL DEFAULT 0,
  updated_count         INTEGER NOT NULL DEFAULT 0,
  skipped_count         INTEGER NOT NULL DEFAULT 0,
  north_stars_updated   INTEGER NOT NULL DEFAULT 0,
  north_stars_skipped   INTEGER NOT NULL DEFAULT 0,
  unmapped_clients      TEXT NOT NULL DEFAULT '[]',
  partial               INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'ok'
                        CHECK (status IN ('ok','partial'))
);
CREATE INDEX IF NOT EXISTS idx_goals_sync_runs_started ON goals_sync_runs(started_at);
