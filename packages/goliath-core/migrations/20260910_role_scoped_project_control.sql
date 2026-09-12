PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pc_projects (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('draft','ready','active','on-hold','closing','closed')),
  pm_id TEXT NOT NULL,
  sponsor_id TEXT,
  timezone TEXT NOT NULL,
  baseline_version TEXT,
  baseline_accepted INTEGER NOT NULL DEFAULT 0 CHECK (baseline_accepted IN (0,1)),
  material_outcomes_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (material_outcomes_confirmed IN (0,1)),
  first_work_ready INTEGER NOT NULL DEFAULT 0 CHECK (first_work_ready IN (0,1)),
  required_team_leads_assigned INTEGER NOT NULL DEFAULT 0 CHECK (required_team_leads_assigned IN (0,1)),
  legitimate_evidence_source_available INTEGER NOT NULL DEFAULT 0 CHECK (legitimate_evidence_source_available IN (0,1)),
  baseline_finish TEXT,
  forecast_finish TEXT,
  budget REAL,
  eac REAL,
  currency TEXT,
  evidence_confidence TEXT NOT NULL DEFAULT 'unknown' CHECK (evidence_confidence IN ('high','medium','low','unknown')),
  source_health_summary TEXT NOT NULL DEFAULT 'No source state recorded',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(organisation_id, code)
);

CREATE TABLE IF NOT EXISTS pc_project_members (
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('team-member','delivery-lead','project-manager','program-manager','sponsor','pmo','enterprise-admin')),
  team_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  permissions_json TEXT NOT NULL DEFAULT '[]',
  joined_at TEXT NOT NULL,
  PRIMARY KEY(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS pc_activities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('not-started','in-progress','done','blocked','cancelled')),
  baseline_start TEXT,
  baseline_finish TEXT,
  forecast_finish TEXT,
  actual_start TEXT,
  actual_finish TEXT,
  planned_team_id TEXT,
  current_team_id TEXT,
  owner_id TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('critical','high','medium','low')),
  percent_complete REAL CHECK (percent_complete IS NULL OR (percent_complete >= 0 AND percent_complete <= 100)),
  milestone INTEGER NOT NULL DEFAULT 0 CHECK (milestone IN (0,1)),
  source_system TEXT,
  source_ref TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  blocker TEXT,
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pc_dependencies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  predecessor_activity_id TEXT NOT NULL REFERENCES pc_activities(id) ON DELETE CASCADE,
  successor_activity_id TEXT NOT NULL REFERENCES pc_activities(id) ON DELETE CASCADE,
  gate_type TEXT NOT NULL CHECK (gate_type IN ('finish-to-start','accepted-deliverable')),
  mandatory INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0,1)),
  CHECK (predecessor_activity_id <> successor_activity_id),
  UNIQUE(project_id, predecessor_activity_id, successor_activity_id, gate_type)
);

CREATE TABLE IF NOT EXISTS pc_assignments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL REFERENCES pc_activities(id) ON DELETE CASCADE,
  assignee_id TEXT NOT NULL,
  team_id TEXT,
  support_owner_ids_json TEXT NOT NULL DEFAULT '[]',
  assigned_by TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  ended_at TEXT,
  reason TEXT,
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pc_active_assignment
  ON pc_assignments(activity_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS pc_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  attention_item_id TEXT NOT NULL,
  decision_owner_id TEXT NOT NULL,
  decided_by TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','approved','rejected','selected','superseded')),
  choice TEXT,
  reason TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(project_id, attention_item_id)
);

CREATE TABLE IF NOT EXISTS pc_handoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  source_activity_id TEXT NOT NULL REFERENCES pc_activities(id),
  target_activity_id TEXT NOT NULL REFERENCES pc_activities(id),
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  deliverable_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ready','accepted','returned')),
  required_checks_passed INTEGER NOT NULL,
  required_checks_total INTEGER NOT NULL,
  blocking_conditions_json TEXT NOT NULL DEFAULT '[]',
  non_blocking_conditions_json TEXT NOT NULL DEFAULT '[]',
  attempt INTEGER NOT NULL DEFAULT 1,
  returned_reason TEXT,
  accepted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  CHECK (source_activity_id <> target_activity_id)
);

CREATE TABLE IF NOT EXISTS pc_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  authority TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('current','stale','unavailable','unconfigured')),
  last_observed_at TEXT,
  freshness_hours REAL NOT NULL DEFAULT 48,
  classification TEXT NOT NULL CHECK (classification IN ('public','internal','confidential','restricted')),
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(project_id, source_ref)
);

CREATE TABLE IF NOT EXISTS pc_work_actions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  attention_item_id TEXT,
  activity_id TEXT REFERENCES pc_activities(id),
  type TEXT NOT NULL CHECK (type IN ('corrective','evidence-request','decision-preparation','manual')),
  title TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  due_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('open','done','cancelled')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pc_open_attention_action
  ON pc_work_actions(project_id, attention_item_id, type)
  WHERE attention_item_id IS NOT NULL AND state = 'open';

CREATE TABLE IF NOT EXISTS pc_project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('allowed','denied','recorded')),
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  before_revision INTEGER,
  after_revision INTEGER,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  previous_hash TEXT,
  event_hash TEXT NOT NULL UNIQUE
);

CREATE TRIGGER IF NOT EXISTS trg_pc_project_events_no_update
BEFORE UPDATE ON pc_project_events
BEGIN
  SELECT RAISE(ABORT, 'pc_project_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_pc_project_events_no_delete
BEFORE DELETE ON pc_project_events
BEGIN
  SELECT RAISE(ABORT, 'pc_project_events is append-only');
END;

CREATE TABLE IF NOT EXISTS pc_report_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pc_projects(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('pm','program','sponsor')),
  generated_at TEXT NOT NULL,
  headline TEXT NOT NULL,
  projection_hash TEXT NOT NULL,
  projection_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_pc_activities_project_status ON pc_activities(project_id, status, phase);
CREATE INDEX IF NOT EXISTS idx_pc_activities_owner ON pc_activities(project_id, owner_id, status);
CREATE INDEX IF NOT EXISTS idx_pc_events_project_time ON pc_project_events(project_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_pc_actions_owner_state ON pc_work_actions(project_id, owner_id, state);
CREATE INDEX IF NOT EXISTS idx_pc_handoffs_receiver_state ON pc_handoffs(project_id, receiver_id, state);
CREATE INDEX IF NOT EXISTS idx_pc_decisions_owner_state ON pc_decisions(project_id, decision_owner_id, state);
