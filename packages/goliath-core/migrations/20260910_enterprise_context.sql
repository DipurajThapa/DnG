PRAGMA foreign_keys = ON;

-- Phase 2 adds enterprise hierarchy and responsibility context to the same central database.
-- These are canonical hierarchy/access records, not role-specific copies of project status.

CREATE TABLE IF NOT EXISTS ec_organisations (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ec_portfolios (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES ec_organisations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(organisation_id, code)
);

CREATE TABLE IF NOT EXISTS ec_programs (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES ec_portfolios(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(portfolio_id, code)
);

CREATE TABLE IF NOT EXISTS ec_org_units (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES ec_organisations(id),
  parent_unit_id TEXT REFERENCES ec_org_units(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  CHECK (parent_unit_id IS NULL OR parent_unit_id <> id),
  UNIQUE(organisation_id, code)
);

CREATE TABLE IF NOT EXISTS ec_project_context (
  project_id TEXT PRIMARY KEY REFERENCES pc_projects(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES ec_organisations(id),
  portfolio_id TEXT REFERENCES ec_portfolios(id),
  program_id TEXT REFERENCES ec_programs(id),
  bound_at TEXT NOT NULL,
  bound_by TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ec_responsibility_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'sponsor','portfolio-manager','program-manager','project-director','project-manager','pmo',
    'resource-manager','delivery-lead','agile-delivery-lead','team-member','enterprise-admin'
  )),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('organisation','portfolio','program','project','org-unit')),
  scope_id TEXT NOT NULL,
  team_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  permissions_json TEXT NOT NULL DEFAULT '[]',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_by TEXT,
  revoked_at TEXT,
  revocation_reason TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK ((active = 1 AND revoked_at IS NULL) OR active = 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ec_active_responsibility
  ON ec_responsibility_assignments(user_id, role, scope_type, scope_id, IFNULL(team_id,''))
  WHERE active = 1;

CREATE INDEX IF NOT EXISTS idx_ec_responsibility_user_active
  ON ec_responsibility_assignments(user_id, active, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_ec_project_context_program ON ec_project_context(program_id, project_id);
CREATE INDEX IF NOT EXISTS idx_ec_project_context_portfolio ON ec_project_context(portfolio_id, project_id);
CREATE INDEX IF NOT EXISTS idx_ec_org_units_parent ON ec_org_units(organisation_id, parent_unit_id);

CREATE TABLE IF NOT EXISTS ec_context_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  assignment_id TEXT,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('allowed','denied','recorded')),
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  previous_hash TEXT,
  event_hash TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_ec_context_events_scope_time
  ON ec_context_events(scope_type, scope_id, occurred_at);

CREATE TRIGGER IF NOT EXISTS trg_ec_context_events_no_update
BEFORE UPDATE ON ec_context_events
BEGIN
  SELECT RAISE(ABORT, 'ec_context_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_ec_context_events_no_delete
BEFORE DELETE ON ec_context_events
BEGIN
  SELECT RAISE(ABORT, 'ec_context_events is append-only');
END;
