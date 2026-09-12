import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AttentionEngine,
  AutonomousProjectManager,
  DeterministicFallbackAi,
  InMemoryControlRepository,
  attentionPriority,
  buildProjectOverview,
  calculateAdminReduction,
  decideHandoff,
  defaultLanding,
  evaluateMinimumReadiness,
  generateProjection,
  globalNavigation,
  projectNavigation,
  sanitizeAiAssessment,
  type AiAssessment,
  type AiReasoningProvider,
  type AttentionItem,
  type EvidenceResolver,
  type ProjectOrientation,
  type ProjectSignal,
} from '../src/index.js';

const fixedNow = new Date('2026-09-10T00:00:00.000Z');
const now = () => fixedNow;

function signal(overrides: Partial<ProjectSignal> = {}): ProjectSignal {
  return {
    signalId: 's1', organisationId: 'o1', projectId: 'p1', kind: 'schedule', rootCauseKey: 'root-1',
    title: 'Testing may slip', observedAt: fixedNow.toISOString(), consequence: 'high', confidence: 'high', material: true,
    situation: 'Two blocking defects remain open.', impact: 'Launch forecast may move by four days.', ownerId: 'qa-lead', decisionOwnerId: 'pm1',
    dueAt: '2026-09-11T00:00:00.000Z', sourceRefs: ['jira:J1', 'qa:T1'], ...overrides,
  };
}

test('AI-first attention engine consolidates duplicate symptoms into one root-cause item', () => {
  const repo = new InMemoryControlRepository();
  const engine = new AttentionEngine(repo, now);
  const result = engine.reconcile('p1', [signal(), signal({ signalId: 's2', kind: 'quality', title: 'Defect reopened', sourceRefs: ['qa:D2'] })]);
  assert.equal(result.created, 1);
  assert.equal(result.active.length, 1);
  assert.equal(result.active[0]?.sourceSignalIds.length, 2);
  assert.match(result.active[0]?.situation ?? '', /2 related signals consolidated/);
});

test('critical low-confidence item stays more urgent than medium high-confidence item', () => {
  const critical = attentionPriority({ consequence: 'critical', confidence: 'low' }, fixedNow);
  const medium = attentionPriority({ consequence: 'medium', confidence: 'high', dueAt: '2026-09-10T01:00:00.000Z' }, fixedNow);
  assert.ok(critical > medium);
});

test('low-confidence material signal becomes confirm/verify action rather than downgraded consequence', () => {
  const repo = new InMemoryControlRepository();
  const engine = new AttentionEngine(repo, now);
  const result = engine.reconcile('p1', [signal({ consequence: 'critical', confidence: 'low' })]);
  assert.equal(result.active[0]?.consequence, 'critical');
  assert.equal(result.active[0]?.nextAction, 'confirm');
});

test('resolved root cause auto-closes existing attention item without manual status maintenance', () => {
  const repo = new InMemoryControlRepository();
  const engine = new AttentionEngine(repo, now);
  engine.reconcile('p1', [signal()]);
  const second = engine.reconcile('p1', []);
  assert.equal(second.resolved, 1);
  assert.equal(second.active.length, 0);
  assert.equal(repo.listAttention('p1')[0]?.state, 'resolved');
});

test('non-material signals stay silent and create no attention item', () => {
  const repo = new InMemoryControlRepository();
  const engine = new AttentionEngine(repo, now);
  const result = engine.reconcile('p1', [signal({ material: false })]);
  assert.equal(result.created, 0);
  assert.equal(result.active.length, 0);
});

