import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeterministicFallbackAi,
  GoliathError,
  EnterpriseEventIntelligenceService,
  ProjectControlCoordinator,
  RepositoryEvidenceResolver,
  ResourceCapacitySignalProvider,
  type AiAssessment,
  type AiReasoningProvider,
  type AiReasoningRequest,
  type EnterpriseProjectEvent,
} from '../src/index.js';
import { phase3Fixture } from './phase3-fixture.js';

function sourceForA(env: ReturnType<typeof phase3Fixture>, status: 'current'|'stale'|'unavailable' = 'current') {
  const existing=env.projectRepo.listSources('A').find((source)=>source.sourceRef==='JIRA-A-1');
  if (existing) return existing;
  env.projectService.registerSource('A','alex',{id:'SRC-A',projectId:'A',sourceType:'delivery',sourceRef:'JIRA-A-1',authority:'execution schedule quality',status,
    lastObservedAt:'2026-09-10T07:00:00.000Z',freshnessHours:24,classification:'internal',revision:1});
  return env.projectRepo.listSources('A').find((source)=>source.sourceRef==='JIRA-A-1')!;
}

class CountingAi implements AiReasoningProvider {
  readonly label='counting-ai';
  calls=0;
  private readonly fallback=new DeterministicFallbackAi();
  async assess(request: AiReasoningRequest): Promise<AiAssessment> { this.calls += 1; return this.fallback.assess(request); }
}
class ThrowingAi implements AiReasoningProvider {
  readonly label='throwing-ai';
  async assess(_request: AiReasoningRequest): Promise<AiAssessment> { throw new Error('AI offline'); }
}

function runtime(env: ReturnType<typeof phase3Fixture>, ai: AiReasoningProvider = new DeterministicFallbackAi(), runnerOverride?: {run(projectId:string):Promise<any>}) {
  const provider=new ResourceCapacitySignalProvider(env.resourceRepo,env.projectRepo);
  const coordinator=new ProjectControlCoordinator(env.projectRepo,ai,new RepositoryEvidenceResolver(),env.now,[provider]);
  const events=new EnterpriseEventIntelligenceService(env.projectRepo,env.projectService,env.resourceService,env.financeService,runnerOverride??coordinator,env.now);
  return {provider,coordinator,events};
}

function activityEvent(overrides: Partial<EnterpriseProjectEvent> = {}): EnterpriseProjectEvent {
  return {
    kind:'activity.changed',projectId:'A',organisationId:'ORG1',entityId:'A-D1',sourceSystem:'Jira',sourceTenant:'tenant-1',sourceEventId:'evt-1',sourceRef:'JIRA-A-1',sourceRevision:'2',
    sourceEffectiveAt:'2026-09-10T07:20:00.000Z',observedAt:'2026-09-10T07:21:00.000Z',correlationId:'corr-1',payload:{forecastFinish:'2026-09-28'},...overrides,
  } as EnterpriseProjectEvent;
}

test('Phase 4 enterprise event applies once, creates role-aware Attention and preserves audit chain with backdated source time', async()=>{
  const env=phase3Fixture(); sourceForA(env);
  const {events}=runtime(env);
  const result=await events.process(activityEvent());
  assert.equal(result.status,'applied'); assert.equal(result.changed,true);
  assert.equal(env.projectRepo.getActivity('A-D1')?.forecastFinish,'2026-09-28');
  assert.ok(env.projectRepo.listAttention('A').some((item)=>item.rootCauseKey==='activity:A-D1:delivery'));
  const sponsor=env.experienceService.build({userId:'bob',actingAssignmentId:'SP-A'},{projectId:'A'});
  const program=env.experienceService.build({userId:'program1',actingAssignmentId:'PROGRAM'});
  const member=env.experienceService.build({userId:'dev1',actingAssignmentId:'MEMBER'},{projectId:'A'});
  assert.ok(sponsor.attention.some((item)=>item.projectId==='A'));
  assert.ok(program.attention.some((item)=>item.projectId==='A'));
  assert.ok(member.attention.some((item)=>item.projectId==='A'));
  assert.equal(env.projectRepo.verifyEventChain('A'),true);
});

