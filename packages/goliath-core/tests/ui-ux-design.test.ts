import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE5_RUNTIME_HTML } from '../src/runtime/ui.js';
import { phase5Fixture } from './phase5-fixture.js';

test('UI review surface is role-aware, business-readable and does not expose raw canonical JSON', () => {
  assert.match(PHASE5_RUNTIME_HTML,/See what matters/);
  assert.match(PHASE5_RUNTIME_HTML,/Acting as/);
  assert.match(PHASE5_RUNTIME_HTML,/Project overview/);
  assert.match(PHASE5_RUNTIME_HTML,/Risks & decisions/);
  assert.match(PHASE5_RUNTIME_HTML,/People & capacity/);
  assert.doesNotMatch(PHASE5_RUNTIME_HTML,/Canonical role projection/);
});

test('PM project projection supplies the governed detail needed by the integrated UI without a UI truth store', () => {
  const env=phase5Fixture();
  const w=env.experienceService.build({userId:'f5-pm',actingAssignmentId:'F5-PM'},{projectId:env.projectId});
  assert.equal(w.role,'project-manager');
  assert.equal(w.selectedProject?.code,'F5');
  assert.ok(Array.isArray(w.selectedProject?.dependencies));
  assert.ok(Array.isArray(w.selectedProject?.decisions));
  assert.ok(Array.isArray(w.selectedProject?.handoffs));
  assert.ok(Array.isArray(w.selectedProject?.sources));
  assert.ok(Array.isArray(w.selectedProject?.workActions));
  assert.equal(w.selectedProject?.sourceHealthSummary!==undefined,true);
});

test('Team Member UI projection remains focused and does not inherit project finance', () => {
  const env=phase5Fixture();
  const w=env.experienceService.build({userId:'f5-dev',actingAssignmentId:'F5-DEV'},{projectId:env.projectId});
  assert.equal(w.role,'team-member');
  assert.equal(w.selectedProject?.finance,undefined);
  assert.ok((w.selectedProject?.activities??[]).every((a)=>a.ownerId==='f5-dev'));
});
