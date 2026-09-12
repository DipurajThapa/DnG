import test from 'node:test';
import assert from 'node:assert/strict';
import { signWebhook } from '../src/index.js';
import { phase5Fixture } from './phase5-fixture.js';

async function login(base:string,userId:string,password:string){const r=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId,password})});assert.equal(r.status,200);return (await r.json()) as any;}
async function api(base:string,path:string,token:string,options:any={}){return fetch(base+path,{...options,headers:{'content-type':'application/json',authorization:'Bearer '+token,...(options.headers??{})}});}

test('Phase 5 runtime serves role-aware authenticated workspaces from the same canonical project', async()=>{
  const env=phase5Fixture(); const runtime=await env.server.listen();
  try{
    const health=await fetch(runtime.url+'/health');assert.equal(health.status,200);assert.equal((await health.json() as any).phase,5);
    const home=await fetch(runtime.url+'/');assert.equal(home.status,200);const html=await home.text();assert.match(html,/Acting as/);assert.match(html,/Acceptance sign-in/);

    const pm=await login(runtime.url,'f5-pm','pm-pass');
    const contexts=await api(runtime.url,'/api/contexts',pm.token);assert.equal(contexts.status,200);const c=await contexts.json() as any;assert.ok(c.contexts.some((x:any)=>x.assignmentId==='F5-PM'));
    const pmRes=await api(runtime.url,'/api/workspace?actingAssignmentId=F5-PM&projectId=F5',pm.token);assert.equal(pmRes.status,200);const pmView=await pmRes.json() as any;
    assert.equal(pmView.role,'project-manager');assert.equal(pmView.selectedProject.fullActivityCount,2);assert.equal(pmView.capabilities.canAssignProjectWork,true);assert.equal(pmView.selectedProject.finance.visibility,'project');

    const sponsor=await login(runtime.url,'f5-sponsor','sponsor-pass');
    const spRes=await api(runtime.url,'/api/workspace?actingAssignmentId=F5-SP&projectId=F5',sponsor.token);assert.equal(spRes.status,200);const sp=await spRes.json() as any;
    assert.equal(sp.role,'sponsor');assert.equal(sp.capabilities.canAssignProjectWork,false);assert.ok(sp.selectedProject.activities.length<pmView.selectedProject.activities.length);
    const denied=await api(runtime.url,'/api/projects/F5/activities/F5-D1/assign',sponsor.token,{method:'POST',body:JSON.stringify({actingAssignmentId:'F5-SP',assigneeId:'f5-dev'})});assert.equal(denied.status,403);

    const lead=await login(runtime.url,'f5-devlead','lead-pass');
    const own=await api(runtime.url,'/api/projects/F5/activities/F5-D1/assign',lead.token,{method:'POST',body:JSON.stringify({actingAssignmentId:'F5-DL',assigneeId:'f5-dev'})});assert.equal(own.status,200);
    const cross=await api(runtime.url,'/api/projects/F5/activities/F5-Q1/assign',lead.token,{method:'POST',body:JSON.stringify({actingAssignmentId:'F5-DL',assigneeId:'f5-qa'})});assert.equal(cross.status,403);

    const member=await login(runtime.url,'f5-dev','member-pass');
    const mRes=await api(runtime.url,'/api/workspace?actingAssignmentId=F5-DEV&projectId=F5',member.token);assert.equal(mRes.status,200);const mv=await mRes.json() as any;assert.ok(mv.selectedProject.activities.every((x:any)=>x.ownerId==='f5-dev'));

    const stolen=await api(runtime.url,'/api/workspace?actingAssignmentId=F5-SP&projectId=F5',pm.token);assert.equal(stolen.status,403);
    const tampered=await api(runtime.url,'/api/contexts',pm.token+'x');assert.equal(tampered.status,403);
  }finally{await env.server.close();}
});

