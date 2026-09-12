import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTraceabilitySnapshot, signWebhook } from '../src/index.js';
import { phase5Fixture } from './phase5-fixture.js';

async function login(base:string,userId:string,password:string){const r=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId,password})});assert.equal(r.status,200);return (await r.json() as any).token as string;}
async function api(base:string,path:string,token:string,options:any={}){return fetch(base+path,{...options,headers:{'content-type':'application/json',authorization:'Bearer '+token,...(options.headers??{})}});}
async function hook(base:string,path:string,secret:string,account:string,raw:string,extra:Record<string,string>={}){return fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-goliath-signature':signWebhook(secret,raw),'x-goliath-account-id':account,...extra},body:raw});}

test('Phase 5 fresh runtime project completes provider-to-role-action-to-traceability workflow over HTTP',async()=>{
  const env=phase5Fixture(); const rt=await env.server.listen();
  try{
    const admin=await login(rt.url,'admin1','admin-pass');
    const rm=await login(rt.url,'rm1','rm-pass');
    const sponsor=await login(rt.url,'f5-sponsor','sponsor-pass');
    const pm=await login(rt.url,'f5-pm','pm-pass');

    const cap=JSON.stringify({eventId:'HTTP-CAP-1',recordType:'capacity',resourceId:'R-F5',revision:1,updatedAt:'2026-09-10T08:10:00.000Z',periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,unavailableHours:4});
    assert.equal((await hook(rt.url,'/webhooks/workforce/F5-B-WFM','wfm-secret-for-phase5-runtime','wfm-prod',cap)).status,202);
    let d=await api(rt.url,'/internal/queue/drain',admin,{method:'POST',body:JSON.stringify({actingAssignmentId:'ADMIN'})});assert.equal(d.status,200);
    let shortage=env.projectRepo.listAttention('F5').find((x)=>x.rootCauseKey==='resource-demand:DEM-F5');assert.equal(shortage?.state,'open');

    const allocation={id:'RM-ALLOC-F5',projectId:'F5',resourceId:'R-F5',activityId:'F5-D1',teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:24,status:'confirmed'};
    const alloc=await api(rt.url,'/api/resources/allocations',rm,{method:'POST',body:JSON.stringify({actingAssignmentId:'RM',allocation})});assert.equal(alloc.status,200);
    shortage=env.projectRepo.listAttention('F5').find((x)=>x.rootCauseKey==='resource-demand:DEM-F5');assert.equal(shortage?.state,'resolved');

    const jira=JSON.stringify({webhookEvent:'jira:issue_updated',timestamp:'2026-09-10T08:20:00.000Z',issue:{id:'1001',key:'F5-D1',fields:{status:{name:'Done'},resolutiondate:'2026-09-10T08:20:00.000Z'}}});
    assert.equal((await hook(rt.url,'/webhooks/jira-cloud/F5-B-JIRA','jira-secret-for-phase5-runtime','jira-prod',jira,{'x-goliath-event-id':'HTTP-JIRA-DONE','x-goliath-effective-at':'2026-09-10T08:20:00.000Z'})).status,202);
    const qa=JSON.stringify({eventId:'HTTP-QA-SLIP',activityKey:'F5-Q1',revision:2,updatedAt:'2026-09-10T08:30:00.000Z',status:'In Progress',forecastFinish:'2026-10-15',blocker:'Acceptance defects'});
    assert.equal((await hook(rt.url,'/webhooks/qa-system/F5-B-QA','qa-secret-for-phase5-runtime-01','qa-prod',qa)).status,202);
    const fin=JSON.stringify({eventId:'HTTP-ERP-1',recordId:'ACT-1',revision:1,entryType:'actual',amount:15000,currency:'USD',occurredAt:'2026-09-10T08:25:00.000Z',classification:'confidential'});
    assert.equal((await hook(rt.url,'/webhooks/erp-finance/F5-B-ERP','erp-secret-for-phase5-runtime','erp-prod',fin)).status,202);
    d=await api(rt.url,'/internal/queue/drain',admin,{method:'POST',body:JSON.stringify({actingAssignmentId:'ADMIN',limit:10})});assert.equal(d.status,200);const dr=await d.json() as any;assert.equal(dr.processed,3);
    assert.equal(env.projectRepo.getActivity('F5-D1')?.status,'done');assert.equal(env.projectRepo.getProject('F5')?.eac,90000);

    const item=env.projectRepo.listAttention('F5').find((x)=>x.rootCauseKey==='activity:F5-Q1:delivery');assert.ok(item);assert.equal(item?.state,'open');
    const decision=env.projectRepo.getDecisionByAttention('F5',item!.id);assert.ok(decision);assert.equal(decision?.decisionOwnerId,'f5-sponsor');
    const decisionRes=await api(rt.url,`/api/projects/F5/decisions/${decision!.id}/decide`,sponsor,{method:'POST',body:JSON.stringify({actingAssignmentId:'F5-SP',choice:'Add recovery test cycle',state:'approved',reason:'Protect acceptance and launch.'})});assert.equal(decisionRes.status,200);
    assert.equal(env.projectRepo.listDecisions('F5').find((x)=>x.id===decision!.id)?.state,'approved');
    assert.equal(env.projectRepo.listWorkActions('F5').filter((x)=>x.attentionItemId===item!.id).length,1);

    const pmView=await api(rt.url,'/api/workspace?actingAssignmentId=F5-PM&projectId=F5',pm);assert.equal(pmView.status,200);const p=await pmView.json() as any;assert.equal(p.selectedProject.fullActivityCount,2);assert.equal(p.selectedProject.finance.eac,90000);
    const spView=await api(rt.url,'/api/workspace?actingAssignmentId=F5-SP&projectId=F5',sponsor);const s=await spView.json() as any;assert.equal(s.role,'sponsor');assert.ok(s.selectedProject.activities.every((a:any)=>a.milestone||a.priority==='critical'||a.status==='blocked'));

    const trace=calculateTraceabilitySnapshot(env.projectRepo,'F5');assert.equal(trace.ownershipCoverage.percent,100);assert.equal(trace.assignmentConsistency.percent,100);assert.equal(trace.dependencyIntegrity.percent,100);assert.equal(trace.sourceLineageCoverage.percent,100);assert.equal(trace.auditChainIntegrity,true);assert.deepEqual(trace.orphanRecords,[]);
    assert.equal(env.contextRepo.verifyEventChain(),true);assert.equal(env.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{await env.server.close();}
});
