import test from 'node:test';
import assert from 'node:assert/strict';
import { phase3Fixture } from './phase3-fixture.js';

test('application boundary requires an explicit acting context and blocks legacy-membership privilege leakage',()=>{
  const {projectApp}=phase3Fixture();
  assert.throws(()=>projectApp.getActivities({userId:'alex',actingAssignmentId:''},'A'),/acting responsibility context/i);
  assert.throws(()=>projectApp.assignActivity({userId:'alex',actingAssignmentId:'SP-A-ALEX'},'A','A-D2','dev1'),/not permitted/i);
  const assignment=projectApp.assignActivity({userId:'alex',actingAssignmentId:'PM-A'},'A','A-D2','dev1');
  assert.equal(assignment.assigneeId,'dev1');
});

test('revoking the selected context blocks API actions even while old project membership remains active',()=>{
  const {projectApp,contextService,projectRepo}=phase3Fixture();
  assert.equal(projectRepo.getMember('A','alex')?.active,true);
  contextService.revokeResponsibility('PM-A','admin','PM role moved');
  assert.throws(()=>projectApp.assignActivity({userId:'alex',actingAssignmentId:'PM-A'},'A','A-D2','dev1'),/inactive|unavailable/i);
});

test('team lead application access is team-scoped and team member updates are ownership-scoped',()=>{
  const {projectApp}=phase3Fixture();
  const teamActivities=projectApp.getActivities({userId:'devlead',actingAssignmentId:'LEAD'},'A');
  assert.equal(teamActivities.length,2);
  assert.ok(teamActivities.every((a)=>(a.currentTeamId??a.plannedTeamId)==='dev'));
  assert.throws(()=>projectApp.assignActivity({userId:'devlead',actingAssignmentId:'LEAD'},'A','A-Q1','qa1'),/selected team context/i);
  const updated=projectApp.updateActivity({userId:'dev1',actingAssignmentId:'MEMBER'},'A','A-D1',{percentComplete:65});
  assert.equal(updated.percentComplete,65);
  assert.throws(()=>projectApp.updateActivity({userId:'dev1',actingAssignmentId:'MEMBER'},'A','A-Q1',{percentComplete:10}),/own work/i);
});

test('sponsor context gets decision authority but not routine work mutation',()=>{
  const {projectApp}=phase3Fixture();
  assert.throws(()=>projectApp.updateActivity({userId:'bob',actingAssignmentId:'SP-A'},'A','A-Q1',{status:'in-progress'}),/not permitted/i);
});

test('project director can assign through context while program manager remains cross-project coordination only',()=>{
  const env=phase3Fixture();
  assert.equal(env.projectRepo.getMember('A','director1'),undefined);
  const byDirector=env.projectApp.assignActivity({userId:'director1',actingAssignmentId:'DIR'},'A','A-D2','dev1');
  assert.equal(byDirector.assignedBy,'director1');
  assert.equal(env.projectRepo.getMember('B','program1')?.role,'program-manager');
  assert.throws(()=>env.projectApp.assignActivity({userId:'program1',actingAssignmentId:'PROGRAM'},'B','B-D2','dev1'),/not permitted/i);
});
