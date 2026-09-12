-- GOLIATH PostgreSQL runtime persistence hardening.
-- Adds durable append order to audit/event tables so PostgreSQL preserves the
-- same chain semantics as SQLite rowid without using event occurrence time.
BEGIN;

ALTER TABLE pc_project_events ADD COLUMN IF NOT EXISTS append_seq BIGSERIAL;
ALTER TABLE ec_context_events ADD COLUMN IF NOT EXISTS append_seq BIGSERIAL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pc_project_events_append_seq
  ON pc_project_events(append_seq);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ec_context_events_append_seq
  ON ec_context_events(append_seq);

COMMIT;