test('Phase 5 webhook endpoint authenticates provider independently and admin drains queue while PM cannot', async()=>{
  const env=phase5Fixture(); const runtime=await env.server.listen();
  try{
    const raw=JSON.stringify({webhookEvent:'jira:issue_updated',timestamp:'2026-09-10T08:05:00.000Z',issue:{id:'1001',key:'F5-D1',fields:{status:{name:'Done'},resolutiondate:'2026-09-10T08:05:00.000Z'}}});
    const signature=signWebhook('jira-secret-for-phase5-runtime',raw);
    const hook=await fetch(runtime.url+'/webhooks/jira-cloud/F5-B-JIRA',{method:'POST',headers:{'content-type':'application/json','x-goliath-signature':signature,'x-goliath-account-id':'jira-prod','x-goliath-event-id':'HTTP-JIRA-1','x-goliath-effective-at':'2026-09-10T08:05:00.000Z'},body:raw});assert.equal(hook.status,202);
    assert.equal(env.projectRepo.getActivity('F5-D1')?.status,'in-progress');

    const pm=await login(runtime.url,'f5-pm','pm-pass');
    const denied=await api(runtime.url,'/internal/queue/drain',pm.token,{method:'POST',body:JSON.stringify({actingAssignmentId:'F5-PM'})});assert.equal(denied.status,403);
    const admin=await login(runtime.url,'admin1','admin-pass');
    const drain=await api(runtime.url,'/internal/queue/drain',admin.token,{method:'POST',body:JSON.stringify({actingAssignmentId:'ADMIN'})});assert.equal(drain.status,200);const result=await drain.json() as any;assert.equal(result.processed,1);
    assert.equal(env.projectRepo.getActivity('F5-D1')?.status,'done');
  }finally{await env.server.close();}
});

test('Phase 5 active session cannot use a responsibility after that responsibility is revoked', async()=>{
  const env=phase5Fixture();const runtime=await env.server.listen();
  try{
    const pm=await login(runtime.url,'f5-pm','pm-pass');
    let r=await api(runtime.url,'/api/workspace?actingAssignmentId=F5-PM&projectId=F5',pm.token);assert.equal(r.status,200);
    env.contextService.revokeResponsibility('F5-PM','admin','Project management responsibility ended.');
    r=await api(runtime.url,'/api/workspace?actingAssignmentId=F5-PM&projectId=F5',pm.token);assert.equal(r.status,403);
    const contexts=await api(runtime.url,'/api/contexts',pm.token);const body=await contexts.json() as any;assert.ok(!body.contexts.some((x:any)=>x.assignmentId==='F5-PM'));
  }finally{await env.server.close();}
});

test('Phase 5 acceptance login fails closed and production identity boundary remains replaceable', async()=>{
  const env=phase5Fixture();const runtime=await env.server.listen();
  try{
    const bad=await fetch(runtime.url+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:'f5-pm',password:'wrong'})});assert.equal(bad.status,403);
    const anonymous=await fetch(runtime.url+'/api/contexts');assert.equal(anonymous.status,403);
  }finally{await env.server.close();}
});

test('Phase 5 HTTP boundary rejects malformed JSON and enforces own-work updates for team members', async()=>{
  const env=phase5Fixture(); const runtime=await env.server.listen();
  try{
    const malformed=await fetch(runtime.url+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:'{"userId":'});
    assert.equal(malformed.status,400);
    const malformedBody=await malformed.json() as any; assert.equal(malformedBody.code,'INVALID_INPUT');

    const member=await login(runtime.url,'f5-dev','member-pass');
    const own=await api(runtime.url,'/api/projects/F5/activities/F5-D1/update',member.token,{method:'POST',body:JSON.stringify({actingAssignmentId:'F5-DEV',update:{percentComplete:55}})});
    assert.equal(own.status,200); const ownBody=await own.json() as any; assert.equal(ownBody.percentComplete,55);

    const other=await api(runtime.url,'/api/projects/F5/activities/F5-Q1/update',member.token,{method:'POST',body:JSON.stringify({actingAssignmentId:'F5-DEV',update:{percentComplete:25}})});
    assert.equal(other.status,403);
  }finally{await env.server.close();}
});
