-- Phase 6 production-readiness metadata extends the existing integration binding.
-- No new project, event, role, report, resource or finance truth store is introduced.
ALTER TABLE integration_bindings_v2 ADD COLUMN secret_reference TEXT;
ALTER TABLE integration_bindings_v2 ADD COLUMN reconciliation_cursor TEXT;
ALTER TABLE integration_bindings_v2 ADD COLUMN last_reconciled_at TEXT;
ALTER TABLE integration_bindings_v2 ADD COLUMN last_reconciliation_status TEXT;

CREATE INDEX IF NOT EXISTS idx_binding_reconciliation
  ON integration_bindings_v2(enabled, last_reconciled_at);
