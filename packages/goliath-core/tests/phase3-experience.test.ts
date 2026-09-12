import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_TABLES, PHASE3_CLOSED_GAPS, PHASE3_REMAINING_GAPS, ROLE_EXPERIENCE_PROFILES, assessCurrentArchitecture } from '../src/index.js';
import { phase3Fixture } from './phase3-fixture.js';

function seededExperience() {
  const env=phase3Fixture();
  const rm={userId:'rm1',actingAssignmentId:'RM'};
  env.resourceService.createResource(rm,{id:'R1',userId:'dev1',displayName:'Developer',organisationId:'ORG1',orgUnitId:'ENG',active:true,skills:['TypeScript'],weeklyContractHours:40});
  env.resourceService.setCapacity(rm,{id:'CAP1',resourceId:'R1',periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,unavailableHours:0,sourceRef:'WFM:R1'});
  env.resourceService.allocate(rm,{id:'ALA',resourceId:'R1',projectId:'A',activityId:'A-D1',teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:24,status:'confirmed'});
  env.resourceService.allocate(rm,{id:'ALB',resourceId:'R1',projectId:'B',activityId:'B-D1',teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:8,status:'confirmed'});
  env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'actual',amount:20000,currency:'USD',sourceSystem:'ERP',sourceRef:'A-ACT',sourceRevision:'1',occurredAt:'2026-09-09T00:00:00.000Z',classification:'confidential'});
  env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'revenue',amount:120000,currency:'USD',sourceSystem:'ERP',sourceRef:'A-REV',sourceRevision:'1',occurredAt:'2026-09-09T00:00:00.000Z',classification:'restricted'});
  env.financeService.setForecast({userId:'director1',actingAssignmentId:'DIR'},{projectId:'A',etcAmount:65000,contingencyAmount:5000,projectedRevenue:120000,currency:'USD',asOf:'2026-09-10T08:00:00.000Z',sourceRefs:['forecast:A']});
  return env;
}

test('Phase 3 extends the same central schema and closes resource, finance and role-experience gaps without parallel truth stores',()=>{
  assert.equal(CURRENT_TABLES.length,42);
  const assessed=assessCurrentArchitecture(CURRENT_TABLES.map((t)=>t.table));
  assert.equal(assessed.passesCentralTruthInvariant,true);
  assert.deepEqual(assessed.unclassifiedTables,[]);
  assert.deepEqual(assessed.forbiddenParallelTruthTables,[]);
  assert.deepEqual(PHASE3_REMAINING_GAPS,[]);
  assert.deepEqual([...PHASE3_CLOSED_GAPS].sort(),['CTX-001','HIER-001','ROLE-001','RES-001','FIN-001','UX-001'].sort());
});

test('role experience metadata is genuinely different by accountability and does not create separate dashboard storage',()=>{
  assert.equal(ROLE_EXPERIENCE_PROFILES['project-manager'].defaultLanding,'Attention');
  assert.equal(ROLE_EXPERIENCE_PROFILES['resource-manager'].defaultLanding,'Capacity');
  assert.equal(ROLE_EXPERIENCE_PROFILES.sponsor.defaultLanding,'Decisions');
  assert.equal(ROLE_EXPERIENCE_PROFILES['portfolio-manager'].defaultLanding,'Portfolio');
  assert.notDeepEqual(ROLE_EXPERIENCE_PROFILES['project-manager'].globalNavigation,ROLE_EXPERIENCE_PROFILES['resource-manager'].globalNavigation);
  assert.notDeepEqual(ROLE_EXPERIENCE_PROFILES['program-manager'].globalNavigation,ROLE_EXPERIENCE_PROFILES['team-member'].globalNavigation);
  assert.equal(CURRENT_TABLES.some((x)=>/dashboard|workspace|role_view/i.test(x.table)),false);
});

test('same user switching PM to Sponsor context receives materially different data and capabilities',()=>{
  const env=seededExperience();
  const pm=env.experienceService.build({userId:'alex',actingAssignmentId:'PM-A'},{projectId:'A'});
  const sponsor=env.experienceService.build({userId:'alex',actingAssignmentId:'SP-A-ALEX'},{projectId:'A'});
  assert.equal(pm.profile.defaultLanding,'Attention');
  assert.equal(pm.selectedProject?.activities.length,3);
  assert.equal(pm.capabilities.canAssignProjectWork,true);
  assert.equal(pm.selectedProject?.finance?.visibility,'project');
  assert.equal(sponsor.profile.defaultLanding,'Decisions');
  assert.equal(sponsor.capabilities.canAssignProjectWork,false);
  assert.equal(sponsor.capabilities.canApproveDecisions,true);
  assert.equal(sponsor.selectedProject?.finance?.visibility,'summary');
  assert.ok((sponsor.selectedProject?.activities.length??0)<3);
});

