import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EnterpriseOidcIdentityProvider, HmacSessionService, ManagedWebhookSecretProvider, OperationalHealthService,
  ProductionReadinessGate, ProviderReconciliationService, JiraCloudWebhookAdapter, type VerifiedOidcClaims,
} from '../src/index.js';
import { phase5Fixture } from './phase5-fixture.js';

function env6(){const env=phase5Fixture();env.db.exec(readFileSync(new URL('../../migrations/20260911_phase6_production_readiness.sql',import.meta.url),'utf8'));return env;}

test('Phase 6 enterprise OIDC adapter validates trust and terminates at GOLIATH user session',async()=>{
  const now=()=>new Date('2026-09-11T00:00:00.000Z'); const sessions=new HmacSessionService('phase6-session-signing-secret-0001',now);
  const claims:VerifiedOidcClaims={issuer:'https://login.example',audience:'goliath',subject:'sub-1',email:'pm@example.com',emailVerified:true,displayName:'PM',expiresAt:'2026-09-11T01:00:00.000Z'};
  const idp=new EnterpriseOidcIdentityProvider({verify:async()=>claims},{resolve:c=>c.subject==='sub-1'?{userId:'f5-pm',displayName:c.displayName}:undefined},sessions,['https://login.example'],'goliath',now);
  const login=await idp.login('verified-jwt'); assert.equal(login.principal.userId,'f5-pm');
  const bad=new EnterpriseOidcIdentityProvider({verify:async()=>({...claims,audience:'wrong'})},{resolve:()=>({userId:'x',displayName:'x'})},sessions,['https://login.example'],'goliath',now);
  await assert.rejects(()=>bad.login('x'),/issuer or audience/i);
});

test('Phase 6 managed secret provider stores only reference in binding',()=>{
  const env=env6(); env.db.prepare("UPDATE integration_bindings_v2 SET secret_reference='vault://jira/f5' WHERE id='F5-B-JIRA'").run();
  const p=new ManagedWebhookSecretProvider(env.db,{resolve:r=>r==='vault://jira/f5'?{secret:'resolved-secret',keyId:'vault-k1'}:undefined});
  assert.deepEqual(p.get('F5-B-JIRA'),{secret:'resolved-secret',keyId:'vault-k1'}); assert.equal(String(env.db.prepare("SELECT secret_reference FROM integration_bindings_v2 WHERE id='F5-B-JIRA'").get()!.secret_reference),'vault://jira/f5');
});

test('Phase 6 reconciliation reuses mapping/inbox and preserves last cursor on empty final page',async()=>{
  const env=env6(); let call=0;
  const service=new ProviderReconciliationService(env.runtimeRepo,{'jira-cloud':new JiraCloudWebhookAdapter()}, {fetch:async()=>{call++; if(call===1)return {items:[{accountId:'jira-prod',resourceType:'issue',externalId:'F5-D1',eventId:'REC-1',sourceVersion:'1',sourceEffectiveAt:'2026-09-11T00:00:00.000Z',payload:{webhookEvent:'jira:issue_updated',timestamp:'2026-09-11T00:00:00.000Z',issue:{key:'F5-D1',fields:{status:{name:'In Progress'}}}}}],nextCursor:'cursor-1'}; return {items:[]};}},env.now);
  const r=await service.reconcile('F5-B-JIRA'); assert.equal(r.queued,1); assert.equal(r.cursor,'cursor-1');
  const row=env.db.prepare("SELECT reconciliation_cursor,last_reconciliation_status FROM integration_bindings_v2 WHERE id='F5-B-JIRA'").get()!; assert.equal(String(row.reconciliation_cursor),'cursor-1'); assert.equal(String(row.last_reconciliation_status),'ok');
});

test('Phase 6 reconciliation fails closed on unmapped provider object',async()=>{
  const env=env6(); const service=new ProviderReconciliationService(env.runtimeRepo,{'jira-cloud':new JiraCloudWebhookAdapter()},{fetch:async()=>({items:[{accountId:'jira-prod',resourceType:'issue',externalId:'NOPE',eventId:'REC-X',sourceVersion:'1',sourceEffectiveAt:'2026-09-11T00:00:00.000Z',payload:{issue:{key:'NOPE',fields:{status:{name:'In Progress'}}}}}]})},env.now);
  await assert.rejects(()=>service.reconcile('F5-B-JIRA'),/not mapped/i); const row=env.db.prepare("SELECT last_reconciliation_status FROM integration_bindings_v2 WHERE id='F5-B-JIRA'").get()!; assert.equal(String(row.last_reconciliation_status),'failed');
});

test('Phase 6 operational health exposes dead letters and stale reconciliation',()=>{
  const env=env6(); const h=new OperationalHealthService(env.runtimeRepo,()=>new Date('2026-09-12T12:00:00.000Z')).snapshot(); assert.notEqual(h.status,'healthy'); assert.ok(h.staleBindings.includes('F5-B-JIRA'));
});

test('Phase 6 production readiness remains fail-closed and passes only with complete evidence',()=>{
  const gate=new ProductionReadinessGate(); const base={acceptanceIdentityDisabled:true,enterpriseOidcConfigured:true,managedSecretsConfigured:true,durableWorkerConfigured:true,productionDatabase:'managed-postgres' as const,postgresRuntimeAdapterVerified:true,reconciliationConfigured:true,observabilityConfigured:true,backupRestoreVerified:true,releaseSignatureVerified:true,tlsConfigured:true};
  assert.equal(gate.evaluate(base).ready,true); const bad=gate.evaluate({...base,productionDatabase:'sqlite' as const,backupRestoreVerified:false}); assert.equal(bad.ready,false); assert.ok(bad.blockers.length>=2);
});
