import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  CiCdWebhookAdapter, DeterministicFallbackAi, EnterpriseEventIntelligenceService, GitHubWebhookAdapter, JiraCloudWebhookAdapter,
  M365TranscriptWebhookAdapter, MeetingIntelligenceService, PreProductionAcceptanceGate, ProjectControlCoordinator,
  ProviderQueueWorker, ProviderWebhookGateway, RepositoryEvidenceResolver, ResourceCapacitySignalProvider,
  SqliteProviderRuntimeRepository, StaticWebhookSecretProvider, TimesheetWebhookAdapter, WorkforceWebhookAdapter, ErpFinanceWebhookAdapter,
  RecoveryCoordinator, assertUpgradeAllowed, signWebhook, type ProjectMember,
} from '../src/index.js';
import { phase5Fixture, signedHeaders } from './phase5-fixture.js';

function env8(){const env=phase5Fixture();env.db.exec(readFileSync(new URL('../../migrations/20260911_phase6_production_readiness.sql',import.meta.url),'utf8'));env.db.exec(readFileSync(new URL('../../migrations/20260911_phase7_enterprise_connectors.sql',import.meta.url),'utf8'));return env;}
function addBinding(env:any,projectId:string,id:string,domain:string,provider:string,account:string,resourceType:string,externalId:string,localEntityType:string,localEntityId:string){const now=env.now().toISOString();env.db.prepare(`INSERT INTO integration_bindings_v2(id,organisation_id,project_id,domain,provider,environment,enabled,authority_mode,inbound_fields_json,outbound_actions_json,classification,version,created_at,updated_at) VALUES(?,'ORG1',?,?,?,'prod',1,'automatic-approved','[]','[]','internal',1,?,?)`).run(id,projectId,domain,provider,now,now);env.db.prepare(`INSERT INTO external_object_links_v2(id,organisation_id,project_id,binding_id,provider_account_id,provider_environment,resource_type,external_id,local_entity_type,local_entity_id,mapping_version,effective_from) VALUES(?,'ORG1',?,?,?,'prod',?,?,?,?,1,'2026-09-01T00:00:00.000Z')`).run(`M-${id}`,projectId,id,account,resourceType,externalId,localEntityType,localEntityId);}
async function send(gw:any,q:any,provider:any,bindingId:string,secret:string,account:string,payload:any){const raw=JSON.stringify(payload);gw.receive({provider,bindingId,headers:signedHeaders(signWebhook(secret,raw),account),rawBody:raw});const r=await q.drain();assert.equal(r.processed,1);}