test('Phase 4 duplicate event is idempotent and conflicting reuse of the same source event identity is rejected', async()=>{
  const env=phase3Fixture(); sourceForA(env); const {events}=runtime(env);
  const first=await events.process(activityEvent()); const revision=env.projectRepo.getActivity('A-D1')!.revision;
  const duplicate=await events.process(activityEvent());
  assert.equal(first.status,'applied'); assert.equal(duplicate.status,'duplicate'); assert.equal(duplicate.control,undefined);
  assert.equal(env.projectRepo.getActivity('A-D1')!.revision,revision);
  await assert.rejects(()=>events.process(activityEvent({payload:{forecastFinish:'2026-10-01'}} as Partial<EnterpriseProjectEvent>)),(error:any)=>error instanceof GoliathError&&error.code==='DUPLICATE_EVENT');
  assert.ok(env.projectRepo.listEvents('A').some((event)=>event.eventType==='enterprise.event.integrity-conflict'));
});

test('Phase 4 older out-of-order source event is retained for audit but cannot roll project state backwards', async()=>{
  const env=phase3Fixture(); sourceForA(env); const {events}=runtime(env);
  await events.process(activityEvent({sourceEventId:'evt-new',sourceRevision:'3',sourceEffectiveAt:'2026-09-10T07:30:00.000Z',observedAt:'2026-09-10T07:31:00.000Z',payload:{forecastFinish:'2026-09-30'}} as Partial<EnterpriseProjectEvent>));
  const revision=env.projectRepo.getActivity('A-D1')!.revision;
  const stale=await events.process(activityEvent({sourceEventId:'evt-old',sourceRevision:'2',sourceEffectiveAt:'2026-09-10T07:10:00.000Z',observedAt:'2026-09-10T07:32:00.000Z',payload:{forecastFinish:'2026-09-24'}} as Partial<EnterpriseProjectEvent>));
  assert.equal(stale.status,'stale'); assert.equal(stale.changed,false);
  assert.equal(env.projectRepo.getActivity('A-D1')?.forecastFinish,'2026-09-30'); assert.equal(env.projectRepo.getActivity('A-D1')?.revision,revision);
  assert.equal(env.projectRepo.verifyEventChain('A'),true);
});

test('Phase 4 source outage degrades confidence, creates one Attention item, and recovery auto-resolves it', async()=>{
  const env=phase3Fixture(); const source=sourceForA(env); const {events}=runtime(env);
  await events.process({kind:'source.health.changed',projectId:'A',organisationId:'ORG1',entityId:source.id,sourceSystem:'Jira',sourceTenant:'tenant-1',sourceEventId:'health-down',sourceRef:source.sourceRef,sourceRevision:'2',sourceEffectiveAt:'2026-09-10T07:10:00.000Z',observedAt:'2026-09-10T07:11:00.000Z',correlationId:'health-down',payload:{status:'unavailable',lastObservedAt:'2026-09-10T07:10:00.000Z'}});
  assert.equal(env.projectRepo.getProject('A')?.evidenceConfidence,'low');
  const item=env.projectRepo.listAttention('A').find((x)=>x.rootCauseKey===`source:${source.id}:health`); assert.equal(item?.state,'open');
  await events.process({kind:'source.health.changed',projectId:'A',organisationId:'ORG1',entityId:source.id,sourceSystem:'Jira',sourceTenant:'tenant-1',sourceEventId:'health-up',sourceRef:source.sourceRef,sourceRevision:'3',sourceEffectiveAt:'2026-09-10T07:40:00.000Z',observedAt:'2026-09-10T07:41:00.000Z',correlationId:'health-up',payload:{status:'current',lastObservedAt:'2026-09-10T07:40:00.000Z'}});
  assert.equal(env.projectRepo.getProject('A')?.evidenceConfidence,'high');
  assert.equal(env.projectRepo.getAttention(item!.id)?.state,'resolved');
});

