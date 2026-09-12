import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CiCdWebhookAdapter, ContextualOutboundEffects, ContractTestAdapter, EnterpriseEventIntelligenceService, GitHubWebhookAdapter,
  HrCapacityWebhookAdapter, InMemoryIntegrationRepository, IntegrationOrchestrator, M365TranscriptWebhookAdapter,
  MeetingIntelligenceService, ProcurementWebhookAdapter, ProviderQueueWorker, ProviderWebhookGateway,
  SqliteProviderRuntimeRepository, StaticWebhookSecretProvider, TimesheetWebhookAdapter, digest, signWebhook,
  type IntegrationBinding,
} from '../src/index.js';
import { phase5Fixture, signedHeaders } from './phase5-fixture.js';

function env7(){
  const env=phase5Fixture();
  env.db.exec(readFileSync(new URL('../../migrations/20260911_phase6_production_readiness.sql',import.meta.url),'utf8'));
  env.db.exec(readFileSync(new URL('../../migrations/20260911_phase7_enterprise_connectors.sql',import.meta.url),'utf8'));
  return env;
}
function addBinding(env:any,id:string,domain:string,provider:string,account:string,resourceType:string,externalId:string,localEntityType:string,localEntityId:string){
  const now=env.now().toISOString();
  env.db.prepare(`INSERT INTO integration_bindings_v2(id,organisation_id,project_id,domain,provider,environment,enabled,authority_mode,inbound_fields_json,outbound_actions_json,classification,version,created_at,updated_at) VALUES(?,'ORG1','F5',?,?, 'prod',1,'automatic-approved','[]','[]','internal',1,?,?)`).run(id,domain,provider,now,now);
  env.db.prepare(`INSERT INTO external_object_links_v2(id,organisation_id,project_id,binding_id,provider_account_id,provider_environment,resource_type,external_id,local_entity_type,local_entity_id,mapping_version,effective_from) VALUES(?,'ORG1','F5',?,?,'prod',?,?,?,?,1,'2026-09-01T00:00:00.000Z')`).run(`M-${id}`,id,account,resourceType,externalId,localEntityType,localEntityId);
}
function sourceActivity(env:any,activityId:string,system:string,ref:string){const a=env.projectRepo.getActivity(activityId)!;env.projectRepo.updateActivity({...a,sourceSystem:system,sourceRef:ref,revision:a.revision+1});env.projectRepo.upsertSource({id:`SRC-${activityId}-${system}`,projectId:'F5',sourceType:'delivery',sourceRef:ref,authority:`${system} delivery status`,status:'current',lastObservedAt:env.now().toISOString(),freshnessHours:24,classification:'internal',revision:1});}

async function runWebhook(env:any,provider:any,bindingId:string,secret:string,account:string,raw:string,adapter:any,events:any){
  const repo=new SqliteProviderRuntimeRepository(env.db,env.now); const gw=new ProviderWebhookGateway(repo,{[provider]:adapter},new StaticWebhookSecretProvider({[bindingId]:{secret,keyId:'k1'}}),env.now); const q=new ProviderQueueWorker(repo,events,env.now,3); gw.receive({provider,bindingId,headers:signedHeaders(signWebhook(secret,raw),account),rawBody:raw}); const r=await q.drain(); assert.equal(r.processed,1);
}

test('Phase 7 GitHub and CI/CD adapters require authoritative completion evidence and update canonical activities',async()=>{
  let env=env7(); sourceActivity(env,'F5-D1','GitHub','GITHUB:101'); addBinding(env,'B-GH','cicd','github','gh-prod','pull-request','101','activity','F5-D1');
  const gh=JSON.stringify({deliveryId:'gh-1',number:'101',pull_request:{number:101,merged:true,merged_at:'2026-09-10T09:00:00.000Z',updated_at:'2026-09-10T09:00:00.000Z'}});
  await runWebhook(env,'github','B-GH','gh-secret','gh-prod',gh,new GitHubWebhookAdapter(),env.events); assert.equal(env.projectRepo.getActivity('F5-D1')?.status,'done');

  env=env7(); sourceActivity(env,'F5-Q1','CI/CD','CICD:dep-1'); addBinding(env,'B-CI','cicd','cicd','ci-prod','deployment','dep-1','activity','F5-Q1');
  const ci=JSON.stringify({eventId:'ci-1',deploymentId:'dep-1',revision:2,updatedAt:'2026-09-10T09:10:00.000Z',state:'succeeded',completedAt:'2026-09-10T09:10:00.000Z'});
  await runWebhook(env,'cicd','B-CI','ci-secret','ci-prod',ci,new CiCdWebhookAdapter(),env.events); assert.equal(env.projectRepo.getActivity('F5-Q1')?.status,'done');
});

