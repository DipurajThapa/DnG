import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTraceabilitySnapshot, type ProjectMember } from '../src/index.js';
import { phase3Fixture } from './phase3-fixture.js';

test('Phase 3 new project uses one canonical state across PM, Sponsor, Program, Portfolio, Resource and Team contexts',()=>{
  const env=phase3Fixture();
  const projectId='C';
  const members:ProjectMember[]=[
    {projectId,userId:'alex',displayName:'Alex PM',role:'project-manager',teamId:'pmo',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'bob',displayName:'Bob Sponsor',role:'sponsor',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'devlead',displayName:'Dev Lead',role:'delivery-lead',teamId:'dev',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'qalead',displayName:'QA Lead',role:'delivery-lead',teamId:'qa',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'dev1',displayName:'Developer',role:'team-member',teamId:'dev',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'qa1',displayName:'QA Analyst',role:'team-member',teamId:'qa',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
  ];
  env.projectService.createProject({id:projectId,organisationId:'ORG1',code:'C',name:'New Customer Portal',pmId:'alex',sponsorId:'bob',timezone:'UTC',baselineFinish:'2026-10-31',budget:150000,currency:'USD'},members,'system');
  env.contextService.bindProject({projectId,organisationId:'ORG1',portfolioId:'PF1',programId:'PG1',boundBy:'admin'},'admin');
  env.contextService.grantResponsibility({id:'PM-C',userId:'alex',displayName:'Alex PM',role:'project-manager',scopeType:'project',scopeId:projectId,permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');
  env.contextService.grantResponsibility({id:'SP-C',userId:'bob',displayName:'Bob Sponsor',role:'sponsor',scopeType:'project',scopeId:projectId,permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');
  env.contextService.grantResponsibility({id:'LEAD-C',userId:'devlead',displayName:'Dev Lead',role:'delivery-lead',scopeType:'project',scopeId:projectId,teamId:'dev',permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');
  env.contextService.grantResponsibility({id:'MEMBER-C',userId:'dev1',displayName:'Developer',role:'team-member',scopeType:'project',scopeId:projectId,teamId:'dev',permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');

  const pm={userId:'alex',actingAssignmentId:'PM-C'};
  const sponsor={userId:'bob',actingAssignmentId:'SP-C'};
  const program={userId:'program1',actingAssignmentId:'PROGRAM'};
  const portfolio={userId:'portfolio1',actingAssignmentId:'PORT'};
  const rm={userId:'rm1',actingAssignmentId:'RM'};
  const lead={userId:'devlead',actingAssignmentId:'LEAD-C'};
  const member={userId:'dev1',actingAssignmentId:'MEMBER-C'};
  const pmo={userId:'pmo1',actingAssignmentId:'PMO'};
  const director={userId:'director1',actingAssignmentId:'DIR'};

  env.projectApp.importPlan(pm,projectId,[
    {id:'C-D1',projectId,phase:'Build',title:'Build onboarding workflow',status:'not-started',plannedTeamId:'dev',priority:'high',milestone:false,baselineFinish:'2026-09-24',forecastFinish:'2026-09-24',sourceSystem:'Jira',sourceRef:'JIRA:C-D1',evidenceRefs:['JIRA:C-D1']},
    {id:'C-D2',projectId,phase:'Build',title:'Integration milestone',status:'not-started',plannedTeamId:'dev',priority:'high',milestone:true,baselineFinish:'2026-09-28',forecastFinish:'2026-09-28',sourceSystem:'Jira',sourceRef:'JIRA:C-D2',evidenceRefs:['JIRA:C-D2']},
    {id:'C-Q1',projectId,phase:'Test',title:'System acceptance test',status:'not-started',plannedTeamId:'qa',priority:'critical',milestone:true,baselineFinish:'2026-10-05',forecastFinish:'2026-10-05',sourceSystem:'QA',sourceRef:'QA:C-Q1',evidenceRefs:['QA:C-Q1']},
  ],[
    {id:'C-DEP1',projectId,predecessorActivityId:'C-D1',successorActivityId:'C-D2',gateType:'finish-to-start',mandatory:true},
    {id:'C-DEP2',projectId,predecessorActivityId:'C-D2',successorActivityId:'C-Q1',gateType:'finish-to-start',mandatory:true},
  ]);
  env.projectApp.assignActivity(pm,projectId,'C-D1','dev1');
  env.projectApp.assignActivity(pm,projectId,'C-D2','dev1');
  env.projectApp.assignActivity(pm,projectId,'C-Q1','qa1');
  env.projectApp.configureProject(pm,projectId,{baselineVersion:'BASE-C-1',baselineAccepted:true,materialOutcomesConfirmed:true});
  env.projectApp.registerSource(pm,projectId,{id:'SRC-C',projectId,sourceType:'delivery',sourceRef:'JIRA:C',authority:'execution',status:'current',lastObservedAt:'2026-09-10T08:00:00.000Z',freshnessHours:24,classification:'internal',revision:1});
  env.projectService.refreshDerivedProjectState(projectId);
  assert.equal(env.projectService.evaluateReadiness(projectId).ready,true);
  env.projectApp.transitionProject(pm,projectId,'ready');
  env.projectApp.transitionProject(pm,projectId,'active');

  env.resourceService.createResource(rm,{id:'R-C',userId:'dev1',displayName:'Developer',organisationId:'ORG1',orgUnitId:'ENG',active:true,skills:['TypeScript'],weeklyContractHours:40});
  env.resourceService.setCapacity(rm,{id:'CAP-C',resourceId:'R-C',periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,unavailableHours:4,sourceRef:'WFM:R-C'});
  env.resourceService.requestDemand(pm,{id:'DEM-C',projectId,teamId:'dev',orgUnitId:'ENG',skill:'TypeScript',periodStart:'2026-09-10',periodEnd:'2026-09-16',requiredHours:24});
  env.resourceService.allocate(rm,{id:'ALLOC-C',resourceId:'R-C',projectId,activityId:'C-D1',teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:24,status:'confirmed'});

  env.financeService.ingestAuthoritativeEntry({projectId,entryType:'actual',amount:25000,currency:'USD',sourceSystem:'ERP',sourceRef:'ERP:C:ACT',sourceRevision:'1',occurredAt:'2026-09-09T00:00:00.000Z',classification:'confidential'});
  env.financeService.ingestAuthoritativeEntry({projectId,entryType:'commitment',amount:15000,currency:'USD',sourceSystem:'ERP',sourceRef:'ERP:C:COM',sourceRevision:'1',occurredAt:'2026-09-09T00:00:00.000Z',classification:'confidential'});
  env.financeService.setForecast(pm,{projectId,etcAmount:90000,contingencyAmount:10000,currency:'USD',asOf:'2026-09-10T08:00:00.000Z',sourceRefs:['FORECAST:C']});
  env.financeService.setForecast(director,{projectId,etcAmount:90000,contingencyAmount:10000,projectedRevenue:200000,benefitForecast:50000,currency:'USD',asOf:'2026-09-10T08:00:00.000Z',sourceRefs:['FORECAST:C','COMMERCIAL:C']});

  const pmView=env.experienceService.build(pm,{projectId,periodStart:'2026-09-10',periodEnd:'2026-09-16'});
  const sponsorView=env.experienceService.build(sponsor,{projectId});
  const programView=env.experienceService.build(program);
  const portfolioView=env.experienceService.build(portfolio);
  const rmView=env.experienceService.build(rm,{periodStart:'2026-09-10',periodEnd:'2026-09-16'});
  const leadView=env.experienceService.build(lead,{projectId});
  const memberView=env.experienceService.build(member,{projectId});
  const pmoView=env.experienceService.build(pmo,{projectId});
  const directorView=env.experienceService.build(director,{projectId});

  assert.equal(pmView.selectedProject?.fullActivityCount,3);
  assert.equal(pmView.selectedProject?.activities.length,3);
  assert.equal(pmView.selectedProject?.finance?.visibility,'project');
  assert.equal(pmView.selectedProject?.capacity?.totalAllocatedHours,24);
  assert.equal(pmView.capabilities.canAssignProjectWork,true);

  assert.equal(sponsorView.selectedProject?.fullActivityCount,3);
  assert.ok((sponsorView.selectedProject?.activities.length ?? 0)<3,'sponsor starts with milestone/critical exception detail rather than full operational list');
  assert.equal(sponsorView.selectedProject?.finance?.visibility,'summary');
  assert.equal(sponsorView.capabilities.canAssignProjectWork,false);

  assert.ok(programView.projects.some((p)=>p.projectId===projectId));
  assert.equal(programView.selectedProject,undefined);
  assert.ok(portfolioView.projects.some((p)=>p.projectId===projectId));
  assert.equal(portfolioView.selectedProject,undefined);

  assert.equal(rmView.selectedProject,undefined);
  assert.equal(rmView.functionalCapacity?.totalAllocatedHours,24);
  assert.equal(rmView.capabilities.canAllocateResources,true);

  assert.equal(leadView.selectedProject?.activities.length,2);
  assert.ok(leadView.selectedProject?.activities.every((a)=>(a.currentTeamId??a.plannedTeamId)==='dev'));
  assert.equal(memberView.selectedProject?.activities.length,2);
  assert.ok(memberView.selectedProject?.activities.every((a)=>a.ownerId==='dev1'));
  assert.equal(pmoView.selectedProject?.finance,undefined);
  assert.ok(pmoView.selectedProject?.traceability);
  assert.equal(directorView.selectedProject?.finance?.visibility,'commercial');
  assert.equal(directorView.selectedProject?.finance?.projectedRevenue,200000);
  assert.equal(directorView.selectedProject?.finance?.margin,75000);
  assert.equal(pmView.selectedProject?.finance?.projectedRevenue,undefined);

  const trace=calculateTraceabilitySnapshot(env.projectRepo,projectId);
  assert.equal(trace.ownershipCoverage.percent,100);
  assert.equal(trace.assignmentConsistency.percent,100);
  assert.equal(trace.dependencyIntegrity.percent,100);
  assert.equal(trace.sourceLineageCoverage.percent,100);
  assert.deepEqual(trace.orphanRecords,[]);
  assert.equal(trace.auditChainIntegrity,true);
  assert.equal(env.contextRepo.verifyEventChain(),true);
  assert.equal(env.projectRepo.getProject(projectId)?.eac,125000);
  assert.equal(env.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
