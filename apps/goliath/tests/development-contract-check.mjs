import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('apps/goliath/app.js');
const gov=read('apps/goliath/governance-ui.js');
const index=read('apps/goliath/index.html');
const vercel=read('apps/goliath/vercel.json');
const ci=read('.github/workflows/goliath-development-ci.yml');

function assert(condition,message){if(!condition)throw new Error(message);}
function contains(text,values,label){for(const v of values)assert(text.includes(v),`${label}: missing ${v}`);}

contains(index,['Project Control & Decision Intelligence','/app.js','/governance-ui.js'],'index');
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

contains(vercel,['deploymentEnabled','develop/goliath'],'deployment isolation');
contains(ci,['node --check apps/goliath/governance-ui.js','governance_authorization_hardening'],'CI governance checks');

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
  '20260912_governance_authorization_hardening.sql'
];
for(const f of migrationFiles)assert(fs.existsSync(path.join(root,'apps/goliath/migrations',f)),`missing migration ${f}`);

console.log('Goliath development contract checks: PASS');