test('Phase 7 HR leave, procurement commitment and timesheet actual effort use existing canonical domains',async()=>{
  const env=env7();
  addBinding(env,'B-HR','workforce','hr','hr-prod','capacity','R-F5','resource','R-F5');
  const hr=JSON.stringify({eventId:'hr-1',resourceId:'R-F5',revision:1,updatedAt:'2026-09-10T09:00:00.000Z',periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,leaveHours:8});
  await runWebhook(env,'hr','B-HR','hr-secret','hr-prod',hr,new HrCapacityWebhookAdapter(),env.events); assert.equal(env.resourceService.getCapacityRecord('R-F5','2026-09-10','2026-09-16')?.unavailableHours,8);

  addBinding(env,'B-PO','procurement','procurement','proc-prod','finance-entry','PO-1','finance-entry','PO-1');
  const po=JSON.stringify({eventId:'po-1',purchaseOrderId:'PO-1',revision:1,updatedAt:'2026-09-10T09:05:00.000Z',committedAmount:12000,currency:'USD'});
  await runWebhook(env,'procurement','B-PO','po-secret','proc-prod',po,new ProcurementWebhookAdapter(),env.events); assert.equal(env.financeRepo.listEntries('F5').some((x:any)=>x.sourceRef==='PROCUREMENT:PO-1'),true);

  addBinding(env,'B-TS','workforce','timesheet','ts-prod','worklog','WL-1','worklog','WL-1');
  const ts=JSON.stringify({eventId:'ts-1',worklogId:'WL-1',revision:1,updatedAt:'2026-09-10T09:10:00.000Z',resourceId:'R-F5',activityId:'F5-D1',workDate:'2026-09-10',hours:6.5,billable:true});
  await runWebhook(env,'timesheet','B-TS','ts-secret','ts-prod',ts,new TimesheetWebhookAdapter(),env.events); assert.equal(env.resourceService.getProjectActualEffort('F5'),6.5);
});

test('Phase 7 M365 transcript proposals remain non-authoritative until contextual human confirmation',async()=>{
  const env=env7(); addBinding(env,'B-M365','documents','m365','m365-prod','transcript','MEET-1','meeting','MEET-1');
  const meeting=new MeetingIntelligenceService(env.boundary,env.projectRepo,env.projectService,{extract:async()=>[{kind:'action',title:'Confirm UAT owner',ownerId:'f5-pm',confidence:'high'}]},env.now);
  const events=new EnterpriseEventIntelligenceService(env.projectRepo,env.projectService,env.resourceService,env.financeService,{run:async()=>({projectId:'F5',signals:[],cycle:{cycleId:'x',projectId:'F5',observedSignals:0,materialSignals:0,attentionCreated:0,attentionUpdated:0,autoResolved:0,preparedActions:[],aiAssessments:0,suppressedAsNoMaterialChange:true,completedAt:env.now().toISOString()},createdWorkActions:[],projections:[],traceability:{} as any,persistedProjectionCount:0})},env.now,meeting);
  const raw=JSON.stringify({eventId:'m365-1',meetingId:'MEET-1',revision:1,completedAt:'2026-09-10T09:00:00.000Z',transcriptRef:'M365:TRANSCRIPT:1',text:'Faye will confirm the UAT owner tomorrow.'});
  await runWebhook(env,'m365','B-M365','m365-secret','m365-prod',raw,new M365TranscriptWebhookAdapter(),events);
  const proposal=env.projectRepo.listEvents('F5').find((e:any)=>e.eventType==='meeting.proposal')!; assert.ok(proposal); assert.equal(env.projectRepo.listWorkActions('F5').some((a:any)=>a.sourceRefs.includes('M365:TRANSCRIPT:1')),false);
  const result=meeting.confirm(env.pm,'F5',proposal.id); assert.equal(result.confirmed,true); assert.equal(env.projectRepo.listWorkActions('F5').some((a:any)=>a.sourceRefs.includes('M365:TRANSCRIPT:1')),true);
});

test('Phase 7 contextual outbound effects keep provider execution with delivery roles, not Sponsor authority',async()=>{
  const env=env7(); const repo=new InMemoryIntegrationRepository(); const binding:IntegrationBinding={id:'OUT-QA',organisationId:'ORG1',projectId:'F5',domain:'qa',provider:'qa-out',environment:'prod',enabled:true,authorityMode:'automatic-approved',allowedInboundFields:[],allowedOutboundActions:['createDefect'],classification:'internal'}; repo.putBinding(binding);
  const orchestrator=new IntegrationOrchestrator(repo,{'qa-out':new ContractTestAdapter('qa-out',['qa'])},env.now); const app=new ContextualOutboundEffects(env.boundary,orchestrator);
  const intent=app.prepare(env.pm,{bindingId:'OUT-QA',projectId:'F5',action:'createDefect',targetExternalId:'DEF-1',targetResourceType:'defect',payload:{summary:'Critical acceptance defect'},correlationId:'out-1'}); assert.equal(intent.state,'prepared'); assert.equal((await app.dispatch(env.pm,'F5',intent.id)).state,'dispatched');
  assert.throws(()=>app.prepare({userId:'f5-sponsor',actingAssignmentId:'F5-SP'},{bindingId:'OUT-QA',projectId:'F5',action:'createDefect',targetExternalId:'DEF-2',targetResourceType:'defect',payload:{summary:'x'},correlationId:'out-2'}),/not permitted|Action is not permitted/i);
});

test('Phase 7 same timesheet revision with conflicting content is rejected without duplicate actual effort',async()=>{
  const env=env7(); addBinding(env,'B-TS','workforce','timesheet','ts-prod','worklog','WL-1','worklog','WL-1');
  const first=JSON.stringify({eventId:'ts-1',worklogId:'WL-1',revision:1,updatedAt:'2026-09-10T09:10:00.000Z',resourceId:'R-F5',activityId:'F5-D1',workDate:'2026-09-10',hours:6,billable:true});
  await runWebhook(env,'timesheet','B-TS','ts-secret','ts-prod',first,new TimesheetWebhookAdapter(),env.events); assert.equal(env.resourceService.getProjectActualEffort('F5'),6);
  const svc=env.resourceService; assert.throws(()=>svc.ingestAuthoritativeWorklog({id:'WL-1',resourceId:'R-F5',projectId:'F5',activityId:'F5-D1',workDate:'2026-09-10',hours:7,billable:true,sourceSystem:'Timesheet',sourceRef:'TIMESHEET:WL-1',sourceRevision:'1'}),/conflicting content/i); assert.equal(svc.getProjectActualEffort('F5'),6);
});
