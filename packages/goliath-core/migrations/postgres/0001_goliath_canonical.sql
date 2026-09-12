-- GOLIATH PostgreSQL canonical schema
-- Phase 1-8 logical model, ordered for PostgreSQL FK creation.
-- SQLite-specific PRAGMA/trigger syntax is replaced only where required by PostgreSQL.
BEGIN;

-- GOLIATH B14-B16 additive migration. Designed to extend, not replace, existing project/baseline/audit records.

CREATE TABLE IF NOT EXISTS integration_bindings_v2 (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  authority_mode TEXT NOT NULL,
  inbound_fields_json TEXT NOT NULL,
  outbound_actions_json TEXT NOT NULL,
  classification TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organisation_id, project_id, domain, provider, environment)
);

CREATE TABLE IF NOT EXISTS external_object_links_v2 (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  binding_id TEXT NOT NULL REFERENCES integration_bindings_v2(id),
  provider_account_id TEXT NOT NULL,
  provider_environment TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  local_entity_type TEXT NOT NULL,
  local_entity_id TEXT NOT NULL,
  mapping_version INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  tombstoned_at TEXT,
  UNIQUE(binding_id, provider_account_id, provider_environment, resource_type, external_id, mapping_version)
);

CREATE TABLE IF NOT EXISTS integration_inbox_v2 (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  binding_id TEXT NOT NULL REFERENCES integration_bindings_v2(id),
  provider_event_id TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  provider_resource_type TEXT NOT NULL,
  source_version TEXT NOT NULL,
  source_effective_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  state TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(binding_id, provider_account_id, provider_resource_type, provider_event_id)
);

