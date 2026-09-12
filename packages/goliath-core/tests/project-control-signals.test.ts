import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  ProjectControlService,
  SqliteProjectRepository,
  detectProjectSignals,
  type ProjectMember,
  type SourceStateRecord,
} from '../src/index.js';

function repoAndService(now = new Date('2026-09-20T08:00:00.000Z')): { repo: SqliteProjectRepository; service: ProjectControlService } {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../migrations/20260910_ai_first_simplification.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../migrations/20260910_role_scoped_project_control.sql', import.meta.url), 'utf8'));
  const repo = new SqliteProjectRepository(db);
  return { repo, service: new ProjectControlService(repo, () => now) };
}

function seed(service: ProjectControlService, projectId: string, options: { budget?: number; sponsor?: boolean } = {}): void {
  const members: ProjectMember[] = [
    { projectId, userId: 'pm', displayName: 'PM', role: 'project-manager', teamId: 'pmo', active: true, permissions: [], joinedAt: '2026-09-01T08:00:00.000Z' },
    { projectId, userId: 'devlead', displayName: 'Dev Lead', role: 'delivery-lead', teamId: 'dev', active: true, permissions: [], joinedAt: '2026-09-01T08:00:00.000Z' },
    { projectId, userId: 'dev1', displayName: 'Dev 1', role: 'team-member', teamId: 'dev', active: true, permissions: [], joinedAt: '2026-09-01T08:00:00.000Z' },
  ];
  if (options.sponsor) members.push({ projectId, userId: 'sponsor', displayName: 'Sponsor', role: 'sponsor', active: true, permissions: [], joinedAt: '2026-09-01T08:00:00.000Z' });
  service.createProject({ id: projectId, organisationId: 'ORG', code: projectId, name: `Project ${projectId}`, pmId: 'pm', ...(options.sponsor ? { sponsorId: 'sponsor' } : {}), timezone: 'UTC', ...(options.budget !== undefined ? { budget: options.budget, currency: 'USD' } : {}) }, members, 'system');
}

function source(projectId: string, status: SourceStateRecord['status'], authority = 'schedule'): SourceStateRecord {
  return { id: `SRC-${projectId}-${authority}`, projectId, sourceType: authority === 'finance' ? 'ERP Finance' : 'Jira', sourceRef: `ref://${projectId}/${authority}`,
    authority, status, lastObservedAt: '2026-09-20T07:00:00.000Z', freshnessHours: 24, classification: 'internal', revision: 1 };
}

test('detector surfaces unowned executable work as a high-priority assignment need', () => {
  const { repo, service } = repoAndService();
  seed(service, 'SIG-OWNER');
  service.importPlan('SIG-OWNER', 'pm', [{ id: 'A1', projectId: 'SIG-OWNER', phase: 'Build', title: 'Unowned work', status: 'not-started', plannedTeamId: 'dev', priority: 'high', milestone: false }], []);
  const signals = detectProjectSignals(repo, 'SIG-OWNER', new Date('2026-09-20T08:00:00Z'));
  const signal = signals.find((x) => x.rootCauseKey === 'activity:A1:ownership');
  assert.ok(signal);
  assert.equal(signal!.suggestedAction, 'assign');
  assert.equal(signal!.decisionOwnerId, 'pm');
  assert.equal(signal!.consequence, 'high');
});

test('detector groups blocker, schedule slip and overdue state under one activity root cause', () => {
  const { repo, service } = repoAndService();
  seed(service, 'SIG-SLIP');
  service.importPlan('SIG-SLIP', 'pm', [{ id: 'A1', projectId: 'SIG-SLIP', phase: 'Test', title: 'System test', status: 'blocked', baselineFinish: '2026-09-10', forecastFinish: '2026-09-28', plannedTeamId: 'dev', ownerId: 'dev1', priority: 'critical', milestone: true, blocker: 'Environment unavailable', evidenceRefs: ['qa://A1'] }], []);
  const signals = detectProjectSignals(repo, 'SIG-SLIP', new Date('2026-09-20T08:00:00Z'));
  const related = signals.filter((x) => x.rootCauseKey === 'activity:A1:delivery');
  assert.ok(related.length >= 3);
  assert.equal(related.some((x) => x.kind === 'issue'), true);
  assert.equal(related.some((x) => x.kind === 'schedule' && x.title.includes('forecast moved')), true);
  assert.equal(related.some((x) => x.kind === 'schedule' && x.title.includes('overdue')), true);
});

