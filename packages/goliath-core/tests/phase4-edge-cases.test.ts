import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeterministicFallbackAi,
  GoliathError,
  EnterpriseEventIntelligenceService,
  ProjectControlCoordinator,
  RepositoryEvidenceResolver,
  ResourceCapacitySignalProvider,
  type EnterpriseProjectEvent,
} from '../src/index.js';
import { phase3Fixture } from './phase3-fixture.js';

function sourceForA(env: ReturnType<typeof phase3Fixture>) {
  const existing=env.projectRepo.listSources('A').find((source)=>source.sourceRef==='JIRA-A-1');
  if (existing) return existing;
  env.projectService.registerSource('A','alex',{id:'SRC-A-EDGE',projectId:'A',sourceType:'delivery',sourceRef:'JIRA-A-1',authority:'execution schedule quality',status:'current',lastObservedAt:'2026-09-10T07:00:00.000Z',freshnessHours:24,classification:'internal',revision:1});
  return env.projectRepo.listSources('A').find((source)=>source.sourceRef==='JIRA-A-1')!;
}

function runtime(env: ReturnType<typeof phase3Fixture>) {
  const provider=new ResourceCapacitySignalProvider(env.resourceRepo,env.projectRepo);
  const coordinator=new ProjectControlCoordinator(env.projectRepo,new DeterministicFallbackAi(),new RepositoryEvidenceResolver(),env.now,[provider]);
  return new EnterpriseEventIntelligenceService(env.projectRepo,env.projectService,env.resourceService,env.financeService,coordinator,env.now);
}

function event(overrides: Partial<EnterpriseProjectEvent>={}): EnterpriseProjectEvent {
  return {kind:'activity.changed',projectId:'A',organisationId:'ORG1',entityId:'A-D1',sourceSystem:'Jira',sourceTenant:'jira-prod',sourceEventId:'edge-event',sourceRef:'JIRA-A-1',sourceRevision:'2',sourceEffectiveAt:'2026-09-10T07:20:00.000Z',observedAt:'2026-09-10T07:21:00.000Z',correlationId:'edge-event',payload:{forecastFinish:'2026-09-28'},...overrides} as EnterpriseProjectEvent;
}

test('Phase 4 rejects malformed event times before any accepted-event mutation', async()=>{
  for (const [field,value] of [['sourceEffectiveAt','not-a-date'],['observedAt','bad-time']] as const) {
    const env=phase3Fixture(); sourceForA(env); const events=runtime(env);
    await assert.rejects(()=>events.process(event({[field]:value,sourceEventId:`bad-${field}`} as Partial<EnterpriseProjectEvent>)),(error:any)=>error instanceof GoliathError&&error.code==='INVALID_INPUT');
    assert.equal(env.projectRepo.listEvents('A').some((row)=>row.eventType==='enterprise.event.accepted'&&row.correlationId==='edge-event'),false);
  }
});

test('Phase 4 requires complete provider identity before event acceptance', async()=>{
  const missingFields=['sourceSystem','sourceTenant','sourceEventId','sourceRef','sourceRevision'] as const;
  for (const field of missingFields) {
    const env=phase3Fixture(); sourceForA(env); const events=runtime(env);
    const input=event({sourceEventId:`identity-${field}`} as Partial<EnterpriseProjectEvent>) as any;
    input[field]='  ';
    await assert.rejects(()=>events.process(input),(error:any)=>error instanceof GoliathError&&error.code==='INVALID_INPUT');
  }
});

test('Phase 4 rejects an event for a missing project without creating canonical state', async()=>{
  const env=phase3Fixture(); const events=runtime(env);
  await assert.rejects(()=>events.process(event({projectId:'MISSING',entityId:'MISSING-D1',sourceEventId:'missing-project'} as Partial<EnterpriseProjectEvent>)),(error:any)=>error instanceof GoliathError&&error.code==='NOT_FOUND');
  assert.equal(env.projectRepo.getProject('MISSING'),undefined);
});

test('Phase 4 identical new source event content is processed without rewriting the canonical activity', async()=>{
  const env=phase3Fixture(); sourceForA(env); const events=runtime(env);
  const current=env.projectRepo.getActivity('A-D1')!;
  const result=await events.process(event({sourceEventId:'same-state',payload:{forecastFinish:current.forecastFinish}} as Partial<EnterpriseProjectEvent>));
  assert.equal(result.status,'applied');
  assert.equal(result.changed,false);
  assert.equal(env.projectRepo.getActivity('A-D1')?.revision,current.revision);
  assert.equal(env.projectRepo.verifyEventChain('A'),true);
});