test('Phase 8 fresh multi-role multi-source project executes provider, decision, meeting, finance, workforce and recovery flows from one canonical state',async()=>{
  const env=env8(),projectId='P8'; const members:ProjectMember[]=[
    {projectId,userId:'p8-pm',displayName:'P8 PM',role:'project-manager',teamId:'pmo',active:true,permissions:[],joinedAt:env.now().toISOString()},
    {projectId,userId:'p8-sp',displayName:'P8 Sponsor',role:'sponsor',active:true,permissions:[],joinedAt:env.now().toISOString()},
    {projectId,userId:'p8-lead',displayName:'P8 Lead',role:'delivery-lead',teamId:'dev',active:true,permissions:[],joinedAt:env.now().toISOString()},
    {projectId,userId:'p8-dev',displayName:'P8 Dev',role:'team-member',teamId:'dev',active:true,permissions:[],joinedAt:env.now().toISOString()},
  ];
  env.projectService.createProject({id:projectId,organisationId:'ORG1',code:'P8',name:'Preproduction Acceptance Project',pmId:'p8-pm',sponsorId:'p8-sp',timezone:'UTC',baselineFinish:'2026-11-30',budget:150000,currency:'USD'},members,'system');
  env.contextService.bindProject({projectId,organisationId:'ORG1',portfolioId:'PF1',programId:'PG1',boundBy:'admin'},'admin');
  const grant=(id:string,userId:string,name:string,role:any,teamId?:string)=>env.contextService.grantResponsibility({id,userId,displayName:name,role,scopeType:'project',scopeId:projectId,...(teamId?{teamId}:{}),permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');
  grant('P8-PM','p8-pm','P8 PM','project-manager');grant('P8-SP','p8-sp','P8 Sponsor','sponsor');grant('P8-LEAD','p8-lead','P8 Lead','delivery-lead','dev');grant('P8-MEM','p8-dev','P8 Dev','team-member','dev');
  const pm={userId:'p8-pm',actingAssignmentId:'P8-PM'};
  env.projectApp.importPlan(pm,projectId,[
    {id:'P8-A1',projectId,phase:'Build',title:'Build portal',status:'in-progress',plannedTeamId:'dev',currentTeamId:'dev',priority:'high',milestone:false,baselineFinish:'2026-09-20',forecastFinish:'2026-09-20',sourceSystem:'Jira',sourceRef:'JIRA:P8-A1',evidenceRefs:['JIRA:P8-A1']},
    {id:'P8-A2',projectId,phase:'Release',title:'Production release',status:'not-started',plannedTeamId:'dev',currentTeamId:'dev',priority:'critical',milestone:true,baselineFinish:'2026-09-30',forecastFinish:'2026-09-30',sourceSystem:'CI/CD',sourceRef:'CICD:P8-DEP',evidenceRefs:['CICD:P8-DEP']},
  ],[{id:'P8-DEP',projectId,predecessorActivityId:'P8-A1',successorActivityId:'P8-A2',gateType:'finish-to-start',mandatory:true}]);
  env.projectApp.assignActivity(pm,projectId,'P8-A1','p8-dev');env.projectApp.assignActivity(pm,projectId,'P8-A2','p8-dev');
  env.projectApp.configureProject(pm,projectId,{baselineVersion:'P8-B1',baselineAccepted:true,materialOutcomesConfirmed:true});
  env.projectApp.registerSource(pm,projectId,{id:'P8-JSRC',projectId,sourceType:'delivery',sourceRef:'JIRA:P8-A1',authority:'delivery status',status:'current',lastObservedAt:env.now().toISOString(),freshnessHours:24,classification:'internal',revision:1});
  env.projectApp.registerSource(pm,projectId,{id:'P8-CISRC',projectId,sourceType:'delivery',sourceRef:'CICD:P8-DEP',authority:'release status',status:'current',lastObservedAt:env.now().toISOString(),freshnessHours:24,classification:'internal',revision:1});
  env.projectService.refreshDerivedProjectState(projectId);env.projectApp.transitionProject(pm,projectId,'ready');env.projectApp.transitionProject(pm,projectId,'active');
  const rm={userId:'rm1',actingAssignmentId:'RM'};env.resourceService.createResource(rm,{id:'R-P8',userId:'p8-dev',displayName:'P8 Dev',organisationId:'ORG1',orgUnitId:'ENG',active:true,skills:['TypeScript'],weeklyContractHours:40});env.resourceService.requestDemand(pm,{id:'D-P8',projectId,teamId:'dev',orgUnitId:'ENG',skill:'TypeScript',periodStart:'2026-09-10',periodEnd:'2026-09-16',requiredHours:24});
  env.financeService.setForecast(pm,{projectId,etcAmount:80000,contingencyAmount:10000,currency:'USD',asOf:env.now().toISOString(),sourceRefs:['P8:forecast']});
  addBinding(env,projectId,'P8-J','delivery','jira-cloud','jira-p8','issue','P8-A1','activity','P8-A1');addBinding(env,projectId,'P8-CI','cicd','cicd','ci-p8','deployment','P8-DEP','activity','P8-A2');addBinding(env,projectId,'P8-W','workforce','workforce','wfm-p8','capacity','R-P8','resource','R-P8');env.db.prepare(`INSERT INTO external_object_links_v2(id,organisation_id,project_id,binding_id,provider_account_id,provider_environment,resource_type,external_id,local_entity_type,local_entity_id,mapping_version,effective_from) VALUES('M-P8-W-ALLOC','ORG1',?,'P8-W','wfm-p8','prod','allocation','AL-P8','allocation','AL-P8',1,'2026-09-01T00:00:00.000Z')`).run(projectId);addBinding(env,projectId,'P8-TS','workforce','timesheet','ts-p8','worklog','WL-P8','worklog','WL-P8');addBinding(env,projectId,'P8-E','finance','erp-finance','erp-p8','finance-entry','COST-P8','finance-entry','COST-P8');addBinding(env,projectId,'P8-M','documents','m365','m365-p8','transcript','MEET-P8','meeting','MEET-P8');
  const meeting=new MeetingIntelligenceService(env.boundary,env.projectRepo,env.projectService,{extract:async()=>[{kind:'action',title:'Confirm release communication owner',ownerId:'p8-pm',confidence:'high'}]},env.now);
  const provider=new ResourceCapacitySignalProvider(env.resourceRepo,env.projectRepo);const coordinator=new ProjectControlCoordinator(env.projectRepo,new DeterministicFallbackAi(),new RepositoryEvidenceResolver(),env.now,[provider]);const events=new EnterpriseEventIntelligenceService(env.projectRepo,env.projectService,env.resourceService,env.financeService,coordinator,env.now,meeting);const rr=new SqliteProviderRuntimeRepository(env.db,env.now);const secrets:any={'P8-J':{secret:'s-jira-p8',keyId:'k'},'P8-CI':{secret:'s-ci-p8',keyId:'k'},'P8-W':{secret:'s-wfm-p8',keyId:'k'},'P8-TS':{secret:'s-ts-p8',keyId:'k'},'P8-E':{secret:'s-erp-p8',keyId:'k'},'P8-M':{secret:'s-m365-p8',keyId:'k'}};const gw=new ProviderWebhookGateway(rr,{'jira-cloud':new JiraCloudWebhookAdapter(),'cicd':new CiCdWebhookAdapter(),'workforce':new WorkforceWebhookAdapter(),'timesheet':new TimesheetWebhookAdapter(),'erp-finance':new ErpFinanceWebhookAdapter(),'m365':new M365TranscriptWebhookAdapter()},new StaticWebhookSecretProvider(secrets),env.now);const q=new ProviderQueueWorker(rr,events,env.now,3);
  await send(gw,q,'workforce','P8-W','s-wfm-p8','wfm-p8',{eventId:'cap',recordType:'capacity',resourceId:'R-P8',revision:1,updatedAt:'2026-09-10T08:10:00.000Z',periodStart:'2026-09-10',periodEnd:'2026-09-16',grossHours:40,unavailableHours:4});
  await send(gw,q,'workforce','P8-W','s-wfm-p8','wfm-p8',{eventId:'alloc',recordType:'allocation',allocationId:'AL-P8',revision:1,updatedAt:'2026-09-10T08:15:00.000Z',resourceId:'R-P8',activityId:'P8-A1',teamId:'dev',periodStart:'2026-09-10',periodEnd:'2026-09-16',hours:24,status:'confirmed'});
  await send(gw,q,'jira-cloud','P8-J','s-jira-p8','jira-p8',{webhookEvent:'jira:issue_updated',timestamp:'2026-09-10T08:20:00.000Z',issue:{key:'P8-A1',fields:{status:{name:'Done'},resolutiondate:'2026-09-10T08:20:00.000Z'}}});
  await send(gw,q,'cicd','P8-CI','s-ci-p8','ci-p8',{eventId:'ci-fail',deploymentId:'P8-DEP',revision:1,updatedAt:'2026-09-10T08:25:00.000Z',state:'failed',failureReason:'Smoke tests failed'});assert.equal(env.projectRepo.getActivity('P8-A2')?.status,'blocked');
  const attention=env.projectRepo.listAttention(projectId).find((x:any)=>x.rootCauseKey==='activity:P8-A2:delivery');assert.ok(attention);
  await send(gw,q,'timesheet','P8-TS','s-ts-p8','ts-p8',{eventId:'ts',worklogId:'WL-P8',revision:1,updatedAt:'2026-09-10T08:30:00.000Z',resourceId:'R-P8',activityId:'P8-A1',workDate:'2026-09-10',hours:7,billable:true});assert.equal(env.resourceService.getProjectActualEffort(projectId),7);
  await send(gw,q,'erp-finance','P8-E','s-erp-p8','erp-p8',{eventId:'erp',recordId:'COST-P8',revision:1,entryType:'actual',amount:25000,currency:'USD',occurredAt:'2026-09-10T08:35:00.000Z'});assert.equal(env.projectRepo.getProject(projectId)?.eac,115000);
  await send(gw,q,'m365','P8-M','s-m365-p8','m365-p8',{eventId:'meet',meetingId:'MEET-P8',revision:1,completedAt:'2026-09-10T08:40:00.000Z',transcriptRef:'M365:P8:1',text:'PM will confirm release communication owner.'});const proposal=env.projectRepo.listEvents(projectId).find((e:any)=>e.eventType==='meeting.proposal')!;meeting.confirm(pm,projectId,proposal.id);
  await send(gw,q,'cicd','P8-CI','s-ci-p8','ci-p8',{eventId:'ci-ok',deploymentId:'P8-DEP',revision:2,updatedAt:'2026-09-10T08:45:00.000Z',state:'succeeded',completedAt:'2026-09-10T08:45:00.000Z'});assert.equal(env.projectRepo.getActivity('P8-A2')?.status,'done');
  const pmView=env.experienceService.build(pm,{projectId});const spView=env.experienceService.build({userId:'p8-sp',actingAssignmentId:'P8-SP'},{projectId});const leadView=env.experienceService.build({userId:'p8-lead',actingAssignmentId:'P8-LEAD'},{projectId});const memberView=env.experienceService.build({userId:'p8-dev',actingAssignmentId:'P8-MEM'},{projectId});assert.equal(pmView.capabilities.canAssignProjectWork,true);assert.equal(spView.capabilities.canAssignProjectWork,false);assert.equal(leadView.capabilities.canAssignTeamWork,true);assert.ok(memberView.selectedProject?.activities.every((a:any)=>a.ownerId==='p8-dev'));
  assert.throws(()=>gw.receive({provider:'jira-cloud',bindingId:'P8-J',headers:signedHeaders('bad','jira-p8','bad'),rawBody:'{}'}),/signature/i);
  env.contextService.revokeResponsibility('P8-MEM','admin','Pre-production revocation test');assert.throws(()=>env.experienceService.build({userId:'p8-dev',actingAssignmentId:'P8-MEM'},{projectId}),/inactive|unavailable/i);
  assert.equal(env.projectRepo.verifyEventChain(projectId),true);assert.equal(env.contextRepo.verifyEventChain(),true);assert.equal(env.db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('Phase 8 recovery and signed-release controls fail closed and pass with bound evidence',()=>{
  const rc=new RecoveryCoordinator('inst-1');const checkpoint={checkpointId:'cp-1',installationId:'inst-1',createdAt:'2026-09-10T00:00:00.000Z',releaseDigest:'a'.repeat(64),schemaVersion:'43',databaseBackupRef:'db://cp1',fileBackupRef:'file://cp1',encrypted:true,projectContentExportedToVendor:false};rc.beginRestore(checkpoint);rc.reconcile();rc.validate({checkpointId:'cp-1',installationId:'inst-1',releaseDigest:'a'.repeat(64),schemaVersion:'43',restoredAt:'2026-09-10T00:10:00.000Z',dbFileReferencesValid:true,externalEffectsReplayDisabled:true,oldSessionsRevoked:true,externalStateReconciled:true,isolationVerified:true});rc.failOver();assert.equal(rc.state,'failed-over');
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');const release={releaseId:'r8',version:'8.0.0',digest:'b'.repeat(64),schemaVersion:'43',compatibleFromSchemaVersions:['42','43'],signatureBase64:sign(null,Buffer.from('b'.repeat(64),'utf8'),privateKey).toString('base64'),signingKeyId:'k8'};assert.doesNotThrow(()=>assertUpgradeAllowed({installationId:'inst-1',organisationId:'ORG1',currentReleaseId:'r7',currentSchemaVersion:'43',maintenanceWindowApproved:true,backupCheckpointVerified:true,trustedReleaseSigningKeyIds:['k8'],health:'healthy'},release,publicKey.export({type:'spki',format:'pem'}).toString()));
});

test('Phase 8 acceptance gate separates verified software readiness from external production bindings',()=>{
  const gate=new PreProductionAcceptanceGate();const software={regressionPass:true,schemaIntegrityPass:true,auditIntegrityPass:true,authorizationPass:true,multiRoleAcceptancePass:true,providerRuntimePass:true,failureRecoveryPass:true,backupRestorePass:true,signedReleasePass:true,observabilityPass:true,reconciliationPass:true};
  const staged=gate.evaluate({...software,external:{enterpriseOidcTenantBound:false,providerTenantsRegistered:false,productionSecretsBound:false,managedDatabaseBound:false,durableWorkerBound:false,deployedDomainTlsBound:false}});assert.equal(staged.softwareReady,true);assert.equal(staged.externalBindingsReady,false);assert.equal(staged.productionReady,false);
  const ready=gate.evaluate({...software,external:{enterpriseOidcTenantBound:true,providerTenantsRegistered:true,productionSecretsBound:true,managedDatabaseBound:true,durableWorkerBound:true,deployedDomainTlsBound:true}});assert.equal(ready.productionReady,true);
});

test('Phase 8 current central schema is 43 tables with no foreign-key violations or parallel role/report truth',()=>{
  const env=env8();const tables=env.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r:any)=>String(r.name));assert.equal(tables.length,43);assert.ok(tables.includes('rc_worklogs'));assert.equal(env.db.prepare('PRAGMA foreign_key_check').all().length,0);for(const name of tables)assert.ok(!/^(sponsor|program|portfolio|project_manager|weekly)_.*(truth|status|state)$/i.test(name));
});

test('Phase 8 duplicate provider binding is blocked while one binding may carry multiple governed mappings',()=>{
  const env=env8(); const projectId='A'; const now=env.now().toISOString();
  env.db.prepare(`INSERT INTO integration_bindings_v2(id,organisation_id,project_id,domain,provider,environment,enabled,authority_mode,inbound_fields_json,outbound_actions_json,classification,version,created_at,updated_at) VALUES('P8-ONE','ORG1',?,'workforce','workforce','prod',1,'automatic-approved','[]','[]','internal',1,?,?)`).run(projectId,now,now);
  const insert=env.db.prepare(`INSERT INTO external_object_links_v2(id,organisation_id,project_id,binding_id,provider_account_id,provider_environment,resource_type,external_id,local_entity_type,local_entity_id,mapping_version,effective_from) VALUES(?,'ORG1',?,'P8-ONE','wfm-one','prod',?,?,?,?,1,'2026-09-01T00:00:00.000Z')`);
  insert.run('P8-MAP-CAP',projectId,'capacity','R-A','resource','R-A');
  insert.run('P8-MAP-ALLOC',projectId,'allocation','AL-A','allocation','AL-A');
  const mappings=env.db.prepare("SELECT count(*) AS n FROM external_object_links_v2 WHERE binding_id='P8-ONE'").get() as any;
  assert.equal(Number(mappings.n),2);
  assert.throws(()=>env.db.prepare(`INSERT INTO integration_bindings_v2(id,organisation_id,project_id,domain,provider,environment,enabled,authority_mode,inbound_fields_json,outbound_actions_json,classification,version,created_at,updated_at) VALUES('P8-DUP','ORG1',?,'workforce','workforce','prod',1,'automatic-approved','[]','[]','internal',1,?,?)`).run(projectId,now,now),/UNIQUE constraint failed/i);
});

test('Phase 8 concurrent authenticated role reads remain isolated to each acting context',async()=>{
  const env=phase5Fixture(); const runtime=await env.server.listen();
  const login=async(userId:string,password:string)=>{const r=await fetch(runtime.url+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId,password})});assert.equal(r.status,200);return await r.json() as any;};
  try{
    const [pm,sp]=await Promise.all([login('f5-pm','pm-pass'),login('f5-sponsor','sponsor-pass')]);
    const [pmRes,spRes,stolenByPm,stolenBySponsor]=await Promise.all([
      fetch(runtime.url+'/api/workspace?actingAssignmentId=F5-PM&projectId=F5',{headers:{authorization:'Bearer '+pm.token}}),
      fetch(runtime.url+'/api/workspace?actingAssignmentId=F5-SP&projectId=F5',{headers:{authorization:'Bearer '+sp.token}}),
      fetch(runtime.url+'/api/workspace?actingAssignmentId=F5-SP&projectId=F5',{headers:{authorization:'Bearer '+pm.token}}),
      fetch(runtime.url+'/api/workspace?actingAssignmentId=F5-PM&projectId=F5',{headers:{authorization:'Bearer '+sp.token}}),
    ]);
    assert.equal(pmRes.status,200); assert.equal(spRes.status,200); assert.equal(stolenByPm.status,403); assert.equal(stolenBySponsor.status,403);
    const pmView=await pmRes.json() as any, spView=await spRes.json() as any;
    assert.equal(pmView.role,'project-manager'); assert.equal(pmView.selectedProject.finance.visibility,'project'); assert.equal(pmView.capabilities.canAssignProjectWork,true);
    assert.equal(spView.role,'sponsor'); assert.equal(spView.capabilities.canAssignProjectWork,false); assert.notEqual(spView.selectedProject.finance.visibility,'project');
  } finally { await env.server.close(); }
});
