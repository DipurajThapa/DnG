-- Phase 7 adds one justified canonical resource fact: actual worklog effort.
-- Planned allocation and actual effort are not the same business fact.
CREATE TABLE IF NOT EXISTS rc_worklogs (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES rc_resources(id),
  project_id TEXT NOT NULL REFERENCES pc_projects(id),
  activity_id TEXT REFERENCES pc_activities(id),
  work_date TEXT NOT NULL,
  hours REAL NOT NULL CHECK(hours >= 0),
  billable INTEGER NOT NULL DEFAULT 0,
  source_system TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(source_system, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_worklogs_project_date ON rc_worklogs(project_id, work_date);
CREATE INDEX IF NOT EXISTS idx_worklogs_resource_date ON rc_worklogs(resource_id, work_date);