test('critical milestone slip routes decision to named sponsor rather than silently to PM', () => {
  const { repo, service } = repoAndService();
  seed(service, 'SIG-SPONSOR', { sponsor: true });
  service.importPlan('SIG-SPONSOR', 'pm', [{ id: 'M1', projectId: 'SIG-SPONSOR', phase: 'Release', title: 'Go-live', status: 'in-progress', baselineFinish: '2026-09-30', forecastFinish: '2026-10-15', plannedTeamId: 'dev', ownerId: 'dev1', priority: 'critical', milestone: true, evidenceRefs: ['ci://M1'] }], []);
  const slip = detectProjectSignals(repo, 'SIG-SPONSOR', new Date('2026-09-20T08:00:00Z')).find((x) => x.signalId.startsWith('slip:'));
  assert.ok(slip);
  assert.equal(slip!.consequence, 'critical');
  assert.equal(slip!.decisionOwnerId, 'sponsor');
  assert.equal(slip!.suggestedAction, 'decide');
});

test('mandatory dependency violation is explicit when successor starts before predecessor gate', () => {
  const { repo, service } = repoAndService();
  seed(service, 'SIG-DEP');
  service.importPlan('SIG-DEP', 'pm', [
    { id: 'A1', projectId: 'SIG-DEP', phase: 'Build', title: 'Build', status: 'in-progress', baselineFinish: '2026-09-25', plannedTeamId: 'dev', ownerId: 'dev1', priority: 'medium', milestone: false },
    { id: 'A2', projectId: 'SIG-DEP', phase: 'Test', title: 'Test', status: 'in-progress', baselineStart: '2026-09-20', baselineFinish: '2026-09-30', plannedTeamId: 'dev', ownerId: 'dev1', priority: 'high', milestone: false },
  ], [{ id: 'D1', projectId: 'SIG-DEP', predecessorActivityId: 'A1', successorActivityId: 'A2', gateType: 'finish-to-start', mandatory: true }]);
  const dep = detectProjectSignals(repo, 'SIG-DEP', new Date('2026-09-20T08:00:00Z')).find((x) => x.signalId.startsWith('dependency:'));
  assert.ok(dep);
  assert.equal(dep!.suggestedAction, 'correct');
  assert.match(dep!.impact, /started before a mandatory gate/i);
});

test('accepted-deliverable dependency remains gated until a matching handoff is accepted', () => {
  const { repo, service } = repoAndService();
  seed(service, 'SIG-HANDOFF');
  service.importPlan('SIG-HANDOFF', 'pm', [
    { id: 'A1', projectId: 'SIG-HANDOFF', phase: 'Build', title: 'Build', status: 'done', actualFinish: '2026-09-18', baselineFinish: '2026-09-18', plannedTeamId: 'dev', ownerId: 'dev1', priority: 'medium', milestone: false },
    { id: 'A2', projectId: 'SIG-HANDOFF', phase: 'Test', title: 'Test', status: 'not-started', baselineStart: '2026-09-20', baselineFinish: '2026-09-30', plannedTeamId: 'dev', ownerId: 'dev1', priority: 'high', milestone: false },
  ], [{ id: 'D1', projectId: 'SIG-HANDOFF', predecessorActivityId: 'A1', successorActivityId: 'A2', gateType: 'accepted-deliverable', mandatory: true }]);
  const before = detectProjectSignals(repo, 'SIG-HANDOFF', new Date('2026-09-20T08:00:00Z'));
  assert.equal(before.some((x) => x.signalId.startsWith('dependency:')), true);
});

