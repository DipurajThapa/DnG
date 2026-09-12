import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('apps/goliath/app.js');
const gov=read('apps/goliath/governance-ui.js');
const pmo=read('apps/goliath/pmo-controls-ui.js');
const roles=read('apps/goliath/role-model-ui.js');
const diagnostics=read('apps/goliath/diagnostics-ui.js');
const invitations=read('apps/goliath/invitation-ui.js');
const index=read('apps/goliath/index.html');
const vercel=read('apps/goliath/vercel.json');
const ci=read('.github/workflows/goliath-development-ci.yml');
const baselineImmutability=read('apps/goliath/migrations/20260912_baseline_immutability_hardening.sql');
const legacyLockdown=read('apps/goliath/migrations/20260912_legacy_public_rpc_lockdown.sql');
const roleCatalog=read('apps/goliath/migrations/20260912_role_catalog_admin_coverage.sql');
const reconciliation=read('apps/goliath/migrations/20260912_reconciliation_evidence_diagnostics.sql');
const acceptanceReadiness=read('apps/goliath/migrations/20260912_acceptance_readiness.sql');
const invitationFlow=read('apps/goliath/migrations/20260912_invitation_flow_v2.sql');
const multiUserAcceptance=read('apps/goliath/migrations/20260912_multi_user_acceptance_probe.sql');
const governanceAccess=read('apps/goliath/migrations/20260912_governance_membership_team_access.sql');
const devRoleSeed=read('apps/goliath/dev-seeds/20260912_goliath_dev_role_coverage.sql');

function assert(condition,message){if(!condition)throw new Error(message);}
function contains(text,values,label){for(const v of values)assert(text.includes(v),`${label}: missing ${v}`);}

contains(index,['Project Control & Decision Intelligence','/app.js','/governance-ui.js','/pmo-controls-ui.js','/role-model-ui.js','/diagnostics-ui.js','/invitation-ui.js'],'index');
assert(!index.includes('Project Management Tracker'),'legacy tracker branding must not return');
assert(!app.includes('Project Management Tracker'),'legacy tracker branding must not return in app');

contains(app,[
  "reports:'Reports'",
  'home.notifications',
  'project_capacity_projection',
  'planned_cost_projection',
  'snapshot_project_report',
  'No separate status dataset',
  'No actual cost, margin or EAC'
],'core UI');

contains(gov,[
  "new Set(['requirements','raid','change'])",
  'project_control_extensions',
  'create_requirement',
  'baseline_requirement',
  'link_requirement',
  'accept_requirement',
  'create_raid_item',
  'evaluate_raid_triggers',
  'convert_raid_trigger_to_issue',
  'submit_initial_baseline',
  'finalize_initial_baseline',
  'create_change_request',
  'prepare_change_request',
  'finalize_change_request',
  'Human-confirmed links count',
  'Risk scoring is human-entered',
  'Approved baselines are immutable snapshots'
],'governance UI');

contains(pmo,[
  'integration_health',
  'outcome_metrics',
  'record_admin_effort_sample',
  'Only evidence-supported measures are calculated',
  'Do not estimate a lower number',
  'M1_adminEffort',
  'M4_decisionLatency',
  'M8_evidenceCoverage',
  'M9_dataFreshness',
  'M12_notificationNoise'
],'PMO controls');

contains(roles,[
  'My responsibilities',
  'admin_role_coverage',
  'acceptance_readiness',
  'Configuration is not treated as proof',
  'Only responsibilities assigned to your verified identity appear here',
  'Do not grant your own login every role merely to preview screens',
  'goliathInviteRoleHolder'
],'role model UI');

contains(diagnostics,[
  'integration_reconciliation_queue',
  'evidence_gap_diagnostics',
  'does not silently discard ambiguous records',
  'Register exception',
  'Evidence coverage diagnostics'
],'diagnostics UI');

contains(invitations,[
  'Step 1 of 2',
  'Step 2 of 2',
  'Send invitation by email',
  'Copy invitation token',
  'same invitation',
  'does not close on blur',
  'admin_create_identity_invitation',
  'admin_record_identity_invitation_share'
],'invitation UI');

contains(app,[
  'Run access check',
  'run_role_acceptance_probe',
  'Access checks passed and persisted.',
  'Claim the invitation issued for your governed role and scope.'
],'multi-user acceptance UI');

contains(app,[
  'People & Access',
  'Assign or reassign person',
  'Share team with projects',
  'admin_assign_person',
  'admin_assign_team',
  'access_management_state',
  'Organisation and project administration never grant delivery access'
],'membership/team access UI');

contains(governanceAccess,[
  'platform_identity.organisation_memberships',
  'public.ec_teams',
  'public.ec_team_memberships',
  'public.pc_project_memberships',
  'public.pc_project_team_assignments',
  'public.ec_responsibility_sources',
  "'project-admin'",
  'access_admin_context',
  'admin_add_organisation_member',
  'admin_create_team',
  'admin_assign_person',
  'admin_assign_team',
  'access_management_state',
  'scope_organisation',
  'Project Admin may manage only the assigned project',
  'Organisation Admin or Project Admin authority is required'
],'membership/team access backend');

