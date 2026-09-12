import test from 'node:test';
import assert from 'node:assert/strict';
import { GoliathError, HmacSessionService, ProviderQueueWorker, ProviderWebhookGateway, StaticWebhookSecretProvider, JiraCloudWebhookAdapter, QaWebhookAdapter, ErpFinanceWebhookAdapter, WorkforceWebhookAdapter, signWebhook } from '../src/index.js';
import { phase5Fixture, signedHeaders } from './phase5-fixture.js';

test('Phase 5 rejects a completed Jira event without authoritative completion time instead of inventing actual finish',()=>{
  const env=phase5Fixture();
  const raw=JSON.stringify({webhookEvent:'jira:issue_updated',timestamp:'2026-09-10T08:05:00.000Z',issue:{id:'1001',key:'F5-D1',fields:{status:{name:'Done'}}}});
  assert.throws(()=>env.webhooks.receive({provider:'jira-cloud',bindingId:'F5-B-JIRA',headers:signedHeaders(signWebhook('jira-secret-for-phase5-runtime',raw),'jira-prod','J-NO-FINISH','2026-09-10T08:05:00.000Z'),rawBody:raw}),(e:any)=>e instanceof GoliathError&&e.code==='INVALID_INPUT');
  assert.equal(env.runtimeRepo.listInbox().length,0);
  assert.equal(env.projectRepo.getActivity('F5-D1')?.status,'in-progress');
});

test('Phase 5 binding/mapping scope and provider identity fail closed before queue mutation',()=>{
  const env=phase5Fixture();
  const raw=JSON.stringify({webhookEvent:'jira:issue_updated',timestamp:'2026-09-10T08:05:00.000Z',issue:{id:'1001',key:'F5-D1',fields:{status:{name:'In Progress'}}}});
  const sig=signWebhook('jira-secret-for-phase5-runtime',raw);
  assert.throws(()=>env.webhooks.receive({provider:'qa-system',bindingId:'F5-B-JIRA',headers:signedHeaders(sig,'jira-prod','J-PROVIDER'),rawBody:raw}),(e:any)=>e instanceof GoliathError&&e.code==='ACCESS_DENIED');
  env.db.prepare("UPDATE external_object_links_v2 SET provider_environment='staging' WHERE id='F5-M-JIRA'").run();
  assert.throws(()=>env.webhooks.receive({provider:'jira-cloud',bindingId:'F5-B-JIRA',headers:signedHeaders(sig,'jira-prod','J-ENV'),rawBody:raw}),(e:any)=>e instanceof GoliathError&&e.code==='ACCESS_DENIED');
  assert.equal(env.runtimeRepo.listInbox().length,0);
});

test('Phase 5 queue recovers an abandoned processing lease and replays safely through event idempotency',async()=>{
  const env=phase5Fixture();
  const raw=JSON.stringify({webhookEvent:'jira:issue_updated',timestamp:'2026-09-10T08:05:00.000Z',issue:{id:'1001',key:'F5-D1',fields:{status:{name:'In Progress'}}}});
  env.webhooks.receive({provider:'jira-cloud',bindingId:'F5-B-JIRA',headers:signedHeaders(signWebhook('jira-secret-for-phase5-runtime',raw),'jira-prod','J-LEASE','2026-09-10T08:05:00.000Z'),rawBody:raw});
  const row=env.runtimeRepo.listInbox().find((x)=>x.providerEventId==='J-LEASE')!;
  assert.equal(env.runtimeRepo.markProcessing(row.id),true);
  let clock=new Date('2026-09-10T08:01:00.000Z');
  const worker=new ProviderQueueWorker(env.runtimeRepo,env.events,()=>clock,3,30_000);
  const result=await worker.drain();
  assert.equal(result.recovered,1);assert.equal(result.processed,1);
  assert.equal(env.runtimeRepo.getInbox(row.id)?.state,'processed');
  assert.equal(env.runtimeRepo.listInbox().filter((x)=>x.providerEventId==='J-LEASE').length,1);
});

test('Phase 5 signed sessions expire and cannot be extended by keeping an old acting context open',()=>{
  let clock=new Date('2026-09-10T08:00:00.000Z');
  const sessions=new HmacSessionService('phase5-expiry-signing-secret-001',()=>clock,10);
  const token=sessions.issue('u1','User One');assert.equal(sessions.verify(token).userId,'u1');
  clock=new Date('2026-09-10T08:00:11.000Z');
  assert.throws(()=>sessions.verify(token),(e:any)=>e instanceof GoliathError&&e.code==='ACCESS_DENIED');
});

test('Phase 5 webhook fails closed when its configured binding has no runtime secret',()=>{
  const env=phase5Fixture();
  const gateway=new ProviderWebhookGateway(env.runtimeRepo,{
    'jira-cloud':new JiraCloudWebhookAdapter(),
    'qa-system':new QaWebhookAdapter(),
    'erp-finance':new ErpFinanceWebhookAdapter(),
    workforce:new WorkforceWebhookAdapter(),
  },new StaticWebhookSecretProvider({}),env.now);
  const raw=JSON.stringify({webhookEvent:'jira:issue_updated',timestamp:'2026-09-10T08:05:00.000Z',issue:{id:'1001',key:'F5-D1',fields:{status:{name:'In Progress'}}}});
  assert.throws(()=>gateway.receive({provider:'jira-cloud',bindingId:'F5-B-JIRA',headers:signedHeaders(signWebhook('jira-secret-for-phase5-runtime',raw),'jira-prod','J-NO-SECRET'),rawBody:raw}),(e:any)=>e instanceof GoliathError&&e.code==='INTEGRATION_DISABLED');
  assert.equal(env.runtimeRepo.listInbox().length,0);
});