test('AI assessment is constrained to evidence references already permitted into the attention item', () => {
  const item: AttentionItem = {
    id: 'a1', organisationId: 'o1', projectId: 'p1', rootCauseKey: 'r', title: 'x', state: 'open', consequence: 'high', confidence: 'high',
    situation: 'x', impact: 'y', nextAction: 'decide', sourceSignalIds: ['s'], sourceRefs: ['allowed'], firstSeenAt: fixedNow.toISOString(), lastSeenAt: fixedNow.toISOString(), revision: 1,
  };
  const raw: AiAssessment = {
    assessmentId: 'ai1', generatedAt: fixedNow.toISOString(), modelLabel: 'test', summary: 'summary', recommendedOptionId: 'o1',
    options: [], missingInformation: [], confidence: 'high', sourceRefs: ['invented'], abstained: false,
  };
  const safe = sanitizeAiAssessment(raw, item);
  assert.deepEqual(safe.sourceRefs, []);
  assert.equal(safe.abstained, true);
  assert.equal('recommendedOptionId' in safe, false);
});

test('autonomous cycle prepares a decision brief but keeps human authority for material decision', async () => {
  const repo = new InMemoryControlRepository();
  const evidence: EvidenceResolver = { getPermittedEvidence: async () => [{ ref: 'jira:J1', summary: 'Blocking defect remains open.' }] };
  const manager = new AutonomousProjectManager(repo, new DeterministicFallbackAi(), evidence, now);
  const result = await manager.run('p1', [signal({ suggestedAction: 'decide' })], {
    aiEnabled: true, autoPrepareDecisionBriefs: true, autoCreateInternalActions: true, autoRequestEvidence: true,
    suppressNoMaterialChange: true, allowedAutoActionConsequences: ['low', 'medium'],
  });
  assert.equal(result.attentionCreated, 1);
  assert.equal(result.aiAssessments, 1);
  assert.equal(result.preparedActions[0]?.type, 'prepare-decision-brief');
  assert.equal(result.preparedActions[0]?.requiresHumanAuthority, true);
});

test('autonomous cycle requests evidence automatically for material low-confidence ambiguity', async () => {
  const repo = new InMemoryControlRepository();
  const evidence: EvidenceResolver = { getPermittedEvidence: async () => [] };
  const manager = new AutonomousProjectManager(repo, new DeterministicFallbackAi(), evidence, now);
  const result = await manager.run('p1', [signal({ confidence: 'unknown', sourceRefs: [] })], {
    aiEnabled: true, autoPrepareDecisionBriefs: true, autoCreateInternalActions: true, autoRequestEvidence: true,
    suppressNoMaterialChange: true, allowedAutoActionConsequences: ['low', 'medium'],
  });
  assert.equal(result.preparedActions[0]?.type, 'request-evidence');
  assert.equal(result.preparedActions[0]?.requiresHumanAuthority, false);
});

test('AI failure never stops deterministic project control', async () => {
  const repo = new InMemoryControlRepository();
  const brokenAi: AiReasoningProvider = { label: 'broken', assess: async () => { throw new Error('offline'); } };
  const evidence: EvidenceResolver = { getPermittedEvidence: async () => [] };
  const manager = new AutonomousProjectManager(repo, brokenAi, evidence, now);
  const result = await manager.run('p1', [signal({ suggestedAction: 'decide' })], {
    aiEnabled: true, autoPrepareDecisionBriefs: true, autoCreateInternalActions: true, autoRequestEvidence: true,
    suppressNoMaterialChange: true, allowedAutoActionConsequences: ['low'],
  });
  assert.equal(result.attentionCreated, 1);
  assert.equal(result.aiAssessments, 0);
  assert.equal(result.preparedActions[0]?.type, 'prepare-decision-brief');
});

test('no material change is suppressed rather than generating filler reporting work', async () => {
  const repo = new InMemoryControlRepository();
  const manager = new AutonomousProjectManager(repo, new DeterministicFallbackAi(), { getPermittedEvidence: async () => [] }, now);
  const result = await manager.run('p1', [signal({ material: false })], {
    aiEnabled: true, autoPrepareDecisionBriefs: true, autoCreateInternalActions: true, autoRequestEvidence: true,
    suppressNoMaterialChange: true, allowedAutoActionConsequences: ['low', 'medium'],
  });
  assert.equal(result.suppressedAsNoMaterialChange, true);
  assert.equal(result.preparedActions.length, 0);
});

