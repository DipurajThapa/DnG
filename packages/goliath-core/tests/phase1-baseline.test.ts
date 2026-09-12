import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessBaseline,
  authoritativeCanonicalTables,
  BASELINE_TABLES,
  derivedProjectionTables,
  PHASE1_PLANNED_GAPS,
} from '../src/index.js';

const migrationInventory = [
  'integration_bindings_v2', 'external_object_links_v2', 'integration_inbox_v2', 'effect_intents_v2', 'provider_receipts_v2',
  'enterprise_installations', 'enterprise_identity_links', 'enterprise_identity_events', 'recovery_checkpoints', 'release_verifications_v2',
  'forecast_runs_v2', 'automation_policies_v2',
  'attention_items', 'attention_sources', 'ai_assessments', 'autonomous_cycles', 'governed_projections', 'admin_effort_samples',
  'pc_projects', 'pc_project_members', 'pc_activities', 'pc_dependencies', 'pc_assignments', 'pc_decisions', 'pc_handoffs', 'pc_sources',
  'pc_work_actions', 'pc_project_events', 'pc_report_snapshots',
] as const;

test('Phase 1 baseline preserves one central project reality and classifies every persistence table', () => {
  const result = assessBaseline(migrationInventory);
  assert.equal(result.tableCount, 29);
  assert.equal(result.passesCentralTruthInvariant, true);
  assert.deepEqual(result.duplicateTables, []);
  assert.deepEqual(result.forbiddenParallelTruthTables, []);
  assert.deepEqual(result.unclassifiedTables, []);
  assert.equal(BASELINE_TABLES.length, 29);
});

test('role/report projections are explicitly non-authoritative', () => {
  assert.deepEqual([...derivedProjectionTables()].sort(), ['governed_projections', 'pc_report_snapshots'].sort());
  for (const tableName of derivedProjectionTables()) {
    const table = BASELINE_TABLES.find((entry) => entry.table === tableName)!;
    assert.equal(table.authoritativeForBusinessState, false);
  }
});

test('canonical project-control records remain the authoritative shared business state', () => {
  const authoritative = authoritativeCanonicalTables();
  for (const required of ['pc_projects', 'pc_activities', 'pc_assignments', 'pc_dependencies', 'pc_decisions', 'pc_handoffs', 'pc_sources', 'pc_work_actions']) {
    assert.ok(authoritative.includes(required), `${required} must remain canonical business state`);
  }
});

test('enterprise expansion gaps are explicit rather than hidden behind dashboard labels', () => {
  const codes = PHASE1_PLANNED_GAPS.map((finding) => finding.code);
  assert.deepEqual(codes.sort(), ['CTX-001', 'FIN-001', 'HIER-001', 'RES-001', 'ROLE-001', 'UX-001'].sort());
  assert.ok(PHASE1_PLANNED_GAPS.every((finding) => finding.severity === 'planned-gap'));
});

test('architecture guard rejects role-specific and report-specific truth tables', () => {
  const result = assessBaseline([
    ...migrationInventory,
    'project_manager_project_status',
    'weekly_report_truth',
    'sponsor_dashboard_state',
  ]);
  assert.equal(result.passesCentralTruthInvariant, false);
  assert.deepEqual([...result.forbiddenParallelTruthTables].sort(), [
    'project_manager_project_status',
    'sponsor_dashboard_state',
    'weekly_report_truth',
  ].sort());
});

test('architecture guard blocks unclassified persistence instead of silently accepting schema drift', () => {
  const result = assessBaseline([...migrationInventory, 'mystery_project_copy']);
  assert.equal(result.passesCentralTruthInvariant, false);
  assert.deepEqual(result.unclassifiedTables, ['mystery_project_copy']);
});
