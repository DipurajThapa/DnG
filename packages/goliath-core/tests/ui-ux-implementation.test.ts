import assert from 'node:assert/strict';
import test from 'node:test';
import { PHASE5_RUNTIME_HTML, ROLE_EXPERIENCE_PROFILES } from '../src/index.js';

test('lean UI uses role-aware visual control and progressive disclosure', () => {
  assert.match(PHASE5_RUNTIME_HTML,/control-lanes/);
  assert.match(PHASE5_RUNTIME_HTML,/decision-spotlight/);
  assert.match(PHASE5_RUNTIME_HTML,/progressive/);
  assert.match(PHASE5_RUNTIME_HTML,/mobile-shortcuts/);
});

test('navigation removes duplicate paths while preserving full control', () => {
  assert.deepEqual(ROLE_EXPERIENCE_PROFILES['resource-manager'].globalNavigation,['Capacity']);
  assert.equal(ROLE_EXPERIENCE_PROFILES['project-manager'].projectSections.includes('Work'),true);
  assert.equal(ROLE_EXPERIENCE_PROFILES['project-manager'].projectSections.includes('Money'),true);
  assert.equal(ROLE_EXPERIENCE_PROFILES['project-manager'].globalNavigation.includes('My Work'),false);
  assert.equal(ROLE_EXPERIENCE_PROFILES.sponsor.projectSections.includes('Plan'),false);
});

test('mobile work table carries explicit labels and visual management text', () => {
  assert.match(PHASE5_RUNTIME_HTML,/data-label="Status"/);
  assert.match(PHASE5_RUNTIME_HTML,/Evidence confidence/);
  assert.match(PHASE5_RUNTIME_HTML,/Why it matters:/);
});