test('Phase 4 source-health event cannot mutate an unmapped source', async()=>{
  const env=phase3Fixture(); sourceForA(env); const events=runtime(env);
  await assert.rejects(()=>events.process({kind:'source.health.changed',projectId:'A',organisationId:'ORG1',entityId:'NO-SOURCE',sourceSystem:'Jira',sourceTenant:'jira-prod',sourceEventId:'unknown-health',sourceRef:'JIRA:UNKNOWN',sourceRevision:'1',sourceEffectiveAt:'2026-09-10T07:20:00.000Z',observedAt:'2026-09-10T07:21:00.000Z',correlationId:'unknown-health',payload:{status:'unavailable',lastObservedAt:'2026-09-10T07:20:00.000Z'}}),(error:any)=>error instanceof GoliathError&&error.code==='NOT_FOUND');
  assert.ok(env.projectRepo.listEvents('A').some((row)=>row.eventType==='enterprise.event.processing-failed'&&row.correlationId==='unknown-health'));
});

test('Phase 4 rejected finance event leaves EAC and finance ledger unchanged while retaining retry evidence', async()=>{
  const env=phase3Fixture(); const pm={userId:'alex',actingAssignmentId:'PM-A'}; const events=runtime(env);
  env.financeService.setForecast(pm,{projectId:'A',etcAmount:50000,contingencyAmount:5000,currency:'USD',asOf:'2026-09-10T07:00:00.000Z',sourceRefs:['forecast:A']});
  const eacBefore=env.projectRepo.getProject('A')?.eac;
  await assert.rejects(()=>events.process({kind:'finance.entry.changed',projectId:'A',organisationId:'ORG1',entityId:'BAD-FIN',sourceSystem:'ERP',sourceTenant:'erp-prod',sourceEventId:'bad-finance',sourceRef:'ERP:A:BAD',sourceRevision:'1',sourceEffectiveAt:'2026-09-10T07:30:00.000Z',observedAt:'2026-09-10T07:31:00.000Z',correlationId:'bad-finance',payload:{entryType:'actual',amount:-1,currency:'USD',occurredAt:'2026-09-10T07:30:00.000Z',classification:'confidential'}}),(error:any)=>error instanceof GoliathError&&error.code==='INVALID_INPUT');
  assert.equal(env.financeRepo.listEntries('A').some((row)=>row.sourceRef==='ERP:A:BAD'),false);
  assert.equal(env.projectRepo.getProject('A')?.eac,eacBefore);
  assert.ok(env.projectRepo.listEvents('A').some((row)=>row.eventType==='enterprise.event.processing-failed'&&row.correlationId==='bad-finance'));
});

test('Phase 4 capacity source ownership is fail-closed and same-source replay is idempotent', async()=>{
  const env=phase3Fixture(); const rm={userId:'rm1',actingAssignmentId:'RM'}; const events=runtime(env);
  env.resourceService.createResource(rm,{id:'R-EDGE',userId:'edge',displayName:'Edge Resource',organisationId:'ORG1',orgUnitId:'ENG',active:true,skills:['TypeScript'],weeklyContractHours:40});
  const first={kind:'resource.capacity.changed' as const,projectId:'A',organisationId:'ORG1',entityId:'R-EDGE',sourceSystem:'WFM',sourceTenant:'wfm-prod',sourceEventId:'edge-cap-1',sourceRef:'WFM:R-EDGE',sourceRevision:'1',sourceEffectiveAt:'2026-09-10T07:00:00.000Z',observedAt:'2026-09-10T07:01:00.000Z',correlationId:'edge-cap-1',payload:{periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,unavailableHours:8}};
  await events.process(first);
  const revision=env.resourceService.getCapacityRecord('R-EDGE','2026-09-10','2026-09-16')!.revision;
  const same=await events.process({...first,sourceEventId:'edge-cap-2',sourceRevision:'2',sourceEffectiveAt:'2026-09-10T07:10:00.000Z',observedAt:'2026-09-10T07:11:00.000Z',correlationId:'edge-cap-2'});
  assert.equal(same.changed,false);
  assert.equal(env.resourceService.getCapacityRecord('R-EDGE','2026-09-10','2026-09-16')!.revision,revision);
  await assert.rejects(()=>events.process({...first,sourceSystem:'OtherWFM',sourceEventId:'edge-cap-3',sourceRef:'OTHER:R-EDGE',sourceRevision:'3',sourceEffectiveAt:'2026-09-10T07:20:00.000Z',observedAt:'2026-09-10T07:21:00.000Z',correlationId:'edge-cap-3',payload:{...first.payload,grossHours:35}}),(error:any)=>error instanceof GoliathError&&error.code==='FIELD_AUTHORITY_DENIED');
  assert.equal(env.resourceService.getCapacityRecord('R-EDGE','2026-09-10','2026-09-16')!.grossHours,40);
});

