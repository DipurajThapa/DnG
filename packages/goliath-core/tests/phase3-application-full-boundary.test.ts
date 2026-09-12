import test from 'node:test';
import assert from 'node:assert/strict';
import { phase3Fixture } from './phase3-fixture.js';

test('selected acting context gates plan, setup, source and lifecycle operations before legacy membership can act',()=>{
  const env=phase3Fixture();
  const pm={userId:'alex',actingAssignmentId:'PM-A'};
  const sponsorSameUser={userId:'alex',actingAssignmentId:'SP-A-ALEX'};

  assert.throws(()=>env.projectApp.configureProject(sponsorSameUser,'A',{baselineAccepted:true}),/not permitted|authority|ACCESS/i);
  env.projectApp.configureProject(pm,'A',{baselineVersion:'B1',baselineAccepted:true,materialOutcomesConfirmed:true});
  env.projectApp.registerSource(pm,'A',{id:'SRC-A',projectId:'A',sourceType:'work',sourceRef:'JIRA:A',authority:'execution',status:'current',lastObservedAt:'2026-09-10T08:00:00.000Z',freshnessHours:24,classification:'internal',revision:1});
  env.projectService.refreshDerivedProjectState('A');
  const configured=env.projectRepo.getProject('A')!;
  assert.equal(configured.baselineAccepted,true);
  assert.equal(configured.legitimateEvidenceSourceAvailable,true);
});

test('revoked acting context blocks lifecycle commands even if legacy project-manager membership remains active',()=>{
  const env=phase3Fixture();
  const pm={userId:'alex',actingAssignmentId:'PM-A'};
  env.projectApp.configureProject(pm,'A',{baselineVersion:'B1',baselineAccepted:true,materialOutcomesConfirmed:true});
  env.projectApp.registerSource(pm,'A',{id:'SRC-A',projectId:'A',sourceType:'work',sourceRef:'JIRA:A',authority:'execution',status:'current',lastObservedAt:'2026-09-10T08:00:00.000Z',freshnessHours:24,classification:'internal',revision:1});
  env.projectService.refreshDerivedProjectState('A');
  env.contextService.revokeResponsibility('PM-A','admin','Revoked for boundary test');
  assert.throws(()=>env.projectApp.transitionProject(pm,'A','ready'),/inactive|revoked|not available|ACCESS/i);
  assert.ok(env.projectRepo.getMember('A','alex')?.active,'legacy membership intentionally remains active for this test');
});