test('routine low-consequence corrective item can prepare internal action automatically', async () => {
  const repo = new InMemoryControlRepository();
  const manager = new AutonomousProjectManager(repo, new DeterministicFallbackAi(), { getPermittedEvidence: async () => [{ ref: 'r', summary: 'x' }] }, now);
  const result = await manager.run('p1', [signal({ consequence: 'low', suggestedAction: 'resolve', sourceRefs: ['r'] })], {
    aiEnabled: true, autoPrepareDecisionBriefs: true, autoCreateInternalActions: true, autoRequestEvidence: true,
    suppressNoMaterialChange: true, allowedAutoActionConsequences: ['low', 'medium'],
  });
  assert.equal(result.preparedActions[0]?.type, 'create-internal-action');
  assert.equal(result.preparedActions[0]?.requiresHumanAuthority, false);
});

test('high-consequence corrective action is not silently auto-executed when policy allows only lower consequence', async () => {
  const repo = new InMemoryControlRepository();
  const manager = new AutonomousProjectManager(repo, new DeterministicFallbackAi(), { getPermittedEvidence: async () => [{ ref: 'r', summary: 'x' }] }, now);
  const result = await manager.run('p1', [signal({ consequence: 'high', suggestedAction: 'resolve', sourceRefs: ['r'] })], {
    aiEnabled: false, autoPrepareDecisionBriefs: false, autoCreateInternalActions: true, autoRequestEvidence: false,
    suppressNoMaterialChange: true, allowedAutoActionConsequences: ['low', 'medium'],
  });
  assert.equal(result.preparedActions.length, 0);
});

function orientation(overrides: Partial<ProjectOrientation> = {}): ProjectOrientation {
  return {
    projectId: 'p1', projectName: 'Portal replacement', lifecycle: 'active', baselineVersion: 'v1', baselineFinish: '2026-09-30', forecastFinish: '2026-10-06',
    budget: 100000, eac: 102700, currency: 'USD', openAttentionCount: 1, criticalAttentionCount: 0, evidenceConfidence: 'high', sourceHealthSummary: 'All critical sources current', ...overrides,
  };
}

test('project overview leads with intervention and forecast rather than routine task counts', () => {
  const repo = new InMemoryControlRepository();
  const engine = new AttentionEngine(repo, now);
  const items = engine.reconcile('p1', [signal()]).active;
  const view = buildProjectOverview(orientation(), items, fixedNow);
  assert.equal(view.hideRoutineTaskCounts, true);
  assert.equal(view.interventionSummary, '1 item requires attention.');
  assert.equal(view.orientation.deliveryForecast, '+6 days vs baseline');
  assert.equal(view.orientation.budgetForecast, '+2.7% vs budget');
});

test('governed report is a projection of the same attention state, not a separate report workflow', () => {
  const repo = new InMemoryControlRepository();
  const items = new AttentionEngine(repo, now).reconcile('p1', [signal({ suggestedAction: 'decide' })]).active;
  const projection = generateProjection(orientation(), items, 'sponsor', fixedNow.toISOString());
  assert.equal(projection.decisions.length, 1);
  assert.equal(projection.materialChange, true);
  assert.equal(projection.headline, '1 item requires attention; 1 require decision or approval.');
  assert.deepEqual([...projection.sourceRefs].sort(), ['jira:J1', 'qa:T1']);
});

test('empty governed projection explicitly states no intervention required', () => {
  const projection = generateProjection(orientation({ openAttentionCount: 0 }), [], 'pm', fixedNow.toISOString());
  assert.equal(projection.materialChange, false);
  assert.match(projection.headline, /No material project intervention/);
});

