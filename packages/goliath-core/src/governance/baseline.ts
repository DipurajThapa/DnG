/**
 * Phase 1 baseline architecture guard.
 *
 * This module deliberately does not introduce new business entities or persistence.
 * It defines the architectural invariants that the next enterprise phases must preserve:
 * one canonical project reality, source-specific intake/reconciliation, derived projections,
 * and role/context-specific views over the same canonical records.
 */

export type PersistencePurpose =
  | 'canonical-project-control'
  | 'canonical-enterprise-context'
  | 'canonical-resource-capacity'
  | 'canonical-finance'
  | 'integration-runtime'
  | 'enterprise-runtime'
  | 'attention-and-ai-control'
  | 'derived-projection'
  | 'measurement';

export interface TableClassification {
  table: string;
  purpose: PersistencePurpose;
  authoritativeForBusinessState: boolean;
}

export interface BaselineFinding {
  code: string;
  severity: 'blocker' | 'planned-gap' | 'information';
  message: string;
}

export interface BaselineAssessment {
  tableCount: number;
  duplicateTables: readonly string[];
  forbiddenParallelTruthTables: readonly string[];
  unclassifiedTables: readonly string[];
  findings: readonly BaselineFinding[];
  passesCentralTruthInvariant: boolean;
}

/**
 * Existing persistence inventory. These are the only tables in the Phase 1 baseline.
 * A role-specific dashboard/report must never become authoritative business state.
 */
export const BASELINE_TABLES: readonly TableClassification[] = [
  // B14–B16 integration / enterprise runtime
  { table: 'integration_bindings_v2', purpose: 'integration-runtime', authoritativeForBusinessState: false },
  { table: 'external_object_links_v2', purpose: 'integration-runtime', authoritativeForBusinessState: false },
  { table: 'integration_inbox_v2', purpose: 'integration-runtime', authoritativeForBusinessState: false },
  { table: 'effect_intents_v2', purpose: 'integration-runtime', authoritativeForBusinessState: false },
  { table: 'provider_receipts_v2', purpose: 'integration-runtime', authoritativeForBusinessState: false },
  { table: 'enterprise_installations', purpose: 'enterprise-runtime', authoritativeForBusinessState: false },
  { table: 'enterprise_identity_links', purpose: 'enterprise-runtime', authoritativeForBusinessState: false },
  { table: 'enterprise_identity_events', purpose: 'enterprise-runtime', authoritativeForBusinessState: false },
  { table: 'recovery_checkpoints', purpose: 'enterprise-runtime', authoritativeForBusinessState: false },
  { table: 'release_verifications_v2', purpose: 'enterprise-runtime', authoritativeForBusinessState: false },
  { table: 'forecast_runs_v2', purpose: 'enterprise-runtime', authoritativeForBusinessState: false },
  { table: 'automation_policies_v2', purpose: 'enterprise-runtime', authoritativeForBusinessState: false },

  // AI-first control / evidence-to-decision loop
  { table: 'attention_items', purpose: 'attention-and-ai-control', authoritativeForBusinessState: true },
  { table: 'attention_sources', purpose: 'attention-and-ai-control', authoritativeForBusinessState: false },
  { table: 'ai_assessments', purpose: 'attention-and-ai-control', authoritativeForBusinessState: false },
  { table: 'autonomous_cycles', purpose: 'attention-and-ai-control', authoritativeForBusinessState: false },
  { table: 'governed_projections', purpose: 'derived-projection', authoritativeForBusinessState: false },
  { table: 'admin_effort_samples', purpose: 'measurement', authoritativeForBusinessState: false },

  // Central project-control business state
  { table: 'pc_projects', purpose: 'canonical-project-control', authoritativeForBusinessState: true },
  { table: 'pc_project_members', purpose: 'canonical-project-control', authoritativeForBusinessState: true },
  { table: 'pc_activities', purpose: 'canonical-project-control', authoritativeForBusinessState: true },
  { table: 'pc_dependencies', purpose: 'canonical-project-control', authoritativeForBusinessState: true },
  { table: 'pc_assignments', purpose: 'canonical-project-control', authoritativeForBusinessState: true },
  { table: 'pc_decisions', purpose: 'canonical-project-control', authoritativeForBusinessState: true },
  { table: 'pc_handoffs', purpose: 'canonical-project-control', authoritativeForBusinessState: true },
  { table: 'pc_sources', purpose: 'canonical-project-control', authoritativeForBusinessState: true },
  { table: 'pc_work_actions', purpose: 'canonical-project-control', authoritativeForBusinessState: true },
  { table: 'pc_project_events', purpose: 'canonical-project-control', authoritativeForBusinessState: false },
  { table: 'pc_report_snapshots', purpose: 'derived-projection', authoritativeForBusinessState: false },
];


