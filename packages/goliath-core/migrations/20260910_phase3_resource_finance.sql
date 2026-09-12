PRAGMA foreign_keys = ON;

-- Phase 3 extends the same central GOLIATH model with resource/capacity and finance facts.
-- No role-, dashboard- or report-specific project truth is stored here.

CREATE TABLE IF NOT EXISTS rc_resources (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  display_name TEXT NOT NULL,
  organisation_id TEXT NOT NULL REFERENCES ec_organisations(id),
  org_unit_id TEXT NOT NULL REFERENCES ec_org_units(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  skills_json TEXT NOT NULL DEFAULT '[]',
  weekly_contract_hours REAL NOT NULL CHECK (weekly_contract_hours >= 0),
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rc_resource_user_org
  ON rc_resources(organisation_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rc_resources_unit ON rc_resources(org_unit_id, active);

CREATE TABLE IF NOT EXISTS rc_capacity_periods (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES rc_resources(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  gross_hours REAL NOT NULL CHECK (gross_hours >= 0),
  unavailable_hours REAL NOT NULL DEFAULT 0 CHECK (unavailable_hours >= 0 AND unavailable_hours <= gross_hours),
  source_ref TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  CHECK (period_end >= period_start),
  UNIQUE(resource_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_rc_capacity_window ON rc_capacity_periods(resource_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS rc_allocations (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES rc_resources(id),
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  activity_id TEXT REFERENCES pc_activities(id) ON DELETE SET NULL,
  team_id TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  hours REAL NOT NULL CHECK (hours >= 0),
  status TEXT NOT NULL CHECK (status IN ('requested','confirmed','released')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reason TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_rc_allocations_resource_window ON rc_allocations(resource_id, period_start, period_end, status);
CREATE INDEX IF NOT EXISTS idx_rc_allocations_project ON rc_allocations(project_id, status);

CREATE TABLE IF NOT EXISTS rc_demands (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  team_id TEXT,
  org_unit_id TEXT REFERENCES ec_org_units(id),
  skill TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  required_hours REAL NOT NULL CHECK (required_hours > 0),
  state TEXT NOT NULL CHECK (state IN ('open','partially-filled','filled','cancelled')),
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_rc_demands_project_window ON rc_demands(project_id, period_start, period_end, state);
CREATE INDEX IF NOT EXISTS idx_rc_demands_unit ON rc_demands(org_unit_id, state);

CREATE TABLE IF NOT EXISTS fin_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('actual','commitment','accrual','credit','revenue','benefit')),
  amount REAL NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('internal','confidential','restricted')),
  description TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(source_system, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_fin_entries_project_type ON fin_entries(project_id, entry_type, occurred_at);

CREATE TABLE IF NOT EXISTS fin_forecast_inputs (
  project_id TEXT PRIMARY KEY REFERENCES pc_projects(id) ON DELETE CASCADE,
  etc_amount REAL NOT NULL DEFAULT 0 CHECK (etc_amount >= 0),
  contingency_amount REAL NOT NULL DEFAULT 0 CHECK (contingency_amount >= 0),
  projected_revenue REAL,
  benefit_forecast REAL,
  currency TEXT NOT NULL,
  as_of TEXT NOT NULL,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  updated_by TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  CHECK (projected_revenue IS NULL OR projected_revenue >= 0),
  CHECK (benefit_forecast IS NULL OR benefit_forecast >= 0)
);