CREATE TABLE IF NOT EXISTS effect_intents_v2 (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  binding_id TEXT NOT NULL REFERENCES integration_bindings_v2(id),
  domain TEXT NOT NULL,
  action TEXT NOT NULL,
  target_resource_type TEXT NOT NULL,
  target_external_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  approval_id TEXT,
  approval_version TEXT,
  approval_organisation_id TEXT,
  approval_project_id TEXT,
  approval_binding_id TEXT,
  approval_action TEXT,
  approval_target_external_id TEXT,
  approval_payload_digest TEXT,
  approval_approved_by TEXT,
  approval_approved_at TEXT,
  approval_expires_at TEXT,
  requested_by TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_receipt_id TEXT,
  provider_reference TEXT,
  last_error TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_receipts_v2 (
  id TEXT PRIMARY KEY,
  effect_intent_id TEXT NOT NULL REFERENCES effect_intents_v2(id),
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  result TEXT NOT NULL,
  message TEXT,
  accepted_at TEXT NOT NULL,
  UNIQUE(provider, provider_reference)
);

CREATE TABLE IF NOT EXISTS enterprise_installations (
  installation_id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  fqdn TEXT NOT NULL,
  data_region TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  release_digest TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enterprise_identity_links (
  organisation_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL,
  active INTEGER NOT NULL,
  membership_version INTEGER NOT NULL,
  grants_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(organisation_id, issuer, subject)
);

CREATE TABLE IF NOT EXISTS enterprise_identity_events (
  event_id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  result_membership_version INTEGER,
  processed_at TEXT NOT NULL,
  UNIQUE(organisation_id, issuer, subject, event_id)
);

CREATE TABLE IF NOT EXISTS recovery_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES enterprise_installations(installation_id),
  release_digest TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  database_backup_ref TEXT NOT NULL,
  file_backup_ref TEXT NOT NULL,
  encrypted INTEGER NOT NULL,
  evidence_json TEXT,
  evidence_release_digest TEXT,
  evidence_schema_version TEXT,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  validated_at TEXT
);

CREATE TABLE IF NOT EXISTS release_verifications_v2 (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES enterprise_installations(installation_id),
  release_id TEXT NOT NULL,
  release_digest TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  signature_verified INTEGER NOT NULL,
  compatible_from_schema_version TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  UNIQUE(installation_id, release_id, release_digest)
);

CREATE TABLE IF NOT EXISTS forecast_runs_v2 (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  project_id TEXT,
  portfolio_id TEXT,
  model_type TEXT NOT NULL,
  model_version TEXT NOT NULL,
  as_of TEXT NOT NULL,
  input_versions_json TEXT NOT NULL,
  assumptions_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  historical_coverage_state TEXT NOT NULL,
  backtest_ref TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_policies_v2 (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  project_id TEXT,
  posture TEXT NOT NULL,
  historical_coverage_complete INTEGER NOT NULL DEFAULT 0,
  observed_roi INTEGER NOT NULL DEFAULT 0,
  business_approval_id TEXT,
  approved_commitment_classes_json TEXT NOT NULL,
  kill_switch INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inbox_project_state ON integration_inbox_v2(project_id, state, observed_at);
CREATE INDEX IF NOT EXISTS idx_effect_project_state ON effect_intents_v2(project_id, state, created_at);
CREATE INDEX IF NOT EXISTS idx_external_links_local ON external_object_links_v2(project_id, local_entity_type, local_entity_id);
CREATE INDEX IF NOT EXISTS idx_identity_events_subject ON enterprise_identity_events(organisation_id, issuer, subject, occurred_at);
CREATE INDEX IF NOT EXISTS idx_recovery_installation_state ON recovery_checkpoints(installation_id, state, created_at);
CREATE INDEX IF NOT EXISTS idx_release_verification_installation ON release_verifications_v2(installation_id, verified_at);
CREATE INDEX IF NOT EXISTS idx_forecast_project_asof ON forecast_runs_v2(project_id, as_of);

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
  append_seq BIGSERIAL,
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

CREATE TABLE IF NOT EXISTS attention_items (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  root_cause_key TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open','waiting','resolved','dismissed')),
  consequence TEXT NOT NULL CHECK (consequence IN ('critical','high','medium','low')),
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low','unknown')),
  situation TEXT NOT NULL,
  impact TEXT NOT NULL,
  owner_id TEXT,
  decision_owner_id TEXT,
  due_at TEXT,
  next_action TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(project_id, root_cause_key)
);

CREATE TABLE IF NOT EXISTS attention_sources (
  attention_item_id TEXT NOT NULL REFERENCES attention_items(id) ON DELETE CASCADE,
  source_ref TEXT NOT NULL,
  source_signal_id TEXT NOT NULL,
  PRIMARY KEY(attention_item_id, source_ref, source_signal_id)
);

CREATE TABLE IF NOT EXISTS ai_assessments (
  assessment_id TEXT PRIMARY KEY,
  attention_item_id TEXT NOT NULL REFERENCES attention_items(id) ON DELETE CASCADE,
  generated_at TEXT NOT NULL,
  model_label TEXT NOT NULL,
  summary TEXT NOT NULL,
  recommended_option_id TEXT,
  confidence TEXT NOT NULL,
  abstained INTEGER NOT NULL CHECK (abstained IN (0,1)),
  assessment_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS autonomous_cycles (
  cycle_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  observed_signals INTEGER NOT NULL,
  material_signals INTEGER NOT NULL,
  attention_created INTEGER NOT NULL,
  attention_updated INTEGER NOT NULL,
  auto_resolved INTEGER NOT NULL,
  ai_assessments INTEGER NOT NULL,
  suppressed_no_material_change INTEGER NOT NULL CHECK (suppressed_no_material_change IN (0,1)),
  completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS governed_projections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('pm','program','sponsor')),
  generated_at TEXT NOT NULL,
  projection_hash TEXT NOT NULL,
  projection_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_effort_samples (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  period TEXT NOT NULL,
  sample_type TEXT NOT NULL CHECK (sample_type IN ('baseline','current')),
  status_collection_minutes REAL NOT NULL DEFAULT 0,
  reconciliation_minutes REAL NOT NULL DEFAULT 0,
  chasing_minutes REAL NOT NULL DEFAULT 0,
  reporting_minutes REAL NOT NULL DEFAULT 0,
  duplicate_governance_minutes REAL NOT NULL DEFAULT 0,
  decision_preparation_minutes REAL NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL,
  UNIQUE(project_id, period, sample_type)
);

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
  ON ec_responsibility_assignments(user_id, role, scope_type, scope_id, COALESCE(team_id,''))
  WHERE active = 1;

CREATE INDEX IF NOT EXISTS idx_ec_responsibility_user_active
  ON ec_responsibility_assignments(user_id, active, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_ec_project_context_program ON ec_project_context(program_id, project_id);
CREATE INDEX IF NOT EXISTS idx_ec_project_context_portfolio ON ec_project_context(portfolio_id, project_id);
CREATE INDEX IF NOT EXISTS idx_ec_org_units_parent ON ec_org_units(organisation_id, parent_unit_id);

CREATE TABLE IF NOT EXISTS ec_context_events (
  id TEXT PRIMARY KEY,
  append_seq BIGSERIAL,
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


-- Phase 5 extends the existing integration inbox for durable provider-runtime processing.
-- No new business-truth or event-truth table is introduced.
ALTER TABLE integration_inbox_v2 ADD COLUMN IF NOT EXISTS payload_json TEXT;
ALTER TABLE integration_inbox_v2 ADD COLUMN IF NOT EXISTS normalised_event_json TEXT;
ALTER TABLE integration_inbox_v2 ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE integration_inbox_v2 ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE integration_inbox_v2 ADD COLUMN IF NOT EXISTS next_attempt_at TEXT;
ALTER TABLE integration_inbox_v2 ADD COLUMN IF NOT EXISTS processed_at TEXT;
ALTER TABLE integration_inbox_v2 ADD COLUMN IF NOT EXISTS signature_key_id TEXT;

CREATE INDEX IF NOT EXISTS idx_inbox_runtime_ready
  ON integration_inbox_v2(state, next_attempt_at, created_at);


-- Phase 6 production-readiness metadata extends the existing integration binding.
-- No new project, event, role, report, resource or finance truth store is introduced.
ALTER TABLE integration_bindings_v2 ADD COLUMN IF NOT EXISTS secret_reference TEXT;
ALTER TABLE integration_bindings_v2 ADD COLUMN IF NOT EXISTS reconciliation_cursor TEXT;
ALTER TABLE integration_bindings_v2 ADD COLUMN IF NOT EXISTS last_reconciled_at TEXT;
ALTER TABLE integration_bindings_v2 ADD COLUMN IF NOT EXISTS last_reconciliation_status TEXT;

CREATE INDEX IF NOT EXISTS idx_binding_reconciliation
  ON integration_bindings_v2(enabled, last_reconciled_at);


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


-- PostgreSQL append-only protection matching the verified SQLite controls.
CREATE OR REPLACE FUNCTION goliath_reject_mutation_on_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_ec_context_events_no_update ON ec_context_events;
CREATE TRIGGER trg_ec_context_events_no_update
BEFORE UPDATE ON ec_context_events
FOR EACH ROW EXECUTE FUNCTION goliath_reject_mutation_on_append_only();

DROP TRIGGER IF EXISTS trg_ec_context_events_no_delete ON ec_context_events;
CREATE TRIGGER trg_ec_context_events_no_delete
BEFORE DELETE ON ec_context_events
FOR EACH ROW EXECUTE FUNCTION goliath_reject_mutation_on_append_only();

DROP TRIGGER IF EXISTS trg_pc_project_events_no_update ON pc_project_events;
CREATE TRIGGER trg_pc_project_events_no_update
BEFORE UPDATE ON pc_project_events
FOR EACH ROW EXECUTE FUNCTION goliath_reject_mutation_on_append_only();

DROP TRIGGER IF EXISTS trg_pc_project_events_no_delete ON pc_project_events;
CREATE TRIGGER trg_pc_project_events_no_delete
BEFORE DELETE ON pc_project_events
FOR EACH ROW EXECUTE FUNCTION goliath_reject_mutation_on_append_only();

COMMIT;
