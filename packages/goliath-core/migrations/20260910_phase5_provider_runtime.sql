-- Phase 5 extends the existing integration inbox for durable provider-runtime processing.
-- No new business-truth or event-truth table is introduced.
ALTER TABLE integration_inbox_v2 ADD COLUMN payload_json TEXT;
ALTER TABLE integration_inbox_v2 ADD COLUMN normalised_event_json TEXT;
ALTER TABLE integration_inbox_v2 ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE integration_inbox_v2 ADD COLUMN last_error TEXT;
ALTER TABLE integration_inbox_v2 ADD COLUMN next_attempt_at TEXT;
ALTER TABLE integration_inbox_v2 ADD COLUMN processed_at TEXT;
ALTER TABLE integration_inbox_v2 ADD COLUMN signature_key_id TEXT;

CREATE INDEX IF NOT EXISTS idx_inbox_runtime_ready
  ON integration_inbox_v2(state, next_attempt_at, created_at);
