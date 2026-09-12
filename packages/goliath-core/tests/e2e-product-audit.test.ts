import test from 'node:test';
import assert from 'node:assert/strict';
import { phase5Fixture } from './phase5-fixture.js';

async function login(base:string,userId:string,password:string){
  const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId,password})});
  assert.equal(r.status,200); return (await r.json()) as any;
}
async function jfetch(base:string,path:string,token:string,init:RequestInit={}){
  const r=await fetch(base+path,{...init,headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...(init.headers??{})}});
  const text=await r.text(); let body:any={}; try{body=text?JSON.parse(text):{};}catch{body={message:text};}
  return {status:r.status,body};
}

test('E2E audit: Program Manager gets aggregate scope and cannot perform routine project assignment',async()=>{
  const env=phase5Fixture(); const runtime=await env.server.listen(0);
  try{
    const {token}=await login(runtime.url,'program1','program-pass');
    const contexts=await jfetch(runtime.url,'/api/contexts',token); const program=contexts.body.contexts.find((x:any)=>x.role==='program-manager');
    assert.ok(program);
    const ws=await jfetch(runtime.url,`/api/workspace?actingAssignmentId=${program.assignmentId}`,token);
    assert.equal(ws.status,200); assert.equal(ws.body.role,'program-manager'); assert.equal(ws.body.selectedProject,undefined); assert.ok(ws.body.projects.length>=3);
    assert.equal(ws.body.capabilities.canManageProject,false); assert.equal(ws.body.capabilities.canAssignProjectWork,false);
    const denied=await jfetch(runtime.url,`/api/projects/${env.projectId}/activities/F5-D1/assign`,token,{method:'POST',body:JSON.stringify({actingAssignmentId:program.assignmentId,assigneeId:'f5-dev'})});
    assert.equal(denied.status,403);
  }finally{await env.server.close();}
});

test('E2E audit: resource demand lifecycle reconciles partial and full allocation in the same canonical record',()=>{
  const env=phase5Fixture();
  env.resourceService.setCapacity(env.rm,{id:'CAP-AUDIT',resourceId:'R-F5',periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,unavailableHours:0});
  env.resourceService.allocate(env.rm,{id:'ALLOC-AUDIT-1',resourceId:'R-F5',projectId:env.projectId,teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:10,status:'confirmed'});
  let demand=env.resourceRepo.listDemandsForProject(env.projectId).find((x)=>x.id==='DEM-F5');
  assert.equal(demand?.state,'partially-filled');
  let view=env.resourceService.getFunctionalCapacity(env.rm,'2026-09-10','2026-09-16');
  assert.equal(view.openDemandHours,14);
  env.resourceService.allocate(env.rm,{id:'ALLOC-AUDIT-2',resourceId:'R-F5',projectId:env.projectId,teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:14,status:'confirmed'});
  demand=env.resourceRepo.listDemandsForProject(env.projectId).find((x)=>x.id==='DEM-F5');
  assert.equal(demand?.state,'filled');
  view=env.resourceService.getFunctionalCapacity(env.rm,'2026-09-10','2026-09-16');
  assert.equal(view.openDemandHours,0);
});

test('E2E audit: completed work hands off to the receiving team and sender-side lead cannot accept it',()=>{
  const env=phase5Fixture();
  env.projectApp.updateActivity({userId:'f5-dev',actingAssignmentId:'F5-DEV'},env.projectId,'F5-D1',{status:'done',percentComplete:100,actualFinish:'2026-09-10'});
  const h=env.projectApp.createHandoff({userId:'f5-dev',actingAssignmentId:'F5-DEV'},env.projectId,{id:'HO-AUDIT',sourceActivityId:'F5-D1',targetActivityId:'F5-Q1',receiverId:'f5-qa',deliverableVersion:'1',state:'ready',requiredChecksPassed:1,requiredChecksTotal:1,blockingConditions:[],nonBlockingConditions:[],attempt:1});
  assert.equal(h.state,'ready');
  assert.throws(()=>env.projectApp.respondToHandoff({userId:'f5-devlead',actingAssignmentId:'F5-DL'},env.projectId,h.id,{state:'accepted'}),/receiving team/i);
  const accepted=env.projectApp.respondToHandoff({userId:'f5-qa',actingAssignmentId:'F5-QA'},env.projectId,h.id,{state:'accepted'});
  assert.equal(accepted.state,'accepted');
});

test('E2E audit: Enterprise Admin can grant and revoke a contextual responsibility through the HTTP boundary',async()=>{
  const env=phase5Fixture(); const runtime=await env.server.listen(0);
  try{
    const {token}=await login(runtime.url,'admin1','admin-pass');
    const grant=await jfetch(runtime.url,'/api/admin/responsibilities/grant',token,{method:'POST',body:JSON.stringify({actingAssignmentId:'ADMIN',assignment:{id:'AUDIT-SP',userId:'audit-user',displayName:'Audit User',role:'sponsor',scopeType:'project',scopeId:env.projectId,permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'}})});
    assert.equal(grant.status,200); assert.equal(env.contextService.listActingContexts('audit-user').length,1);
    const revoke=await jfetch(runtime.url,'/api/admin/responsibilities/AUDIT-SP/revoke',token,{method:'POST',body:JSON.stringify({actingAssignmentId:'ADMIN',reason:'Audit complete'})});
    assert.equal(revoke.status,200); assert.equal(env.contextService.listActingContexts('audit-user').length,0);
  }finally{await env.server.close();}
});

test('E2E audit: role capabilities align frontend behavior with backend authority',()=>{
  const env=phase5Fixture();
  const program=env.experienceService.build({userId:'program1',actingAssignmentId:'PROGRAM'});
  assert.equal(program.capabilities.canManageProject,false); assert.equal(program.capabilities.canAssignProjectWork,false);
  const member=env.experienceService.build({userId:'f5-dev',actingAssignmentId:'F5-DEV'},{projectId:'F5'});
  assert.equal(member.selectedProject?.activities.length,1);
  assert.ok(member.selectedProject?.handoffTargets.some((x)=>x.id==='F5-Q1'),'limited-role handoff target is missing from the governed projection');
  const agile=env.experienceService.build({userId:'agile',actingAssignmentId:'AGILE'},{projectId:'A'});
  assert.equal(agile.capabilities.canCoordinateTeam,true); assert.equal(agile.capabilities.canAssignTeamWork,false);
  const admin=env.experienceService.build({userId:'admin1',actingAssignmentId:'ADMIN'});
  assert.equal(admin.role,'enterprise-admin'); assert.ok(admin.administration);
});

test('E2E audit: rendered UI exposes connected workflows and required completion evidence without raw IDs-only assignment',async()=>{
  const env=phase5Fixture(); const runtime=await env.server.listen(0);
  try{
    const r=await fetch(runtime.url+'/'); const html=await r.text();
    assert.match(html,/Actual finish/); assert.match(html,/Request capacity/); assert.match(html,/Allocate resource/); assert.match(html,/Grant responsibility/); assert.match(html,/Create handoff/);
    assert.match(html,/Select a project member/); assert.doesNotMatch(html,/Assignee user ID/);
    assert.match(html,/if\(role==='resource-manager'\)return \[\{route:'capacity',label:'Capacity'\}\];/);
    assert.match(html,/currentView='attention';ui=\{workSearch:'',workStatus:'all',workPriority:'all'\};document\.getElementById\('project'\)\.innerHTML='';/);
  }finally{await env.server.close();}
});
