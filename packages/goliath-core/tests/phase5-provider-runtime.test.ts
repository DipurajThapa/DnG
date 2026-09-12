import test from 'node:test';
import assert from 'node:assert/strict';
import { GoliathError, ProviderQueueWorker, signWebhook } from '../src/index.js';
import { phase5Fixture, signedHeaders } from './phase5-fixture.js';

test('Phase 5 provider gateway authenticates, queues, deduplicates and applies Jira without PM re-entry', async()=>{
  const env=phase5Fixture();
  const raw=JSON.stringify({webhookEvent:'jira:issue_updated',timestamp:'2026-09-10T08:05:00.000Z',issue:{id:'1001',key:'F5-D1',fields:{status:{name:'Done'},resolutiondate:'2026-09-10T08:05:00.000Z'}}});
  assert.throws(()=>env.webhooks.receive({provider:'jira-cloud',bindingId:'F5-B-JIRA',headers:signedHeaders('bad','jira-prod','J-1','2026-09-10T08:05:00.000Z'),rawBody:raw}),/signature/i);
  assert.equal(env.runtimeRepo.listInbox().length,0);
  const sig=signWebhook('jira-secret-for-phase5-runtime',raw);
  const accepted=env.webhooks.receive({provider:'jira-cloud',bindingId:'F5-B-JIRA',headers:signedHeaders(sig,'jira-prod','J-1','2026-09-10T08:05:00.000Z'),rawBody:raw});
  assert.equal(accepted.status,'queued');
  assert.equal((await env.queue.drain()).processed,1);
  assert.equal(env.projectRepo.getActivity('F5-D1')?.status,'done');
  const duplicate=env.webhooks.receive({provider:'jira-cloud',bindingId:'F5-B-JIRA',headers:signedHeaders(sig,'jira-prod','J-1','2026-09-10T08:05:00.000Z'),rawBody:raw});
  assert.equal(duplicate.status,'duplicate');
  const changed=JSON.stringify({webhookEvent:'jira:issue_updated',timestamp:'2026-09-10T08:05:00.000Z',issue:{id:'1001',key:'F5-D1',fields:{status:{name:'In Progress'}}}});
  const changedSig=signWebhook('jira-secret-for-phase5-runtime',changed);
  assert.throws(()=>env.webhooks.receive({provider:'jira-cloud',bindingId:'F5-B-JIRA',headers:signedHeaders(changedSig,'jira-prod','J-1','2026-09-10T08:05:00.000Z'),rawBody:changed}),(e:any)=>e instanceof GoliathError&&e.code==='DUPLICATE_EVENT');
});

test('Phase 5 workforce and ERP adapters update the same canonical Resource and Finance records', async()=>{
  const env=phase5Fixture();
  const cap=JSON.stringify({eventId:'W-CAP-1',recordType:'capacity',resourceId:'R-F5',revision:1,updatedAt:'2026-09-10T08:10:00.000Z',periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,unavailableHours:4});
  env.webhooks.receive({provider:'workforce',bindingId:'F5-B-WFM',headers:signedHeaders(signWebhook('wfm-secret-for-phase5-runtime',cap),'wfm-prod'),rawBody:cap});
  assert.equal((await env.queue.drain()).processed,1);
  assert.equal(env.resourceService.getCapacityRecord('R-F5','2026-09-10','2026-09-16')?.grossHours,40);
  const shortage=env.projectRepo.listAttention('F5').find((x)=>x.rootCauseKey==='resource-demand:DEM-F5');
  assert.equal(shortage?.state,'open');

  const alloc=JSON.stringify({eventId:'W-ALLOC-1',recordType:'allocation',allocationId:'ALLOC-F5',revision:1,updatedAt:'2026-09-10T08:15:00.000Z',resourceId:'R-F5',activityId:'F5-D1',teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:24,status:'confirmed'});
  env.webhooks.receive({provider:'workforce',bindingId:'F5-B-WFM',headers:signedHeaders(signWebhook('wfm-secret-for-phase5-runtime',alloc),'wfm-prod'),rawBody:alloc});
  assert.equal((await env.queue.drain()).processed,1);
  assert.equal(env.resourceService.getAllocationRecord('ALLOC-F5')?.hours,24);
  assert.equal(env.projectRepo.getAttention(shortage!.id)?.state,'resolved');

  const fin=JSON.stringify({eventId:'ERP-1',recordId:'ACT-1',revision:1,entryType:'actual',amount:15000,currency:'USD',occurredAt:'2026-09-10T08:20:00.000Z',classification:'confidential'});
  env.webhooks.receive({provider:'erp-finance',bindingId:'F5-B-ERP',headers:signedHeaders(signWebhook('erp-secret-for-phase5-runtime',fin),'erp-prod'),rawBody:fin});
  assert.equal((await env.queue.drain()).processed,1);
  assert.equal(env.financeRepo.listEntries('F5').filter((x)=>x.sourceRef==='ERP:ACT-1').length,1);
  assert.equal(env.projectRepo.getProject('F5')?.eac,90000);
});