test('Phase 4 recoverable event keeps its identity when source is unavailable and applies after source recovery', async()=>{
  const env=phase3Fixture(); const source=sourceForA(env); const {events}=runtime(env);
  env.projectService.reconcileSourceState('A',source.sourceRef,{status:'unavailable',lastObservedAt:'2026-09-10T07:00:00.000Z'},'setup-down');
  const pending=activityEvent({sourceEventId:'recoverable',correlationId:'recoverable'} as Partial<EnterpriseProjectEvent>);
  await assert.rejects(()=>events.process(pending),(error:any)=>error instanceof GoliathError&&error.code==='INTEGRATION_DISABLED');
  const revision=env.projectRepo.getActivity('A-D1')!.revision;
  env.projectService.reconcileSourceState('A',source.sourceRef,{status:'current',lastObservedAt:'2026-09-10T07:30:00.000Z'},'setup-up');
  const recovered=await events.process(pending);
  assert.equal(recovered.status,'applied'); assert.equal(env.projectRepo.getActivity('A-D1')!.revision,revision+1);
  assert.equal(env.projectRepo.getActivity('A-D1')?.forecastFinish,'2026-09-28');
});

test('Phase 4 capacity and authoritative allocation events create and then resolve a real project capacity exception', async()=>{
  const env=phase3Fixture(); const rm={userId:'rm1',actingAssignmentId:'RM'}; const pm={userId:'alex',actingAssignmentId:'PM-A'};
  env.resourceService.createResource(rm,{id:'R4',userId:'dev1',displayName:'Developer',organisationId:'ORG1',orgUnitId:'ENG',active:true,skills:['TypeScript'],weeklyContractHours:40});
  env.resourceService.requestDemand(pm,{id:'DEM4',projectId:'A',teamId:'dev',orgUnitId:'ENG',skill:'TypeScript',periodStart:'2026-09-10',periodEnd:'2026-09-16',requiredHours:24});
  const {events}=runtime(env);
  await events.process({kind:'resource.capacity.changed',projectId:'A',organisationId:'ORG1',entityId:'R4',sourceSystem:'WFM',sourceTenant:'tenant-wfm',sourceEventId:'cap-1',sourceRef:'WFM:R4:CAP',sourceRevision:'1',sourceEffectiveAt:'2026-09-10T07:10:00.000Z',observedAt:'2026-09-10T07:11:00.000Z',correlationId:'cap-1',payload:{periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,unavailableHours:4}});
  const capacityItem=env.projectRepo.listAttention('A').find((x)=>x.rootCauseKey==='resource-demand:DEM4');
  assert.equal(capacityItem?.state,'open'); assert.equal(capacityItem?.consequence,'high');
  await events.process({kind:'resource.allocation.changed',projectId:'A',organisationId:'ORG1',entityId:'ALLOC4',sourceSystem:'WFM',sourceTenant:'tenant-wfm',sourceEventId:'alloc-1',sourceRef:'WFM:ALLOC4',sourceRevision:'1',sourceEffectiveAt:'2026-09-10T07:20:00.000Z',observedAt:'2026-09-10T07:21:00.000Z',correlationId:'alloc-1',payload:{resourceId:'R4',activityId:'A-D1',teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:24,status:'confirmed'}});
  assert.equal(env.projectRepo.getAttention(capacityItem!.id)?.state,'resolved');
  assert.equal(env.resourceService.getAllocationRecord('ALLOC4')?.hours,24);
});

test('Phase 4 finance event updates canonical EAC and propagates budget consequence without duplicate finance state', async()=>{
  const env=phase3Fixture(); const pm={userId:'alex',actingAssignmentId:'PM-A'}; const {events}=runtime(env);
  env.financeService.setForecast(pm,{projectId:'A',etcAmount:90000,contingencyAmount:10000,currency:'USD',asOf:'2026-09-10T07:00:00.000Z',sourceRefs:['forecast:A']});
  const result=await events.process({kind:'finance.entry.changed',projectId:'A',organisationId:'ORG1',entityId:'ERP-ACT-1',sourceSystem:'ERP',sourceTenant:'erp-prod',sourceEventId:'fin-1',sourceRef:'ERP:A:ACT:1',sourceRevision:'1',sourceEffectiveAt:'2026-09-10T07:10:00.000Z',observedAt:'2026-09-10T07:11:00.000Z',correlationId:'fin-1',payload:{entryType:'actual',amount:20000,currency:'USD',occurredAt:'2026-09-10T07:10:00.000Z',classification:'confidential'}});
  assert.equal(result.status,'applied'); assert.equal(env.projectRepo.getProject('A')?.eac,120000);
  assert.ok(env.projectRepo.listAttention('A').some((x)=>x.rootCauseKey==='project:A:budget'));
  const sponsor=env.experienceService.build({userId:'bob',actingAssignmentId:'SP-A'},{projectId:'A'});
  assert.ok(sponsor.attention.some((x)=>x.projectId==='A'&&x.nextAction==='decide'));
  assert.equal(env.financeRepo.listEntries('A').filter((e)=>e.sourceRef==='ERP:A:ACT:1').length,1);
});