test('Phase 4 capacity exception counts only matching team, skill and overlapping confirmed allocation', async()=>{
  const env=phase3Fixture(); const rm={userId:'rm1',actingAssignmentId:'RM'}; const pm={userId:'alex',actingAssignmentId:'PM-A'};
  env.resourceService.createResource(rm,{id:'R-MATCH',userId:'match',displayName:'Matching Developer',organisationId:'ORG1',orgUnitId:'ENG',active:true,skills:['TypeScript'],weeklyContractHours:40});
  env.resourceService.createResource(rm,{id:'R-WRONG-SKILL',userId:'wrong',displayName:'Wrong Skill',organisationId:'ORG1',orgUnitId:'ENG',active:true,skills:['Java'],weeklyContractHours:40});
  env.resourceService.createResource(rm,{id:'R-WRONG-UNIT',userId:'wrong-unit',displayName:'Wrong Unit',organisationId:'ORG1',orgUnitId:'QA',active:true,skills:['TypeScript'],weeklyContractHours:40});
  env.resourceService.requestDemand(pm,{id:'DEM-EDGE',projectId:'A',teamId:'dev',orgUnitId:'ENG',skill:'TypeScript',periodStart:'2026-09-10',periodEnd:'2026-09-16',requiredHours:20});
  env.resourceService.ingestAuthoritativeCapacity({id:'CAP-MATCH',resourceId:'R-MATCH',periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,unavailableHours:0,sourceRef:'WFM:R-MATCH',revision:1});
  env.resourceService.ingestAuthoritativeCapacity({id:'CAP-WRONG',resourceId:'R-WRONG-SKILL',periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,unavailableHours:0,sourceRef:'WFM:R-WRONG',revision:1});
  env.resourceService.ingestAuthoritativeCapacity({id:'CAP-WRONG-UNIT',resourceId:'R-WRONG-UNIT',periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,unavailableHours:0,sourceRef:'WFM:R-WRONG-UNIT',revision:1});
  env.resourceService.ingestAuthoritativeAllocation({id:'ALLOC-WRONG-SKILL',resourceId:'R-WRONG-SKILL',projectId:'A',activityId:'A-D1',teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:20,status:'confirmed'});
  env.resourceService.ingestAuthoritativeAllocation({id:'ALLOC-WRONG-UNIT',resourceId:'R-WRONG-UNIT',projectId:'A',activityId:'A-D1',teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:20,status:'confirmed'});
  env.resourceService.ingestAuthoritativeAllocation({id:'ALLOC-WRONG-TEAM',resourceId:'R-MATCH',projectId:'A',activityId:'A-D1',teamId:'qa',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:20,status:'confirmed'});
  env.resourceService.ingestAuthoritativeAllocation({id:'ALLOC-NONOVERLAP',resourceId:'R-MATCH',projectId:'A',activityId:'A-D1',teamId:'dev',periodStart:'2026-09-20',periodEnd:'2026-09-25',hours:20,status:'confirmed'});
  env.resourceService.ingestAuthoritativeAllocation({id:'ALLOC-PARTIAL',resourceId:'R-MATCH',projectId:'A',activityId:'A-D1',teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-12',hours:9,status:'confirmed'});
  const provider=new ResourceCapacitySignalProvider(env.resourceRepo,env.projectRepo);
  const signal=provider.getSignals('A',env.now()).find((row)=>row.rootCauseKey==='resource-demand:DEM-EDGE');
  assert.ok(signal);
  // The wrong skill contributes zero. The matching allocation contributes 9 hours because its whole 3-day allocation overlaps the demand window.
  assert.equal(signal?.metadata?.allocatedHours,9);
  assert.equal(signal?.metadata?.shortfallHours,11);
  assert.equal(signal?.confidence,'high');
  assert.deepEqual(signal?.sourceRefs,['WFM:R-MATCH']);
});