test('PM navigation is simplified to Attention, Projects and My Work with Attention as default', () => {
  assert.deepEqual(globalNavigation('project-manager'), ['Attention', 'Projects', 'My Work']);
  assert.equal(defaultLanding('project-manager'), 'Attention');
  assert.deepEqual(projectNavigation('project-manager'), ['Overview', 'Plan', 'People', 'Money', 'Delivery']);
});

test('team member does not receive project administration navigation', () => {
  assert.deepEqual(globalNavigation('team-member'), ['Attention', 'My Work']);
  assert.equal(globalNavigation('team-member').includes('Administration'), false);
});

test('enterprise administrator sees administration instead of project-status workspace', () => {
  assert.deepEqual(globalNavigation('enterprise-admin'), ['Administration']);
  assert.deepEqual(projectNavigation('enterprise-admin'), []);
});

test('minimum readiness returns only actionable unresolved gaps', () => {
  const result = evaluateMinimumReadiness({
    projectId: 'p1', pmAssigned: true, baselineAccepted: false, executableWorkReady: true, materialCommitmentsDefined: true,
    requiredTeamLeadsAssigned: false, legitimateEvidenceSourceAvailable: true,
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.gaps.map((x) => x.code), ['BASELINE_MISSING', 'LEAD_MISSING']);
  assert.deepEqual(result.gaps.map((x) => x.action), ['Review baseline', 'Assign team lead']);
});

test('ready project needs no setup maze', () => {
  const result = evaluateMinimumReadiness({ projectId: 'p1', pmAssigned: true, baselineAccepted: true, executableWorkReady: true, materialCommitmentsDefined: true, requiredTeamLeadsAssigned: true, legitimateEvidenceSourceAvailable: true });
  assert.equal(result.ready, true);
  assert.deepEqual(result.gaps, []);
});

test('handoff accepts with one receiver action when all required checks pass', () => {
  const next = decideHandoff({ handoffId: 'h1', projectId: 'p1', deliverableVersion: '4.2', senderId: 'dev', receiverId: 'qa', requiredChecksPassed: 6, requiredChecksTotal: 6, blockingConditions: [], nonBlockingConditions: ['Docs pending'], state: 'ready', attempt: 1 }, 'qa', { state: 'accepted' });
  assert.equal(next.state, 'accepted');
  assert.deepEqual(next.nonBlockingConditions, ['Docs pending']);
});

test('handoff cannot accept while mandatory checks are incomplete', () => {
  assert.throws(() => decideHandoff({ handoffId: 'h1', projectId: 'p1', deliverableVersion: '4.2', senderId: 'dev', receiverId: 'qa', requiredChecksPassed: 5, requiredChecksTotal: 6, blockingConditions: ['Security scan'], nonBlockingConditions: [], state: 'ready', attempt: 1 }, 'qa', { state: 'accepted' }), /Required handoff checks/);
});

test('handoff return keeps the same handoff and increments attempt rather than creating disconnected rework', () => {
  const next = decideHandoff({ handoffId: 'h1', projectId: 'p1', deliverableVersion: '4.2', senderId: 'dev', receiverId: 'qa', requiredChecksPassed: 6, requiredChecksTotal: 6, blockingConditions: [], nonBlockingConditions: [], state: 'ready', attempt: 1 }, 'qa', { state: 'returned', reason: 'Entry test failed' });
  assert.equal(next.handoffId, 'h1');
  assert.equal(next.state, 'returned');
  assert.equal(next.attempt, 2);
});

test('admin reduction metric measures actual time saved rather than assuming 90 percent', () => {
  const result = calculateAdminReduction(
    { period: 'before', statusCollectionMinutes: 120, reconciliationMinutes: 60, chasingMinutes: 60, reportingMinutes: 120, duplicateGovernanceMinutes: 60, decisionPreparationMinutes: 30 },
    { period: 'after', statusCollectionMinutes: 10, reconciliationMinutes: 10, chasingMinutes: 20, reportingMinutes: 5, duplicateGovernanceMinutes: 5, decisionPreparationMinutes: 20 },
  );
  assert.equal(result.baselineMinutes, 450);
  assert.equal(result.currentMinutes, 70);
  assert.ok((result.reductionPercent ?? 0) > 84 && (result.reductionPercent ?? 0) < 85);
});

test('admin reduction metric returns null percent when no baseline exists instead of inventing success', () => {
  const empty = { period: 'x', statusCollectionMinutes: 0, reconciliationMinutes: 0, chasingMinutes: 0, reportingMinutes: 0, duplicateGovernanceMinutes: 0, decisionPreparationMinutes: 0 };
  const result = calculateAdminReduction(empty, empty);
  assert.equal(result.reductionPercent, null);
});

test('attention priority increases as a deadline approaches and handles invalid deadlines safely', () => {
  const far = attentionPriority({ consequence: 'low', confidence: 'high', dueAt: '2026-09-20T00:00:00.000Z' }, fixedNow);
  const week = attentionPriority({ consequence: 'low', confidence: 'high', dueAt: '2026-09-15T00:00:00.000Z' }, fixedNow);
  const threeDays = attentionPriority({ consequence: 'low', confidence: 'high', dueAt: '2026-09-12T00:00:00.000Z' }, fixedNow);
  const day = attentionPriority({ consequence: 'low', confidence: 'high', dueAt: '2026-09-10T12:00:00.000Z' }, fixedNow);
  const overdue = attentionPriority({ consequence: 'low', confidence: 'high', dueAt: '2026-09-09T00:00:00.000Z' }, fixedNow);
  const invalid = attentionPriority({ consequence: 'low', confidence: 'high', dueAt: 'not-a-date' }, fixedNow);
  assert.ok(far < week && week < threeDays && threeDays < day && day < overdue);
  assert.equal(invalid, far);
});

test('default attention actions are contextual instead of exposing separate workflow pages', () => {
  assert.equal(new AttentionEngine(new InMemoryControlRepository(), now).reconcile('p1', [signal({ kind: 'handoff', suggestedAction: 'accept' })]).active[0]?.nextAction, 'accept');
  assert.equal(new AttentionEngine(new InMemoryControlRepository(), now).reconcile('p1', [signal({ kind: 'budget', suggestedAction: 'approve' })]).active[0]?.nextAction, 'approve');
  assert.equal(new AttentionEngine(new InMemoryControlRepository(), now).reconcile('p1', [signal({ kind: 'evidence', suggestedAction: 'correct' })]).active[0]?.nextAction, 'correct');
  assert.equal(new AttentionEngine(new InMemoryControlRepository(), now).reconcile('p1', [signal({ kind: 'issue', suggestedAction: 'resolve' })]).active[0]?.nextAction, 'resolve');
});

test('existing attention item is updated in place as new evidence changes consequence and ownership', () => {
  const repo = new InMemoryControlRepository();
  const engine = new AttentionEngine(repo, now);
  const first = engine.reconcile('p1', [signal({ consequence: 'medium', ownerId: 'qa1' })]);
  const id = first.active[0]?.id;
  const second = engine.reconcile('p1', [signal({ signalId: 's3', consequence: 'critical', confidence: 'medium', ownerId: 'qa2', sourceRefs: ['qa:new'] })]);
  assert.equal(second.created, 0);
  assert.equal(second.updated, 1);
  assert.equal(second.active[0]?.id, id);
  assert.equal(second.active[0]?.consequence, 'critical');
  assert.equal(second.active[0]?.ownerId, 'qa2');
  assert.equal(second.active[0]?.revision, 2);
});

test('attention reconciliation ignores material signals belonging to another project', () => {
  const repo = new InMemoryControlRepository();
  const result = new AttentionEngine(repo, now).reconcile('p1', [signal({ projectId: 'p2' })]);
  assert.equal(result.active.length, 0);
  assert.equal(repo.listAttention('p1').length, 0);
});