test('Phase 4 retries after downstream control failure without applying the same canonical activity update twice', async()=>{
  const env=phase3Fixture(); sourceForA(env);
  const provider=new ResourceCapacitySignalProvider(env.resourceRepo,env.projectRepo);
  const real=new ProjectControlCoordinator(env.projectRepo,new DeterministicFallbackAi(),new RepositoryEvidenceResolver(),env.now,[provider]);
  let attempts=0;
  const runner={run:async(projectId:string)=>{attempts+=1;if(attempts===1)throw new Error('temporary control failure');return real.run(projectId);}};
  const events=new EnterpriseEventIntelligenceService(env.projectRepo,env.projectService,env.resourceService,env.financeService,runner,env.now);
  const input=activityEvent({sourceEventId:'retry-after-failure',correlationId:'retry-after-failure'} as Partial<EnterpriseProjectEvent>);
  const before=env.projectRepo.getActivity('A-D1')!.revision;
  await assert.rejects(()=>events.process(input),/temporary control failure/);
  const afterFailure=env.projectRepo.getActivity('A-D1')!.revision; assert.equal(afterFailure,before+1);
  const retry=await events.process(input); assert.equal(retry.status,'applied'); assert.equal(retry.changed,false);
  assert.equal(env.projectRepo.getActivity('A-D1')!.revision,afterFailure); assert.equal(attempts,2);
  assert.equal(env.projectRepo.verifyEventChain('A'),true);
});

test('Phase 4 AI failure never blocks deterministic project control', async()=>{
  const env=phase3Fixture(); sourceForA(env); const {events}=runtime(env,new ThrowingAi());
  const result=await events.process(activityEvent({sourceEventId:'ai-offline'} as Partial<EnterpriseProjectEvent>));
  assert.equal(result.status,'applied'); assert.equal(result.control?.cycle.aiAssessments,0);
  assert.ok(env.projectRepo.listAttention('A').some((x)=>x.rootCauseKey==='activity:A-D1:delivery'));
});

test('Phase 4 unchanged control state does not regenerate AI advice, Attention revisions or report snapshots', async()=>{
  const env=phase3Fixture(); sourceForA(env); const ai=new CountingAi(); const {events,coordinator}=runtime(env,ai);
  await events.process(activityEvent({sourceEventId:'quiet-repeat'} as Partial<EnterpriseProjectEvent>));
  const item=env.projectRepo.listAttention('A').find((x)=>x.rootCauseKey==='activity:A-D1:delivery')!;
  const revision=item.revision; const aiCalls=ai.calls; const snapshots=env.projectRepo.listProjections('A').length;
  const second=await coordinator.run('A');
  assert.equal(second.cycle.attentionUpdated,0); assert.equal(second.cycle.aiAssessments,0); assert.equal(second.persistedProjectionCount,0);
  assert.equal(env.projectRepo.getAttention(item.id)?.revision,revision); assert.equal(ai.calls,aiCalls); assert.equal(env.projectRepo.listProjections('A').length,snapshots);
});

test('Phase 4 role revocation removes future access without deleting canonical state or attention', async()=>{
  const env=phase3Fixture(); sourceForA(env); const {events}=runtime(env);
  await events.process(activityEvent({sourceEventId:'revoke-view'} as Partial<EnterpriseProjectEvent>));
  const attentionCount=env.projectRepo.listAttention('A').filter((x)=>x.state==='open').length;
  env.contextService.revokeResponsibility('PM-A','admin','PM responsibility ended');
  assert.throws(()=>env.experienceService.build({userId:'alex',actingAssignmentId:'PM-A'},{projectId:'A'}),(error:any)=>error instanceof GoliathError&&error.code==='ACCESS_DENIED');
  assert.equal(env.projectRepo.listAttention('A').filter((x)=>x.state==='open').length,attentionCount);
  assert.ok(env.experienceService.build({userId:'bob',actingAssignmentId:'SP-A'},{projectId:'A'}).attention.length>0);
});

