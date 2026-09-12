import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  ProjectControlService,
  SqliteProjectRepository,
  buildPersonalWorkspace,
  buildPortfolioWorkspace,
  calculateTraceabilitySnapshot,
  runNewProjectAcceptanceScenario,
  type ProjectMember,
} from '../src/index.js';

function migratedRepo(): SqliteProjectRepository {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../migrations/20260910_ai_first_simplification.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../migrations/20260910_role_scoped_project_control.sql', import.meta.url), 'utf8'));
  return new SqliteProjectRepository(db);
}

test('new project executes end to end through setup, source-driven delivery, exception, decision, handoffs, reporting and closure', async () => {
  const repo = migratedRepo();
  const report = await runNewProjectAcceptanceScenario(repo);
  assert.equal(report.workflowPass, true);
  assert.equal(report.finalLifecycle, 'closed');
  assert.equal(report.baselineActivities, 5);
  assert.equal(report.dependencies, 4);
  assert.equal(report.initialCycleSuppressed, true);
  assert.equal(report.handoffAttentionCreated, true);
  assert.equal(report.criticalExceptionCreated, true);
  assert.equal(report.decisionPrepared, true);
  assert.equal(report.decisionCompleted, true);
  assert.equal(report.decisionFollowThroughCreated, true);
  assert.equal(report.exceptionAutoResolved, true);
  assert.equal(report.correctiveActionClosedOnProof, true);
  assert.ok(report.reportSnapshots >= 3);
  assert.ok(report.auditEvents > 20);
  assert.equal(report.auditChainIntegrity, true);
  assert.equal(report.appendOnlyAuditEnforced, true);
  assert.equal(report.traceability.pass, true);
  assert.deepEqual(report.traceability.orphanRecords, []);
});

test('each user group receives role-scoped detail and capabilities rather than one shared generic dashboard', async () => {
  const repo = migratedRepo();
  const report = await runNewProjectAcceptanceScenario(repo);
  assert.deepEqual(report.roleVisibility.pm1, { activities: 5, canAssign: true, canApprove: false, canViewMoney: true });
  assert.deepEqual(report.roleVisibility.program1, { activities: 5, canAssign: true, canApprove: false, canViewMoney: true });
  assert.deepEqual(report.roleVisibility.pmo1, { activities: 5, canAssign: false, canApprove: false, canViewMoney: true });
  assert.deepEqual(report.roleVisibility.sponsor1, { activities: 5, canAssign: false, canApprove: true, canViewMoney: true });
  assert.deepEqual(report.roleVisibility.devlead, { activities: 3, canAssign: true, canApprove: false, canViewMoney: false });
  assert.deepEqual(report.roleVisibility.dev1, { activities: 2, canAssign: false, canApprove: false, canViewMoney: false });
  assert.deepEqual(report.roleVisibility.admin1, { activities: 0, canAssign: false, canApprove: false, canViewMoney: false });

  const pmo = buildPersonalWorkspace(repo, report.projectId, 'pmo1');
  assert.equal(pmo.activities.length, 5);
  assert.equal(pmo.capabilities.canAssign, false);
  assert.equal(pmo.navigation.global.includes('Administration'), true);

  const sponsor = buildPersonalWorkspace(repo, report.projectId, 'sponsor1');
  assert.equal(sponsor.capabilities.canApprove, true);
  assert.equal(sponsor.activities.length, 5);
  assert.equal(sponsor.navigation.project.includes('Money'), true);

  const lead = buildPersonalWorkspace(repo, report.projectId, 'devlead');
  assert.equal(lead.capabilities.canAssign, true);
  assert.equal(lead.activities.every((activity) => (activity.currentTeamId ?? activity.plannedTeamId) === 'dev'), true);

  const member = buildPersonalWorkspace(repo, report.projectId, 'dev1');
  assert.equal(member.activities.every((activity) => activity.ownerId === 'dev1'), true);
  assert.equal(member.capabilities.canAssign, false);

  const admin = buildPersonalWorkspace(repo, report.projectId, 'admin1');
  assert.deepEqual(admin.navigation.global, ['Administration']);
  assert.deepEqual(admin.activities, []);
});