test('ready handoff creates a targeted receiving-team acceptance signal', () => {
  const { repo, service } = repoAndService();
  seed(service, 'SIG-HREADY');
  service.importPlan('SIG-HREADY', 'pm', [
    { id: 'A1', projectId: 'SIG-HREADY', phase: 'Build', title: 'Build', status: 'done', actualFinish: '2026-09-18', plannedTeamId: 'dev', ownerId: 'dev1', priority: 'medium', milestone: false },
    { id: 'A2', projectId: 'SIG-HREADY', phase: 'Test', title: 'Test', status: 'not-started', plannedTeamId: 'dev', ownerId: 'dev1', priority: 'high', milestone: false },
  ], []);
  const handoff = service.createHandoff('SIG-HREADY', 'dev1', { id: 'H1', projectId: 'SIG-HREADY', sourceActivityId: 'A1', targetActivityId: 'A2', senderId: 'dev1', receiverId: 'dev1', deliverableVersion: 'build-1', state: 'ready', requiredChecksPassed: 3, requiredChecksTotal: 3, blockingConditions: [], nonBlockingConditions: [], attempt: 1 });
  const signal = detectProjectSignals(repo, 'SIG-HREADY', new Date('2026-09-20T08:00:00Z')).find((x) => x.signalId.startsWith(`handoff:${handoff.id}:`));
  assert.ok(signal);
  assert.equal(signal!.suggestedAction, 'accept');
  assert.equal(signal!.ownerId, 'dev1');
});

test('budget overrun creates a decision signal using finance evidence and sponsor authority', () => {
  const { repo, service } = repoAndService();
  seed(service, 'SIG-BUDGET', { budget: 100_000, sponsor: true });
  service.importPlan('SIG-BUDGET', 'pm', [{ id: 'A1', projectId: 'SIG-BUDGET', phase: 'Build', title: 'Build', status: 'in-progress', plannedTeamId: 'dev', ownerId: 'dev1', priority: 'medium', milestone: false }], []);
  service.registerSource('SIG-BUDGET', 'pm', source('SIG-BUDGET', 'current', 'finance actuals and budget'));
  service.configureProject('SIG-BUDGET', 'pm', { eac: 115_000, evidenceConfidence: 'high' });
  const budget = detectProjectSignals(repo, 'SIG-BUDGET', new Date('2026-09-20T08:00:00Z')).find((x) => x.kind === 'budget');
  assert.ok(budget);
  assert.equal(budget!.consequence, 'critical');
  assert.equal(budget!.decisionOwnerId, 'sponsor');
  assert.equal(budget!.suggestedAction, 'decide');
  assert.deepEqual(budget!.sourceRefs, ['ref://SIG-BUDGET/finance actuals and budget']);
});

test('stale or unavailable authoritative source creates a scoped source-health correction signal', () => {
  const { repo, service } = repoAndService();
  seed(service, 'SIG-SOURCE');
  service.importPlan('SIG-SOURCE', 'pm', [{ id: 'A1', projectId: 'SIG-SOURCE', phase: 'Build', title: 'Build', status: 'in-progress', plannedTeamId: 'dev', ownerId: 'dev1', priority: 'medium', milestone: false }], []);
  service.registerSource('SIG-SOURCE', 'pm', source('SIG-SOURCE', 'unavailable', 'quality acceptance'));
  const health = detectProjectSignals(repo, 'SIG-SOURCE', new Date('2026-09-20T08:00:00Z')).find((x) => x.kind === 'source-health');
  assert.ok(health);
  assert.equal(health!.consequence, 'high');
  assert.equal(health!.suggestedAction, 'correct');
  assert.match(health!.impact, /last-known state/i);
});
