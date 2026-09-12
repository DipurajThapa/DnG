import test from 'node:test';
import assert from 'node:assert/strict';
import { phase3Fixture } from './phase3-fixture.js';

function seedResources() {
  const env=phase3Fixture();
  const rm={userId:'rm1',actingAssignmentId:'RM'};
  env.resourceService.createResource(rm,{id:'R1',userId:'dev1',displayName:'Developer',organisationId:'ORG1',orgUnitId:'ENG',active:true,skills:['TypeScript'],weeklyContractHours:40});
  env.resourceService.createResource(rm,{id:'R2',userId:'qa1',displayName:'QA Analyst',organisationId:'ORG1',orgUnitId:'QA',active:true,skills:['QA'],weeklyContractHours:40});
  env.resourceService.setCapacity(rm,{id:'CAP-R1',resourceId:'R1',periodStart:'2026-09-14',periodEnd:'2026-09-20',grossHours:40,unavailableHours:8,sourceRef:'WFM:R1:W38'});
  env.resourceService.setCapacity(rm,{id:'CAP-R2',resourceId:'R2',periodStart:'2026-09-14',periodEnd:'2026-09-20',grossHours:40,unavailableHours:0,sourceRef:'WFM:R2:W38'});
  return env;
}

test('resource manager sees functional hierarchy capacity while PM sees only project-relevant allocation',()=>{
  const env=seedResources();
  const rm={userId:'rm1',actingAssignmentId:'RM'};
  env.resourceService.allocate(rm,{id:'AL-A',resourceId:'R1',projectId:'A',activityId:'A-D1',teamId:'dev',periodStart:'2026-09-14',periodEnd:'2026-09-20',hours:20,status:'confirmed'});
  env.resourceService.allocate(rm,{id:'AL-B',resourceId:'R1',projectId:'B',activityId:'B-D1',teamId:'dev',periodStart:'2026-09-14',periodEnd:'2026-09-20',hours:16,status:'confirmed'});
  const functional=env.resourceService.getFunctionalCapacity(rm,'2026-09-14','2026-09-20');
  const r1=functional.resources.find((r)=>r.resourceId==='R1')!;
  assert.equal(r1.confirmedAllocationHours,36);
  assert.equal(r1.availableHours,0);
  assert.equal(r1.conflict,true);
  assert.deepEqual(r1.projectAllocations.map((x)=>x.projectId).sort(),['A','B']);

  const project=env.resourceService.getProjectCapacity({userId:'alex',actingAssignmentId:'PM-A'},'A','2026-09-14','2026-09-20');
  const pmR1=project.resources.find((r)=>r.resourceId==='R1')!;
  assert.equal(pmR1.confirmedAllocationHours,20);
  assert.equal(pmR1.conflict,true);
  assert.deepEqual(pmR1.projectAllocations,[{projectId:'A',hours:20}]);
});

test('project creates resource demand but cannot directly allocate functional capacity',()=>{
  const env=seedResources();
  const demand=env.resourceService.requestDemand({userId:'alex',actingAssignmentId:'PM-A'},{id:'DMD1',projectId:'A',teamId:'dev',orgUnitId:'ENG',skill:'TypeScript',periodStart:'2026-09-14',periodEnd:'2026-09-20',requiredHours:24});
  assert.equal(demand.state,'open');
  assert.equal(env.resourceRepo.listDemandsForProject('A').length,1);
  assert.throws(()=>env.resourceService.allocate({userId:'alex',actingAssignmentId:'PM-A'},{id:'BAD',resourceId:'R1',projectId:'A',periodStart:'2026-09-14',periodEnd:'2026-09-20',hours:10,status:'confirmed'}),/Organisational unit|resource/i);
});

test('resource allocation changes are traceable in the shared context audit chain',()=>{
  const env=seedResources();
  env.resourceService.allocate({userId:'rm1',actingAssignmentId:'RM'},{id:'AL1',resourceId:'R2',projectId:'A',activityId:'A-Q1',teamId:'qa',periodStart:'2026-09-14',periodEnd:'2026-09-20',hours:32,status:'confirmed',reason:'Test coverage'});
  const events=env.contextRepo.listEvents();
  assert.ok(events.some((e)=>e.eventType==='resource.allocation-recorded' && e.metadata['allocationId']==='AL1'));
  assert.equal(env.contextRepo.verifyEventChain(),true);
});