/** Phase 2 enterprise hierarchy/context additions. They extend the central model; they are not parallel project truth. */
export const PHASE2_TABLES: readonly TableClassification[] = [
  { table: 'ec_organisations', purpose: 'canonical-enterprise-context', authoritativeForBusinessState: true },
  { table: 'ec_portfolios', purpose: 'canonical-enterprise-context', authoritativeForBusinessState: true },
  { table: 'ec_programs', purpose: 'canonical-enterprise-context', authoritativeForBusinessState: true },
  { table: 'ec_org_units', purpose: 'canonical-enterprise-context', authoritativeForBusinessState: true },
  { table: 'ec_project_context', purpose: 'canonical-enterprise-context', authoritativeForBusinessState: true },
  { table: 'ec_responsibility_assignments', purpose: 'canonical-enterprise-context', authoritativeForBusinessState: true },
  { table: 'ec_context_events', purpose: 'canonical-enterprise-context', authoritativeForBusinessState: false },
];

/** Phase 3 central resource/capacity and finance additions. */
export const PHASE3_TABLES: readonly TableClassification[] = [
  { table: 'rc_resources', purpose: 'canonical-resource-capacity', authoritativeForBusinessState: true },
  { table: 'rc_capacity_periods', purpose: 'canonical-resource-capacity', authoritativeForBusinessState: true },
  { table: 'rc_allocations', purpose: 'canonical-resource-capacity', authoritativeForBusinessState: true },
  { table: 'rc_demands', purpose: 'canonical-resource-capacity', authoritativeForBusinessState: true },
  { table: 'fin_entries', purpose: 'canonical-finance', authoritativeForBusinessState: true },
  { table: 'fin_forecast_inputs', purpose: 'canonical-finance', authoritativeForBusinessState: true },
];

export const CURRENT_TABLES: readonly TableClassification[] = [...BASELINE_TABLES, ...PHASE2_TABLES, ...PHASE3_TABLES];

/** Phase 7 adds actual effort as a canonical resource fact. */
export const PHASE7_TABLES: readonly TableClassification[] = [
  { table: 'rc_worklogs', purpose: 'canonical-resource-capacity', authoritativeForBusinessState: true },
];
export const LATEST_TABLES: readonly TableClassification[] = [...CURRENT_TABLES, ...PHASE7_TABLES];

/**
 * Names matching these patterns indicate a role/report-specific copy of project truth.
 * Such tables are forbidden because they would eventually diverge from canonical state.
 */
const FORBIDDEN_PARALLEL_TRUTH_PATTERNS: readonly RegExp[] = [
  /^(sponsor|executive|portfolio_manager|program_manager|project_manager|resource_manager|team_lead|team_member)_project_(status|state|truth)$/i,
  /^(weekly|steerco|executive|sponsor|portfolio|program)_report_(status|state|truth)$/i,
  /^(sponsor|portfolio|program|project|resource|team)_dashboard_(status|state|truth)$/i,
];

export const PHASE1_PLANNED_GAPS: readonly BaselineFinding[] = [
  {
    code: 'CTX-001',
    severity: 'planned-gap',
    message: 'Multi-role contextual responsibility assignments are not yet modeled; current membership carries one role per project.',
  },
  {
    code: 'HIER-001',
    severity: 'planned-gap',
    message: 'Portfolio, Program and functional-organisation hierarchies are not yet canonical entities.',
  },
  {
    code: 'ROLE-001',
    severity: 'planned-gap',
    message: 'Portfolio Manager, Resource Manager, optional Project Director and optional Agile Delivery Lead are not yet explicit roles.',
  },
  {
    code: 'RES-001',
    severity: 'planned-gap',
    message: 'Activity assignment exists, but enterprise resource capacity, functional ownership and future allocation are not yet normalized in the central model.',
  },
  {
    code: 'FIN-001',
    severity: 'planned-gap',
    message: 'Project budget/EAC exist, but detailed canonical financial records and field-level financial visibility are a later phase.',
  },
  {
    code: 'UX-001',
    severity: 'planned-gap',
    message: 'Role views are already different, but navigation and projection configuration are still code-defined rather than metadata-driven.',
  },
];

