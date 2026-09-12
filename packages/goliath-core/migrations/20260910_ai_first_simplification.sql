PRAGMA foreign_keys = ON;

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