contains(roles,[
  'multi_user_acceptance_readiness',
  'Real-user role acceptance',
  'Next acceptance action',
  'goliathReloadRoleCoverage'
],'multi-user acceptance readiness UI');

contains(multiUserAcceptance,[
  'run_role_acceptance_probe',
  'identity.acceptance.probed',
  'identity-bound',
  'required-surface',
  'scope-isolation',
  'admin-boundary',
  'cockpit-boundary',
  'audit-persistence',
  'multi_user_acceptance_readiness',
  'sponsor-probe',
  'team-probe',
  'sponsor-workflow-input',
  'team-owned-work',
  'readyForRoleBoundaryAcceptance',
  'readyForGovernedWorkflow',
  'do not seed a passing result',
  'access is intentionally not widened'
],'multi-user acceptance backend');

contains(vercel,[
  'governance-ui\\\\.js',
  'pmo-controls-ui\\\\.js',
  'role-model-ui\\\\.js',
  'diagnostics-ui\\\\.js',
  'invitation-ui\\\\.js',
  'runtime-config\\\\.js',
  'mutation-observer-guard\\\\.js'
],'deployable asset routing');

contains(roleCatalog,[
  'platform_identity.role_catalog',
  'Enterprise Admin',
  'Portfolio Manager',
  'Program Manager',
  'Project Director',
  'Project Manager',
  'PMO / Project Controls',
  'Resource Manager',
  'Delivery Lead',
  'Agile Delivery Lead',
  'Team Member',
  'Sponsor',
  'admin_role_coverage',
  'not an acting-as control'
],'role catalog');

contains(reconciliation,[
  'integration_reconciliation_issues_v2',
  'integration_reconciliation_queue',
  'create_reconciliation_issue',
  'respond_reconciliation_issue',
  'evidence_gap_diagnostics'
],'reconciliation/evidence diagnostics');

contains(acceptanceReadiness,[
  'acceptance_readiness',
  'named-user-auth',
  'role-coverage',
  'second-identity',
  'separate-approver',
  'control-established',
  'evidence-specification',
  'initial-baseline',
  'critical-reconciliation',
  "'releaseReady',false"
],'acceptance readiness');

contains(invitationFlow,[
  'admin_invitation_targets',
  'admin_create_identity_invitation',
  'v_reused',
  'admin_record_identity_invitation_share',
  'copy-token',
  'email-client'
],'invitation backend');

contains(devRoleSeed,[
  'DEVELOPMENT-ONLY',
  'GDEV-DL-AISHA',
  'GDEV-AGILE',
  'GDEV-TM-KHALID'
],'development role seed');

contains(baselineImmutability,[
  'trg_pc_baselines_no_update',
  'trg_pc_baselines_no_delete',
  'edapos_reject_mutation_on_append_only'
],'baseline immutability');

contains(legacyLockdown,[
  'goliath_api.list_contexts()',
  'goliath_api.workspace(text)',
  'goliath_api.append_context_event',
  'goliath_api.append_project_event',
  'goliath_api.require_context(text)',
  'goliath_api.context_allows_project(text,text)'
],'legacy public RPC lockdown');

contains(vercel,['deploymentEnabled','develop/goliath'],'deployment isolation');
contains(ci,['node --check apps/goliath/governance-ui.js','node --check apps/goliath/pmo-controls-ui.js','node --check apps/goliath/role-model-ui.js','node --check apps/goliath/diagnostics-ui.js','node --check apps/goliath/invitation-ui.js','governance_authorization_hardening','baseline_immutability_hardening','integration_health_outcome_metrics','legacy_public_rpc_lockdown','role_catalog_admin_coverage','reconciliation_evidence_diagnostics','acceptance_readiness','20260912_invitation_flow_v2.sql'],'CI governance checks');

const migrationFiles=[
  '20260912_commitment_evidence_foundation.sql',
  '20260912_data_ownership_classification.sql',
  '20260912_decision_dependency_semantics.sql',
  '20260912_mvp_health_foundation.sql',
  '20260912_reporting_projection_foundation.sql',
  '20260912_notification_escalation_foundation.sql',
  '20260912_capacity_planned_cost_foundation.sql',
  '20260912_raid_control_foundation.sql',
  '20260912_baseline_change_control_foundation.sql',
  '20260912_requirements_traceability_foundation.sql',
  '20260912_initial_baseline_approval.sql',
  '20260912_governance_authorization_hardening.sql',
  '20260912_baseline_immutability_hardening.sql',
  '20260912_integration_health_outcome_metrics.sql',
  '20260912_legacy_public_rpc_lockdown.sql',
  '20260912_role_catalog_admin_coverage.sql',
  '20260912_reconciliation_evidence_diagnostics.sql',
  '20260912_acceptance_readiness.sql',
  '20260912_invitation_flow_v2.sql',
  '20260912_multi_user_acceptance_probe.sql',
  '20260912_governance_membership_team_access.sql'
];
for(const f of migrationFiles)assert(fs.existsSync(path.join(root,'apps/goliath/migrations',f)),`missing migration ${f}`);
assert(fs.existsSync(path.join(root,'apps/goliath/dev-seeds/20260912_goliath_dev_role_coverage.sql')),'missing development role-coverage seed');

console.log('Goliath development contract checks: PASS');
