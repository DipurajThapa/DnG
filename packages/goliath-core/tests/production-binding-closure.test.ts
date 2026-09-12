import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  RemoteJwksOidcVerifier, EnvironmentSecretResolver, readProductionBindingConfiguration,
  assertProductionBindingConfiguration, DurableProviderWorkerLoop, GoliathRuntimeHttpServer, HmacSessionService, EnterpriseOidcIdentityProvider,
} from '../src/index.js';
import { phase5Fixture } from './phase5-fixture.js';

function jwtSegment(value:unknown):string{return Buffer.from(JSON.stringify(value),'utf8').toString('base64url');}

test('Production binding OIDC verifier validates RS256 token against HTTPS discovery/JWKS',async()=>{
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk=publicKey.export({format:'jwk'}) as any; jwk.kid='k1';jwk.alg='RS256';jwk.use='sig';
  const now=()=>new Date('2026-09-11T00:00:00.000Z');
  const issuer='https://id.example.com/tenant',audience='goliath-prod';
  const fetcher=async(url:string)=>({ok:true,status:200,json:async()=>url.endsWith('openid-configuration')?{issuer,jwks_uri:'https://id.example.com/keys'}:{keys:[jwk]}});
  const verifier=new RemoteJwksOidcVerifier(issuer,audience,fetcher,now);
  const header=jwtSegment({alg:'RS256',typ:'JWT',kid:'k1'}),payload=jwtSegment({iss:issuer,aud:[audience,'other'],sub:'u1',email:'pm@example.com',email_verified:true,name:'PM User',nbf:Math.floor(now().getTime()/1000)-5,exp:Math.floor(now().getTime()/1000)+3600});
  const signature=sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url');
  const claims=await verifier.verify(`${header}.${payload}.${signature}`);
  assert.equal(claims.subject,'u1');assert.equal(claims.emailVerified,true);assert.equal(claims.audience,audience);
  await assert.rejects(()=>verifier.verify(`${header}.${payload}.bad`),/signature/i);
});

test('Production binding OIDC verifier fails closed on discovery, audience and expiry',async()=>{
  const now=()=>new Date('2026-09-11T00:00:00.000Z');
  assert.throws(()=>new RemoteJwksOidcVerifier('http://insecure','x',async()=>({ok:false,status:500,json:async()=>({})}),now),/HTTPS/i);
  const verifier=new RemoteJwksOidcVerifier('https://id.example','aud',async()=>({ok:false,status:503,json:async()=>({})}),now);
  await assert.rejects(()=>verifier.verify('a.b.c'),/header|discovery|algorithm/i);
});

test('Environment secret resolver keeps secret material outside canonical records and supports rotation key ids',()=>{
  const env:any={GOLIATH_JIRA_SECRET:'secret-v2',GOLIATH_JIRA_SECRET_KEY_ID:'rotation-2'};
  const resolver=new EnvironmentSecretResolver(env);
  assert.deepEqual(resolver.resolve('env:GOLIATH_JIRA_SECRET'),{secret:'secret-v2',keyId:'rotation-2'});
  assert.equal(resolver.resolve('vault://not-configured'),undefined);assert.equal(resolver.resolve('env:bad-name'),undefined);assert.equal(resolver.resolve('env:MISSING'),undefined);
});

test('Production configuration parser/readiness is fail closed and accepts only complete deployment configuration',()=>{
  const good=readProductionBindingConfiguration({GOLIATH_OIDC_ISSUER:'https://login.example/tenant',GOLIATH_OIDC_AUDIENCE:'goliath',GOLIATH_SESSION_SECRET_REF:'env:GOLIATH_SESSION_SECRET',DATABASE_URL:'postgresql://host/db',GOLIATH_PERSISTENCE_DRIVER:'postgres-sync',GOLIATH_WORKER_ENABLED:'true',GOLIATH_OBSERVABILITY_SINK:'stdout-json',GOLIATH_REQUIRE_TLS:'true'});
  assert.doesNotThrow(()=>assertProductionBindingConfiguration(good));
  const bad=readProductionBindingConfiguration({GOLIATH_OIDC_ISSUER:'http://bad',GOLIATH_WORKER_ENABLED:'false',GOLIATH_REQUIRE_TLS:'false'});
  assert.throws(()=>assertProductionBindingConfiguration(bad),/incomplete/i);
});

test('Durable worker loop runs one batch and reports cycle without inventing queue state',async()=>{
  const calls:number[]=[]; const results:any[]=[];
  const loop=new DurableProviderWorkerLoop({drain:async(limit?:number)=>{calls.push(limit??0);return {processed:2,retried:1,deadLettered:0,recovered:1};}},{batchSize:7,onCycle:r=>results.push(r)});
  const result=await loop.runOnce();assert.equal(calls[0],7);assert.equal(result.processed,2);assert.equal(results.length,1);
});


test('Production HTTP runtime can disable acceptance login, exchange verified OIDC identity, and fail readiness closed',async()=>{
  const env=phase5Fixture(); const now=env.now; const sessions=new HmacSessionService('production-http-session-secret-0001',now);
  const enterpriseIdentity=new EnterpriseOidcIdentityProvider({verify:async()=>({issuer:'https://login.example',audience:'goliath',subject:'sub-f5',email:'pm@example.com',emailVerified:true,displayName:'Faye PM',expiresAt:'2026-09-11T01:00:00.000Z'})},{resolve:c=>c.subject==='sub-f5'?{userId:'f5-pm',displayName:'Faye PM'}:undefined},sessions,['https://login.example'],'goliath',now);
  const server=new GoliathRuntimeHttpServer({sessions,enterpriseIdentity,readiness:()=>({ready:false,blockers:['managed database not bound']}),contexts:env.contextService,experiences:env.experienceService,projectApp:env.projectApp,resources:env.resourceService,webhooks:env.webhooks,queue:env.queue,control:env.events as any});
  const runtime=await server.listen();
  try{
    const disabled=await fetch(runtime.url+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:'f5-pm',password:'pm-pass'})});assert.equal(disabled.status,403);
    const oidc=await fetch(runtime.url+'/auth/oidc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'verified-token'})});assert.equal(oidc.status,200);const login=await oidc.json() as any;assert.equal(login.principal.userId,'f5-pm');
    const ready=await fetch(runtime.url+'/ready');assert.equal(ready.status,503);const readiness=await ready.json() as any;assert.equal(readiness.ready,false);
    const live=await fetch(runtime.url+'/live');assert.equal(live.status,200);
  } finally { await server.close(); }
});

test('Durable worker loop stops cleanly after a cycle and reports recoverable runner errors',async()=>{
  let calls=0;const cycles:any[]=[];const errors:any[]=[];let loop!:DurableProviderWorkerLoop;
  loop=new DurableProviderWorkerLoop({drain:async()=>{calls++;if(calls===1)return {processed:1,retried:0,deadLettered:0,recovered:0};throw new Error('temporary worker transport failure');}},{pollIntervalMs:100,batchSize:2,onCycle:r=>{cycles.push(r);if(cycles.length===1)loop.stop();},onError:e=>{errors.push(e);loop.stop();}});
  await loop.run();assert.equal(calls,1);assert.equal(cycles.length,1);
  let failing!:DurableProviderWorkerLoop; failing=new DurableProviderWorkerLoop({drain:async()=>{throw new Error('boom');}},{pollIntervalMs:100,onError:e=>{errors.push(e);failing.stop();}});await failing.run();assert.equal(errors.length,1);
});