test('finance facts deduplicate by authoritative source identity and reject conflicting duplicate revisions',()=>{
  const env=phase3Fixture();
  const first=env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'actual',amount:20000,currency:'USD',sourceSystem:'ERP',sourceRef:'TX-1',sourceRevision:'1',occurredAt:'2026-09-09T00:00:00.000Z',classification:'confidential'});
  const same=env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'actual',amount:20000,currency:'USD',sourceSystem:'ERP',sourceRef:'TX-1',sourceRevision:'1',occurredAt:'2026-09-09T00:00:00.000Z',classification:'confidential'});
  assert.equal(first.id,same.id);
  assert.equal(env.financeRepo.listEntries('A').length,1);
  assert.throws(()=>env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'actual',amount:21000,currency:'USD',sourceSystem:'ERP',sourceRef:'TX-1',sourceRevision:'1',occurredAt:'2026-09-09T00:00:00.000Z',classification:'confidential'}),/conflicting content/i);
  const revised=env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'actual',amount:21000,currency:'USD',sourceSystem:'ERP',sourceRef:'TX-1',sourceRevision:'2',occurredAt:'2026-09-10T00:00:00.000Z',classification:'confidential'});
  assert.equal(revised.revision,2);
  assert.equal(env.financeRepo.listEntries('A')[0]?.amount,21000);
});

test('financial visibility is role-specific while calculations use one canonical fact set',()=>{
  const env=phase3Fixture();
  env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'actual',amount:25000,currency:'USD',sourceSystem:'ERP',sourceRef:'ACT-1',sourceRevision:'1',occurredAt:'2026-09-09T00:00:00.000Z',classification:'confidential'});
  env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'commitment',amount:15000,currency:'USD',sourceSystem:'ERP',sourceRef:'PO-1',sourceRevision:'1',occurredAt:'2026-09-09T00:00:00.000Z',classification:'confidential'});
  env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'revenue',amount:130000,currency:'USD',sourceSystem:'ERP',sourceRef:'REV-1',sourceRevision:'1',occurredAt:'2026-09-09T00:00:00.000Z',classification:'restricted'});
  env.financeService.setForecast({userId:'alex',actingAssignmentId:'PM-A'},{projectId:'A',etcAmount:60000,contingencyAmount:5000,currency:'USD',asOf:'2026-09-10T08:00:00.000Z',sourceRefs:['forecast:pm']});

  const sponsor=env.financeService.getProjection({userId:'bob',actingAssignmentId:'SP-A'},'A');
  assert.equal(sponsor.visibility,'summary');
  assert.equal(sponsor.budget,100000);
  assert.equal(sponsor.eac,90000);
  assert.equal(sponsor.actualCost,undefined);
  assert.equal(sponsor.projectedRevenue,undefined);

  const pm=env.financeService.getProjection({userId:'alex',actingAssignmentId:'PM-A'},'A');
  assert.equal(pm.visibility,'project');
  assert.equal(pm.actualCost,25000);
  assert.equal(pm.commitments,15000);
  assert.equal(pm.etc,60000);
  assert.equal(pm.eac,90000);
  assert.equal(pm.projectedRevenue,undefined);

  const director=env.financeService.getProjection({userId:'director1',actingAssignmentId:'DIR'},'A');
  assert.equal(director.visibility,'commercial');
  assert.equal(director.projectedRevenue,130000);
  assert.equal(director.margin,40000);
  assert.throws(()=>env.financeService.getProjection({userId:'pmo1',actingAssignmentId:'PMO'},'A'),/not permitted/i);
});

test('commercial forecast fields cannot be entered by a role without commercial authority',()=>{
  const env=phase3Fixture();
  assert.throws(()=>env.financeService.setForecast({userId:'alex',actingAssignmentId:'PM-A'},{projectId:'A',etcAmount:50000,contingencyAmount:0,projectedRevenue:150000,currency:'USD',asOf:'2026-09-10T08:00:00.000Z',sourceRefs:[]}),/commercial revenue/i);
  const result=env.financeService.setForecast({userId:'director1',actingAssignmentId:'DIR'},{projectId:'A',etcAmount:50000,contingencyAmount:0,projectedRevenue:150000,benefitForecast:200000,currency:'USD',asOf:'2026-09-10T08:00:00.000Z',sourceRefs:['commercial-plan']});
  assert.equal(result.projectedRevenue,150000);
});