test('Phase 4 cross-organisation spoof is rejected before canonical mutation or accepted-event audit', async()=>{
  const env=phase3Fixture(); sourceForA(env); const {events}=runtime(env);
  const before=env.projectRepo.getActivity('A-D1')!.revision;
  await assert.rejects(()=>events.process(activityEvent({organisationId:'OTHER',sourceEventId:'spoof'} as Partial<EnterpriseProjectEvent>)),(error:any)=>error instanceof GoliathError&&error.code==='ACCESS_DENIED');
  assert.equal(env.projectRepo.getActivity('A-D1')!.revision,before);
  assert.equal(env.projectRepo.listEvents('A').filter((e)=>e.correlationId==='corr-1'&&e.eventType==='enterprise.event.accepted').length,0);
});

test('Phase 4 Delivery Lead Attention excludes unrelated QA exceptions while PM retains complete visibility', async()=>{
  const env=phase3Fixture(); sourceForA(env); const {events}=runtime(env);
  await events.process(activityEvent({sourceEventId:'role-filter'} as Partial<EnterpriseProjectEvent>));
  const lead=env.experienceService.build({userId:'devlead',actingAssignmentId:'LEAD'},{projectId:'A'});
  const pm=env.experienceService.build({userId:'alex',actingAssignmentId:'PM-A'},{projectId:'A'});
  assert.ok(pm.attention.length>lead.attention.length);
  assert.ok(lead.attention.every((item)=>item.title!=='System test is blocked'));
  assert.ok(lead.attention.some((item)=>item.title.includes('Dependency gate is not satisfied for System test')),'cross-team dependency remains visible because Development is the predecessor');
});

test('Phase 4 activity source authority cannot be spoofed by another registered source', async()=>{
  const env=phase3Fixture(); sourceForA(env);
  env.projectService.registerSource('A','alex',{id:'SRC-OTHER',projectId:'A',sourceType:'delivery',sourceRef:'OTHER-A-1',authority:'execution',status:'current',lastObservedAt:'2026-09-10T07:00:00.000Z',freshnessHours:24,classification:'internal',revision:1});
  const {events}=runtime(env); const before=env.projectRepo.getActivity('A-D1')!.revision;
  await assert.rejects(()=>events.process(activityEvent({sourceEventId:'wrong-source',sourceSystem:'OtherTool',sourceRef:'OTHER-A-1'} as Partial<EnterpriseProjectEvent>)),(error:any)=>error instanceof GoliathError&&error.code==='FIELD_AUTHORITY_DENIED');
  assert.equal(env.projectRepo.getActivity('A-D1')!.revision,before);
  assert.ok(env.projectRepo.listEvents('A').some((e)=>e.eventType==='enterprise.event.source-authority-denied'));
});

test('Phase 4 authoritative allocation cannot silently switch provider/source identity', async()=>{
  const env=phase3Fixture(); const rm={userId:'rm1',actingAssignmentId:'RM'};
  env.resourceService.createResource(rm,{id:'R5',userId:'dev1',displayName:'Developer 5',organisationId:'ORG1',orgUnitId:'ENG',active:true,skills:['TypeScript'],weeklyContractHours:40});
  const {events}=runtime(env);
  const base={kind:'resource.allocation.changed' as const,projectId:'A',organisationId:'ORG1',entityId:'ALLOC5',sourceSystem:'WFM',sourceTenant:'wfm',sourceEventId:'alloc5-1',sourceRef:'WFM:ALLOC5',sourceRevision:'1',sourceEffectiveAt:'2026-09-10T07:00:00.000Z',observedAt:'2026-09-10T07:01:00.000Z',correlationId:'alloc5-1',payload:{resourceId:'R5',activityId:'A-D1',teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:10,status:'confirmed' as const}};
  await events.process(base);
  await assert.rejects(()=>events.process({...base,sourceSystem:'OtherWFM',sourceEventId:'alloc5-2',sourceRef:'OTHER:ALLOC5',sourceRevision:'2',sourceEffectiveAt:'2026-09-10T07:10:00.000Z',observedAt:'2026-09-10T07:11:00.000Z',correlationId:'alloc5-2',payload:{...base.payload,hours:20}}),(error:any)=>error instanceof GoliathError&&error.code==='FIELD_AUTHORITY_DENIED');
  assert.equal(env.resourceService.getAllocationRecord('ALLOC5')?.hours,10);
});