export const PHASE2_CLOSED_GAPS: readonly string[] = ['CTX-001', 'HIER-001', 'ROLE-001'];
export const PHASE2_REMAINING_GAPS: readonly BaselineFinding[] = PHASE1_PLANNED_GAPS.filter(
  (finding) => !PHASE2_CLOSED_GAPS.includes(finding.code),
);

export const PHASE3_CLOSED_GAPS: readonly string[] = [...PHASE2_CLOSED_GAPS, 'RES-001', 'FIN-001', 'UX-001'];
export const PHASE3_REMAINING_GAPS: readonly BaselineFinding[] = PHASE1_PLANNED_GAPS.filter(
  (finding) => !PHASE3_CLOSED_GAPS.includes(finding.code),
);

export function classifyTable(tableName: string): TableClassification | undefined {
  return LATEST_TABLES.find((entry) => entry.table === tableName);
}

export function isForbiddenParallelTruthTable(tableName: string): boolean {
  return FORBIDDEN_PARALLEL_TRUTH_PATTERNS.some((pattern) => pattern.test(tableName));
}

export function assessBaseline(tableNames: readonly string[]): BaselineAssessment {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const table of tableNames) {
    if (seen.has(table)) duplicates.add(table);
    seen.add(table);
  }

  const forbidden = tableNames.filter(isForbiddenParallelTruthTable);
  const unclassified = tableNames.filter((table) => !classifyTable(table));

  const findings: BaselineFinding[] = [
    {
      code: 'DB-001',
      severity: duplicates.size > 0 ? 'blocker' : 'information',
      message: duplicates.size > 0
        ? `Duplicate table declarations found: ${[...duplicates].sort().join(', ')}`
        : 'No duplicate table declarations found in the baseline migration inventory.',
    },
    {
      code: 'DB-002',
      severity: forbidden.length > 0 ? 'blocker' : 'information',
      message: forbidden.length > 0
        ? `Parallel role/report truth stores are forbidden: ${forbidden.sort().join(', ')}`
        : 'No role-specific, dashboard-specific or report-specific project truth stores were found.',
    },
    {
      code: 'DB-003',
      severity: unclassified.length > 0 ? 'blocker' : 'information',
      message: unclassified.length > 0
        ? `Unclassified persistence tables require architecture review: ${unclassified.sort().join(', ')}`
        : 'Every baseline table has an explicit persistence purpose.',
    },
    ...PHASE1_PLANNED_GAPS,
  ];

  return {
    tableCount: tableNames.length,
    duplicateTables: [...duplicates].sort(),
    forbiddenParallelTruthTables: [...new Set(forbidden)].sort(),
    unclassifiedTables: [...new Set(unclassified)].sort(),
    findings,
    passesCentralTruthInvariant: duplicates.size === 0 && forbidden.length === 0 && unclassified.length === 0,
  };
}

export function assessCurrentArchitecture(tableNames: readonly string[]): BaselineAssessment {
  const assessed = assessBaseline(tableNames);
  return {
    ...assessed,
    findings: [
      ...assessed.findings.filter((finding) => finding.code.startsWith('DB-')),
      ...PHASE3_REMAINING_GAPS,
    ],
  };
}

export function authoritativeCanonicalTables(): readonly string[] {
  return LATEST_TABLES
    .filter((entry) => entry.authoritativeForBusinessState)
    .map((entry) => entry.table);
}

export function derivedProjectionTables(): readonly string[] {
  return LATEST_TABLES
    .filter((entry) => entry.purpose === 'derived-projection')
    .map((entry) => entry.table);
}
