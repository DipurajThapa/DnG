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