test('program and portfolio managers start with cross-project control views and drill down only when requested',()=>{
  const env=seededExperience();
  const program=env.experienceService.build({userId:'program1',actingAssignmentId:'PROGRAM'});
  const portfolio=env.experienceService.build({userId:'portfolio1',actingAssignmentId:'PORT'});
  assert.equal(program.projects.length,2);
  assert.equal(program.selectedProject,undefined);
  assert.equal(portfolio.projects.length,2);
  assert.equal(portfolio.selectedProject,undefined);
  const drill=env.experienceService.build({userId:'program1',actingAssignmentId:'PROGRAM'},{projectId:'A'});
  assert.equal(drill.selectedProject?.fullActivityCount,3);
  assert.equal(drill.selectedProject?.activities.length,3);
});

test('resource manager receives functional capacity rather than a project dashboard or project finance',()=>{
  const env=seededExperience();
  const view=env.experienceService.build({userId:'rm1',actingAssignmentId:'RM'},{periodStart:'2026-09-10',periodEnd:'2026-09-16'});
  assert.equal(view.profile.defaultDetail,'functional-capacity');
  assert.equal(view.availableProjectIds.length,0);
  assert.equal(view.selectedProject,undefined);
  assert.equal(view.functionalCapacity?.resources.length,1);
  assert.equal(view.capabilities.canAllocateResources,true);
  assert.equal(view.capabilities.canViewProjectFinance,false);
});

test('delivery, agile and team-member views remain scoped to team or owned work',()=>{
  const env=seededExperience();
  const lead=env.experienceService.build({userId:'devlead',actingAssignmentId:'LEAD'},{projectId:'A'});
  const agile=env.experienceService.build({userId:'agile',actingAssignmentId:'AGILE'},{projectId:'A'});
  const member=env.experienceService.build({userId:'dev1',actingAssignmentId:'MEMBER'},{projectId:'A'});
  assert.equal(lead.selectedProject?.activities.length,2);
  assert.equal(lead.capabilities.canAssignTeamWork,true);
  assert.equal(lead.selectedProject?.finance,undefined);
  assert.equal(agile.profile.defaultLanding,'Flow');
  assert.equal(agile.capabilities.canAssignTeamWork,false);
  assert.equal(member.profile.defaultLanding,'My Work');
  assert.ok(member.selectedProject?.activities.every((a)=>a.ownerId==='dev1'));
  assert.equal(member.selectedProject?.finance,undefined);
});

test('PMO sees project/control traceability but does not inherit finance simply because it governs the project',()=>{
  const env=seededExperience();
  const pmo=env.experienceService.build({userId:'pmo1',actingAssignmentId:'PMO'},{projectId:'A'});
  assert.equal(pmo.profile.defaultLanding,'Controls');
  assert.equal(pmo.selectedProject?.fullActivityCount,3);
  assert.ok(pmo.selectedProject?.traceability);
  assert.equal(pmo.selectedProject?.finance,undefined);
  assert.equal(pmo.capabilities.canManageGovernance,true);
});

test('enterprise admin remains administration-only and cannot see project content by default',()=>{
  const env=seededExperience();
  const admin=env.experienceService.build({userId:'admin1',actingAssignmentId:'ADMIN'});
  assert.equal(admin.profile.defaultLanding,'Administration');
  assert.equal(admin.projects.length,0);
  assert.equal(admin.selectedProject,undefined);
  assert.ok(admin.administration);
});

test('role projection does not generate denial audit noise for fields that the role is not permitted to see',()=>{
  const env=seededExperience();
  const before=env.contextRepo.listEvents().filter((e)=>e.result==='denied').length;
  env.experienceService.build({userId:'pmo1',actingAssignmentId:'PMO'},{projectId:'A'});
  const after=env.contextRepo.listEvents().filter((e)=>e.result==='denied').length;
  assert.equal(after,before);
});
