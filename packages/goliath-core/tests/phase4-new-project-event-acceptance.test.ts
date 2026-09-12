import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeterministicFallbackAi,
  EnterpriseEventIntelligenceService,
  ProjectControlCoordinator,
  RepositoryEvidenceResolver,
  ResourceCapacitySignalProvider,
  calculateTraceabilitySnapshot,
  type ProjectMember,
} from '../src/index.js';
import { phase3Fixture } from './phase3-fixture.js';

test('Phase 4 fresh project is controlled from enterprise events through role-aware attention, decision follow-through, recovery and traceability', async()=>{
  const env=phase3Fixture();
  const projectId='D';
  const members:ProjectMember[]=[
    {projectId,userId:'d-pm',displayName:'Dana PM',role:'project-manager',teamId:'pmo',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'d-sponsor',displayName:'Sam Sponsor',role:'sponsor',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'d-devlead',displayName:'Development Lead',role:'delivery-lead',teamId:'dev',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'d-qalead',displayName:'QA Lead',role:'delivery-lead',teamId:'qa',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'d-dev',displayName:'Developer',role:'team-member',teamId:'dev',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'d-qa',displayName:'QA Analyst',role:'team-member',teamId:'qa',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
  ];

  // Bootstrap remains the one intentional pre-context exception: create the shell, bind it, then all project operations use acting context.
  env.projectService.createProject({id:projectId,organisationId:'ORG1',code:'D',name:'Event Driven Customer Portal',pmId:'d-pm',sponsorId:'d-sponsor',timezone:'UTC',baselineFinish:'2026-10-31',budget:80000,currency:'USD'},members,'system');
  env.contextService.bindProject({projectId,organisationId:'ORG1',portfolioId:'PF1',programId:'PG1',boundBy:'admin'},'admin');
  env.contextService.grantResponsibility({id:'PM-D',userId:'d-pm',displayName:'Dana PM',role:'project-manager',scopeType:'project',scopeId:projectId,permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');
  env.contextService.grantResponsibility({id:'SP-D',userId:'d-sponsor',displayName:'Sam Sponsor',role:'sponsor',scopeType:'project',scopeId:projectId,permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');
  env.contextService.grantResponsibility({id:'LEAD-D',userId:'d-devlead',displayName:'Development Lead',role:'delivery-lead',scopeType:'project',scopeId:projectId,teamId:'dev',permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');
  env.contextService.grantResponsibility({id:'QALEAD-D',userId:'d-qalead',displayName:'QA Lead',role:'delivery-lead',scopeType:'project',scopeId:projectId,teamId:'qa',permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');
  env.contextService.grantResponsibility({id:'MEMBER-D',userId:'d-dev',displayName:'Developer',role:'team-member',scopeType:'project',scopeId:projectId,teamId:'dev',permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');
  env.contextService.grantResponsibility({id:'QAMEMBER-D',userId:'d-qa',displayName:'QA Analyst',role:'team-member',scopeType:'project',scopeId:projectId,teamId:'qa',permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');

  const pm={userId:'d-pm',actingAssignmentId:'PM-D'};
  const sponsor={userId:'d-sponsor',actingAssignmentId:'SP-D'};
  const rm={userId:'rm1',actingAssignmentId:'RM'};
  const program={userId:'program1',actingAssignmentId:'PROGRAM'};
  const portfolio={userId:'portfolio1',actingAssignmentId:'PORT'};
  const devLead={userId:'d-devlead',actingAssignmentId:'LEAD-D'};
  const member={userId:'d-dev',actingAssignmentId:'MEMBER-D'};
  const pmo={userId:'pmo1',actingAssignmentId:'PMO'};

  env.projectApp.importPlan(pm,projectId,[
    {id:'D-D1',projectId,phase:'Build',title:'Build portal capability',status:'not-started',plannedTeamId:'dev',priority:'high',milestone:false,baselineStart:'2026-09-10',baselineFinish:'2026-09-20',forecastFinish:'2026-09-20',sourceSystem:'Jira',sourceRef:'JIRA:D-D1',evidenceRefs:['JIRA:D-D1']},
    {id:'D-Q1',projectId,phase:'Test',title:'Release acceptance test',status:'not-started',plannedTeamId:'qa',priority:'critical',milestone:true,baselineStart:'2026-09-21',baselineFinish:'2026-10-04',forecastFinish:'2026-10-04',sourceSystem:'QA',sourceRef:'QA:D-Q1',evidenceRefs:['QA:D-Q1']},
  ],[
    {id:'D-DEP1',projectId,predecessorActivityId:'D-D1',successorActivityId:'D-Q1',gateType:'finish-to-start',mandatory:true},
  ]);
  env.projectApp.assignActivity(pm,projectId,'D-D1','d-dev');
  env.projectApp.assignActivity(pm,projectId,'D-Q1','d-qa');
  env.projectApp.configureProject(pm,projectId,{baselineVersion:'BASE-D-1',baselineAccepted:true,materialOutcomesConfirmed:true});
  env.projectApp.registerSource(pm,projectId,{id:'SRC-D-JIRA',projectId,sourceType:'delivery',sourceRef:'JIRA:D-D1',authority:'execution schedule',status:'current',lastObservedAt:'2026-09-10T08:00:00.000Z',freshnessHours:24,classification:'internal',revision:1});
  env.projectApp.registerSource(pm,projectId,{id:'SRC-D-QA',projectId,sourceType:'quality',sourceRef:'QA:D-Q1',authority:'quality acceptance schedule',status:'current',lastObservedAt:'2026-09-10T08:00:00.000Z',freshnessHours:24,classification:'internal',revision:1});
  env.projectService.refreshDerivedProjectState(projectId);
  assert.equal(env.projectService.evaluateReadiness(projectId).ready,true);
  env.projectApp.transitionProject(pm,projectId,'ready');
  env.projectApp.transitionProject(pm,projectId,'active');

  env.resourceService.createResource(rm,{id:'R-D',userId:'d-dev',displayName:'Developer',organisationId:'ORG1',orgUnitId:'ENG',active:true,skills:['TypeScript'],weeklyContractHours:40});
  env.resourceService.requestDemand(pm,{id:'DEM-D',projectId,teamId:'dev',orgUnitId:'ENG',skill:'TypeScript',periodStart:'2026-09-10',periodEnd:'2026-09-16',requiredHours:24});
  env.financeService.setForecast(pm,{projectId,etcAmount:70000,contingencyAmount:5000,currency:'USD',asOf:'2026-09-10T08:00:00.000Z',sourceRefs:['FORECAST:D']});

  const provider=new ResourceCapacitySignalProvider(env.resourceRepo,env.projectRepo);
  const coordinator=new ProjectControlCoordinator(env.projectRepo,new DeterministicFallbackAi(),new RepositoryEvidenceResolver(),env.now,[provider]);
  const events=new EnterpriseEventIntelligenceService(env.projectRepo,env.projectService,env.resourceService,env.financeService,coordinator,env.now);

  // Workforce fact initially exposes a material capacity gap; the PM did not re-enter workforce data.
  await events.process({kind:'resource.capacity.changed',projectId,organisationId:'ORG1',entityId:'R-D',sourceSystem:'WFM',sourceTenant:'wfm-prod',sourceEventId:'d-cap-1',sourceRef:'WFM:R-D:CAP',sourceRevision:'1',sourceEffectiveAt:'2026-09-10T08:05:00.000Z',observedAt:'2026-09-10T08:06:00.000Z',correlationId:'d-cap-1',payload:{periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,unavailableHours:4}});
  const capacityAttention=env.projectRepo.listAttention(projectId).find((item)=>item.rootCauseKey==='resource-demand:DEM-D');
  assert.equal(capacityAttention?.state,'open');

  // Authoritative allocation resolves the same exception instead of creating another manual issue/register.
  await events.process({kind:'resource.allocation.changed',projectId,organisationId:'ORG1',entityId:'ALLOC-D',sourceSystem:'WFM',sourceTenant:'wfm-prod',sourceEventId:'d-alloc-1',sourceRef:'WFM:ALLOC-D',sourceRevision:'1',sourceEffectiveAt:'2026-09-10T08:10:00.000Z',observedAt:'2026-09-10T08:11:00.000Z',correlationId:'d-alloc-1',payload:{resourceId:'R-D',activityId:'D-D1',teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:24,status:'confirmed'}});
  assert.equal(env.projectRepo.getAttention(capacityAttention!.id)?.state,'resolved');

  // Delivery status arrives from Jira and closes predecessor work without duplicate PM status entry.
  await events.process({kind:'activity.changed',projectId,organisationId:'ORG1',entityId:'D-D1',sourceSystem:'Jira',sourceTenant:'jira-prod',sourceEventId:'d-jira-done',sourceRef:'JIRA:D-D1',sourceRevision:'2',sourceEffectiveAt:'2026-09-10T08:20:00.000Z',observedAt:'2026-09-10T08:21:00.000Z',correlationId:'d-jira-done',payload:{status:'done',actualFinish:'2026-09-10',percentComplete:100,evidenceRefs:['JIRA:D-D1:done']}});
  assert.equal(env.projectRepo.getActivity('D-D1')?.status,'done');

  // QA event creates a critical forecast exception; GOLIATH prepares a Sponsor decision from the same canonical evidence.
  await events.process({kind:'activity.changed',projectId,organisationId:'ORG1',entityId:'D-Q1',sourceSystem:'QA',sourceTenant:'qa-prod',sourceEventId:'d-qa-slip',sourceRef:'QA:D-Q1',sourceRevision:'2',sourceEffectiveAt:'2026-09-10T08:30:00.000Z',observedAt:'2026-09-10T08:31:00.000Z',correlationId:'d-qa-slip',payload:{status:'in-progress',actualStart:'2026-09-10',forecastFinish:'2026-10-12',percentComplete:20,evidenceRefs:['QA:D-Q1:run-1']}});
  const deliveryAttention=env.projectRepo.listAttention(projectId).find((item)=>item.rootCauseKey==='activity:D-Q1:delivery');
  assert.equal(deliveryAttention?.state,'open');
  assert.equal(deliveryAttention?.consequence,'critical');
  assert.equal(deliveryAttention?.decisionOwnerId,'d-sponsor');
  assert.equal(deliveryAttention?.nextAction,'decide');
  const pendingDecision=env.projectRepo.getDecisionByAttention(projectId,deliveryAttention!.id);
  assert.equal(pendingDecision?.state,'pending');
  assert.equal(pendingDecision?.decisionOwnerId,'d-sponsor');

  // Role projections differ, while all are derived from the same project/Attention records.
  const pmView=env.experienceService.build(pm,{projectId});
  const sponsorView=env.experienceService.build(sponsor,{projectId});
  const programView=env.experienceService.build(program);
  const portfolioView=env.experienceService.build(portfolio);
  const leadView=env.experienceService.build(devLead,{projectId});
  const memberView=env.experienceService.build(member,{projectId});
  const pmoView=env.experienceService.build(pmo,{projectId});
  assert.ok(pmView.attention.some((item)=>item.attentionId===deliveryAttention!.id));
  assert.ok(sponsorView.attention.some((item)=>item.attentionId===deliveryAttention!.id));
  assert.ok(programView.attention.some((item)=>item.projectId===projectId));
  assert.ok(portfolioView.attention.some((item)=>item.projectId===projectId));
  assert.ok(leadView.attention.every((item)=>item.projectId===projectId));
  assert.ok(memberView.selectedProject?.activities.every((activity)=>activity.ownerId==='d-dev'));
  assert.ok(pmoView.selectedProject?.traceability);

  // Sponsor decides once; system creates one traceable corrective action without PM re-entry.
  env.projectApp.decide(sponsor,projectId,pendingDecision!.id,'Protect launch: add recovery test cycle','approved','Critical acceptance slip requires recovery before launch.');
  const actionsAfterDecision=env.projectRepo.listWorkActions(projectId).filter((action)=>action.attentionItemId===deliveryAttention!.id);
  assert.equal(actionsAfterDecision.length,1);
  assert.equal(actionsAfterDecision[0]?.state,'open');

  // ERP actual arrives and reuses canonical finance; no report-specific finance state is created.
  await events.process({kind:'finance.entry.changed',projectId,organisationId:'ORG1',entityId:'ERP-D-ACT-1',sourceSystem:'ERP',sourceTenant:'erp-prod',sourceEventId:'d-fin-1',sourceRef:'ERP:D:ACT:1',sourceRevision:'1',sourceEffectiveAt:'2026-09-10T08:40:00.000Z',observedAt:'2026-09-10T08:41:00.000Z',correlationId:'d-fin-1',payload:{entryType:'actual',amount:12000,currency:'USD',occurredAt:'2026-09-10T08:40:00.000Z',classification:'confidential'}});
  assert.equal(env.financeRepo.listEntries(projectId).filter((entry)=>entry.sourceRef==='ERP:D:ACT:1').length,1);

  // Corrected QA evidence resolves the delivery exception and the linked corrective action closes automatically.
  await events.process({kind:'activity.changed',projectId,organisationId:'ORG1',entityId:'D-Q1',sourceSystem:'QA',sourceTenant:'qa-prod',sourceEventId:'d-qa-recovered',sourceRef:'QA:D-Q1',sourceRevision:'3',sourceEffectiveAt:'2026-09-10T08:50:00.000Z',observedAt:'2026-09-10T08:51:00.000Z',correlationId:'d-qa-recovered',payload:{status:'done',actualFinish:'2026-09-10',forecastFinish:'2026-10-04',percentComplete:100,blocker:null,evidenceRefs:['QA:D-Q1:accepted']}});
  assert.equal(env.projectRepo.getAttention(deliveryAttention!.id)?.state,'resolved');
  assert.equal(env.projectRepo.listWorkActions(projectId).find((action)=>action.id===actionsAfterDecision[0]!.id)?.state,'done');

  const trace=calculateTraceabilitySnapshot(env.projectRepo,projectId);
  assert.equal(trace.ownershipCoverage.percent,100);
  assert.equal(trace.assignmentConsistency.percent,100);
  assert.equal(trace.dependencyIntegrity.percent,100);
  assert.equal(trace.sourceLineageCoverage.percent,100);
  assert.deepEqual(trace.orphanRecords,[]);
  assert.equal(trace.auditChainIntegrity,true);
  assert.equal(env.contextRepo.verifyEventChain(),true);
  assert.equal(env.db.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.ok(env.projectRepo.listProjections(projectId).length>0);
  assert.ok(env.projectRepo.listEvents(projectId).some((event)=>event.eventType==='enterprise.event.processed'));
});