test('resource manager can change or release allocation with an attributable reason',()=>{
  const env=seedResources();
  const rm={userId:'rm1',actingAssignmentId:'RM'};
  env.resourceService.allocate(rm,{id:'CHANGE1',resourceId:'R1',projectId:'A',periodStart:'2026-09-14',periodEnd:'2026-09-20',hours:20,status:'confirmed'});
  assert.throws(()=>env.resourceService.changeAllocation(rm,'CHANGE1',{hours:16}),/reason/i);
  const changed=env.resourceService.changeAllocation(rm,'CHANGE1',{hours:16,reason:'Rebalanced to Project B'});
  assert.equal(changed.hours,16);
  const released=env.resourceService.changeAllocation(rm,'CHANGE1',{status:'released',reason:'Project demand ended'});
  assert.equal(released.status,'released');
  assert.ok(env.contextRepo.listEvents().some((e)=>e.eventType==='resource.allocation-changed' && e.metadata['allocationId']==='CHANGE1'));
});

test('functional demand remains visible even when no matching resource currently exists',()=>{
  const env=phase3Fixture();
  env.resourceService.requestDemand({userId:'alex',actingAssignmentId:'PM-A'},{id:'GAP1',projectId:'A',orgUnitId:'QA',skill:'Automation',periodStart:'2026-09-14',periodEnd:'2026-09-20',requiredHours:40});
  const view=env.resourceService.getFunctionalCapacity({userId:'rm1',actingAssignmentId:'RM'},'2026-09-14','2026-09-20');
  assert.equal(view.resources.length,0);
  assert.equal(view.openDemandHours,40);
});

test('EAC automatically recomputes when authoritative actual cost changes after forecast',()=>{
  const env=phase3Fixture();
  env.financeService.setForecast({userId:'alex',actingAssignmentId:'PM-A'},{projectId:'A',etcAmount:50000,contingencyAmount:5000,currency:'USD',asOf:'2026-09-10T08:00:00.000Z',sourceRefs:['forecast']});
  assert.equal(env.projectRepo.getProject('A')?.eac,55000);
  env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'actual',amount:20000,currency:'USD',sourceSystem:'ERP',sourceRef:'AUTO-EAC',sourceRevision:'1',occurredAt:'2026-09-10T09:00:00.000Z',classification:'confidential'});
  assert.equal(env.projectRepo.getProject('A')?.eac,75000);
});

test('finance source identity cannot be silently retargeted to another project',()=>{
  const env=phase3Fixture();
  env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'actual',amount:1000,currency:'USD',sourceSystem:'ERP',sourceRef:'IMMUTABLE-1',sourceRevision:'1',occurredAt:'2026-09-10T00:00:00.000Z',classification:'confidential'});
  assert.throws(()=>env.financeService.ingestAuthoritativeEntry({projectId:'B',entryType:'actual',amount:1000,currency:'USD',sourceSystem:'ERP',sourceRef:'IMMUTABLE-1',sourceRevision:'2',occurredAt:'2026-09-10T01:00:00.000Z',classification:'confidential'}),/retargeted/i);
});

test('missing workforce capacity is explicit rather than interpreted as healthy zero utilization',()=>{
  const env=phase3Fixture();
  const rm={userId:'rm1',actingAssignmentId:'RM'};
  env.resourceService.createResource(rm,{id:'NO-CAP',displayName:'New Engineer',organisationId:'ORG1',orgUnitId:'ENG',active:true,skills:['Java'],weeklyContractHours:40});
  const view=env.resourceService.getFunctionalCapacity(rm,'2026-09-14','2026-09-20');
  const line=view.resources.find((x)=>x.resourceId==='NO-CAP')!;
  assert.equal(line.capacityKnown,false);
  assert.equal(line.utilizationPercent,undefined);
  assert.deepEqual(view.missingCapacityResourceIds,['NO-CAP']);
});

test('correcting an actual-cost source record into a non-cost type also recalculates EAC',()=>{
  const env=phase3Fixture();
  env.financeService.setForecast({userId:'alex',actingAssignmentId:'PM-A'},{projectId:'A',etcAmount:50000,contingencyAmount:0,currency:'USD',asOf:'2026-09-10T08:00:00.000Z',sourceRefs:[]});
  env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'actual',amount:10000,currency:'USD',sourceSystem:'ERP',sourceRef:'RECLASS',sourceRevision:'1',occurredAt:'2026-09-10T00:00:00.000Z',classification:'confidential'});
  assert.equal(env.projectRepo.getProject('A')?.eac,60000);
  env.financeService.ingestAuthoritativeEntry({projectId:'A',entryType:'commitment',amount:10000,currency:'USD',sourceSystem:'ERP',sourceRef:'RECLASS',sourceRevision:'2',occurredAt:'2026-09-10T01:00:00.000Z',classification:'confidential'});
  assert.equal(env.projectRepo.getProject('A')?.eac,50000);
});
