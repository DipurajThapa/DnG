import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE5_RUNTIME_HTML } from '../src/runtime/ui.js';
import { phase3Fixture } from './phase3-fixture.js';

test('enterprise admin receives the complete organisation user directory, including roster-only users',()=>{
  const env=phase3Fixture();
  const workspace=env.experienceService.build({userId:'admin1',actingAssignmentId:'ADMIN'});
  assert.equal(workspace.role,'enterprise-admin');
  assert.ok(workspace.administration);
  const users=workspace.administration!.users;
  assert.equal(users.length,12);
  const qa=users.find((u)=>u.userId==='qa1');
  assert.ok(qa);
  assert.equal(qa!.displayName,'QA Analyst');
  assert.equal(qa!.active,true);
  assert.deepEqual(qa!.responsibilities,[]);
  assert.deepEqual(qa!.projectIds,['A','B']);
  const alex=users.find((u)=>u.userId==='alex');
  assert.ok(alex);
  assert.ok(alex!.responsibilities.some((r)=>r.role==='project-manager'&&r.active));
  assert.ok(alex!.responsibilities.some((r)=>r.role==='sponsor'&&r.active));
  assert.equal(workspace.administration!.responsibilityContexts,12);
});

test('non-admin roles cannot retrieve the organisation user directory',()=>{
  const env=phase3Fixture();
  assert.throws(()=>env.contextService.listUserDirectory('alex','PM-A'),/Enterprise administrator context is required/);
});

test('runtime UI exposes project team and admin user directory and all supported responsibility roles',()=>{
  const html=PHASE5_RUNTIME_HTML;
  assert.match(html,/Project team/);
  assert.match(html,/User directory/);
  assert.match(html,/Complete GOLIATH-known user list/);
  for(const role of ['sponsor','portfolio-manager','program-manager','project-director','project-manager','pmo','resource-manager','delivery-lead','agile-delivery-lead','team-member','enterprise-admin']) {
    assert.match(html,new RegExp(`<option>${role}<\\/option>`));
  }
});