test('program manager gets portfolio-level visibility without creating a separate portfolio status dataset', async () => {
  const repo = migratedRepo();
  const report = await runNewProjectAcceptanceScenario(repo);
  const portfolio = buildPortfolioWorkspace(repo, 'ORG-ACME', 'program1');
  assert.equal(portfolio.projects.length, 1);
  assert.equal(portfolio.projects[0]?.projectId, report.projectId);
  assert.equal(portfolio.projects[0]?.lifecycle, 'closed');
  assert.equal(portfolio.projects[0]?.unownedActivities, 0);
});

test('traceability metrics expose each control dimension separately and pass only when links and ownership are intact', async () => {
  const repo = migratedRepo();
  const report = await runNewProjectAcceptanceScenario(repo);
  const snapshot = calculateTraceabilitySnapshot(repo, report.projectId);
  assert.equal(snapshot.ownershipCoverage.percent, 100);
  assert.equal(snapshot.assignmentConsistency.percent, 100);
  assert.equal(snapshot.dependencyIntegrity.percent, 100);
  assert.equal(snapshot.sourceLineageCoverage.percent, 100);
  assert.equal(snapshot.decisionLinkage.percent, 100);
  assert.equal(snapshot.handoffLinkage.percent, 100);
  assert.equal(snapshot.auditChainIntegrity, true);
  assert.equal(snapshot.pass, true);
});

test('assignment authority is scoped: delivery lead can assign within team but cannot take over another team', () => {
  const repo = migratedRepo();
  const service = new ProjectControlService(repo, () => new Date('2026-09-10T08:00:00.000Z'));
  const projectId = 'SCOPE-1';
  const members: ProjectMember[] = [
    { projectId, userId: 'pm', displayName: 'PM', role: 'project-manager', teamId: 'pmo', active: true, permissions: [], joinedAt: '2026-09-10T08:00:00.000Z' },
    { projectId, userId: 'devlead', displayName: 'Dev Lead', role: 'delivery-lead', teamId: 'dev', active: true, permissions: [], joinedAt: '2026-09-10T08:00:00.000Z' },
    { projectId, userId: 'qalead', displayName: 'QA Lead', role: 'delivery-lead', teamId: 'qa', active: true, permissions: [], joinedAt: '2026-09-10T08:00:00.000Z' },
    { projectId, userId: 'dev1', displayName: 'Dev', role: 'team-member', teamId: 'dev', active: true, permissions: [], joinedAt: '2026-09-10T08:00:00.000Z' },
    { projectId, userId: 'qa1', displayName: 'QA', role: 'team-member', teamId: 'qa', active: true, permissions: [], joinedAt: '2026-09-10T08:00:00.000Z' },
  ];
  service.createProject({ id: projectId, organisationId: 'ORG', code: 'SCOPE', name: 'Scope Test', pmId: 'pm', timezone: 'UTC' }, members, 'system');
  service.importPlan(projectId, 'pm', [
    { id: 'DEV', projectId, phase: 'Build', title: 'Dev work', status: 'not-started', plannedTeamId: 'dev', priority: 'medium', milestone: false },
    { id: 'QA', projectId, phase: 'Test', title: 'QA work', status: 'not-started', plannedTeamId: 'qa', priority: 'medium', milestone: false },
  ], []);
  service.assignActivity(projectId, 'DEV', 'dev1', 'devlead');
  assert.throws(() => service.assignActivity(projectId, 'QA', 'qa1', 'devlead'), /assignment authority/);
  const denied = repo.listEvents(projectId).filter((event) => event.result === 'denied');
  assert.equal(denied.length, 1);
  assert.equal(denied[0]?.eventType, 'activity.assignment-denied');
});

test('audit ledger is append-only at database level, not only by service convention', async () => {
  const repo = migratedRepo();
  const report = await runNewProjectAcceptanceScenario(repo);
  const event = repo.listEvents(report.projectId)[0];
  assert.ok(event);
  assert.throws(() => repo.db.prepare('DELETE FROM pc_project_events WHERE id=?').run(event!.id), /append-only/);
});