test('Phase 5 QA adapter creates one canonical delivery exception visible by responsibility', async()=>{
  const env=phase5Fixture();
  const raw=JSON.stringify({eventId:'QA-1',activityKey:'F5-Q1',revision:2,updatedAt:'2026-09-10T08:30:00.000Z',status:'In Progress',forecastFinish:'2026-10-15',blocker:'Acceptance defects remain open'});
  env.webhooks.receive({provider:'qa-system',bindingId:'F5-B-QA',headers:signedHeaders(signWebhook('qa-secret-for-phase5-runtime-01',raw),'qa-prod'),rawBody:raw});
  assert.equal((await env.queue.drain()).processed,1);
  const item=env.projectRepo.listAttention('F5').find((x)=>x.rootCauseKey==='activity:F5-Q1:delivery');
  assert.ok(item); assert.equal(item?.state,'open');
  const pm=env.experienceService.build({userId:'f5-pm',actingAssignmentId:'F5-PM'},{projectId:'F5'});
  const sp=env.experienceService.build({userId:'f5-sponsor',actingAssignmentId:'F5-SP'},{projectId:'F5'});
  const member=env.experienceService.build({userId:'f5-dev',actingAssignmentId:'F5-DEV'},{projectId:'F5'});
  assert.ok(pm.attention.some((x)=>x.attentionId===item!.id));
  assert.ok(sp.attention.some((x)=>x.attentionId===item!.id));
  assert.ok(!member.attention.some((x)=>x.attentionId===item!.id));
  assert.equal(env.projectRepo.listAttention('F5').filter((x)=>x.rootCauseKey==='activity:F5-Q1:delivery').length,1);
});

test('Phase 5 runtime fails closed for missing mapping, disabled binding and permanent provider data errors', async()=>{
  const env=phase5Fixture();
  const unknown=JSON.stringify({webhookEvent:'jira:issue_updated',timestamp:'2026-09-10T08:05:00.000Z',issue:{id:'999',key:'NO-MAP',fields:{status:{name:'Done'},resolutiondate:'2026-09-10T08:05:00.000Z'}}});
  assert.throws(()=>env.webhooks.receive({provider:'jira-cloud',bindingId:'F5-B-JIRA',headers:signedHeaders(signWebhook('jira-secret-for-phase5-runtime',unknown),'jira-prod','J-X'),rawBody:unknown}),(e:any)=>e instanceof GoliathError&&e.code==='MAPPING_REQUIRED');
  env.db.prepare("UPDATE integration_bindings_v2 SET enabled=0 WHERE id='F5-B-JIRA'").run();
  const known=JSON.stringify({webhookEvent:'jira:issue_updated',timestamp:'2026-09-10T08:06:00.000Z',issue:{id:'1001',key:'F5-D1',fields:{status:{name:'Done'},resolutiondate:'2026-09-10T08:05:00.000Z'}}});
  assert.throws(()=>env.webhooks.receive({provider:'jira-cloud',bindingId:'F5-B-JIRA',headers:signedHeaders(signWebhook('jira-secret-for-phase5-runtime',known),'jira-prod','J-DIS'),rawBody:known}),(e:any)=>e instanceof GoliathError&&e.code==='INTEGRATION_DISABLED');
  env.db.prepare("UPDATE integration_bindings_v2 SET enabled=1 WHERE id='F5-B-JIRA'").run();

  const negative=JSON.stringify({eventId:'ERP-BAD',recordId:'ACT-1',revision:2,entryType:'actual',amount:-1,currency:'USD',occurredAt:'2026-09-10T08:20:00.000Z'});
  const accepted=env.webhooks.receive({provider:'erp-finance',bindingId:'F5-B-ERP',headers:signedHeaders(signWebhook('erp-secret-for-phase5-runtime',negative),'erp-prod'),rawBody:negative});
  assert.equal(accepted.status,'queued');
  const result=await env.queue.drain();
  assert.equal(result.deadLettered,1);
  const row=env.runtimeRepo.listInbox().find((x)=>x.providerEventId==='ERP-BAD');
  assert.equal(row?.state,'dead-letter');
  assert.equal(env.financeRepo.listEntries('F5').length,0);
});

test('Phase 5 queue retries transient processing errors without duplicating the accepted event', async()=>{
  const env=phase5Fixture();
  const raw=JSON.stringify({webhookEvent:'jira:issue_updated',timestamp:'2026-09-10T08:05:00.000Z',issue:{id:'1001',key:'F5-D1',fields:{status:{name:'Done'},resolutiondate:'2026-09-10T08:05:00.000Z'}}});
  env.webhooks.receive({provider:'jira-cloud',bindingId:'F5-B-JIRA',headers:signedHeaders(signWebhook('jira-secret-for-phase5-runtime',raw),'jira-prod','J-RETRY','2026-09-10T08:05:00.000Z'),rawBody:raw});
  let now=new Date('2026-09-10T08:00:00.000Z');let calls=0;
  const worker=new ProviderQueueWorker(env.runtimeRepo,{process:async()=>{calls++;if(calls===1)throw new Error('temporary network/storage failure');return {eventId:'ok',status:'applied' as const,changed:true};}},()=>now,3);
  const first=await worker.drain();assert.equal(first.retried,1);
  const row=env.runtimeRepo.listInbox().find((x)=>x.providerEventId==='J-RETRY')!;assert.equal(row.state,'retryable');assert.equal(row.attemptCount,1);
  now=new Date('2026-09-10T08:00:02.000Z');
  const second=await worker.drain();assert.equal(second.processed,1);assert.equal(calls,2);
  assert.equal(env.runtimeRepo.listInbox().filter((x)=>x.providerEventId==='J-RETRY').length,1);
});
