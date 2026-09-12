import { ProjectControlCoordinator } from '../project/coordinator.js';
import { ProjectControlService } from '../project/service.js';
import { SqlProjectRepository } from '../project/sqlite-repository.js';
import type { ActivityCreateInput, DependencyRecord, ProjectMember, SourceStateRecord } from '../project/types.js';
import { buildPersonalWorkspace, buildPortfolioWorkspace } from '../ux/personalized-view.js';
import { calculateTraceabilitySnapshot, type TraceabilitySnapshot } from '../trace/metrics.js';

export interface NewProjectAcceptanceReport {
  projectId: string;
  projectName: string;
  finalLifecycle: string;
  baselineActivities: number;
  dependencies: number;
  roleVisibility: Readonly<Record<string, { activities: number; canAssign: boolean; canApprove: boolean; canViewMoney: boolean }>>;
  initialCycleSuppressed: boolean;
  handoffAttentionCreated: boolean;
  criticalExceptionCreated: boolean;
  decisionPrepared: boolean;
  decisionCompleted: boolean;
  decisionFollowThroughCreated: boolean;
  exceptionAutoResolved: boolean;
  correctiveActionClosedOnProof: boolean;
  reportSnapshots: number;
  auditEvents: number;
  auditChainIntegrity: boolean;
  traceability: TraceabilitySnapshot;
  appendOnlyAuditEnforced: boolean;
  workflowPass: boolean;
}

function member(projectId: string, userId: string, displayName: string, role: ProjectMember['role'], teamId?: string): ProjectMember {
  return { projectId, userId, displayName, role, ...(teamId ? { teamId } : {}), active: true, permissions: [], joinedAt: '2026-09-10T08:00:00.000Z' };
}

export async function runNewProjectAcceptanceScenario(repo: SqlProjectRepository): Promise<NewProjectAcceptanceReport> {
  let current = new Date('2026-09-10T08:00:00.000Z');
  const now = () => new Date(current.getTime());
  const setTime = (iso: string) => { current = new Date(iso); };
  const service = new ProjectControlService(repo, now);
  const coordinator = new ProjectControlCoordinator(repo, undefined, undefined, now);
  const projectId = 'NP-PORTAL-001';
  const organisationId = 'ORG-ACME';

  const members: ProjectMember[] = [
    member(projectId, 'pm1', 'Priya Project Manager', 'project-manager', 'pmo'),
    member(projectId, 'program1', 'Ravi Program Manager', 'program-manager', 'pmo'),
    member(projectId, 'pmo1', 'PMO Governance Owner', 'pmo', 'pmo'),
    member(projectId, 'sponsor1', 'Sara Sponsor', 'sponsor', 'exec'),
    member(projectId, 'devlead', 'Dev Delivery Lead', 'delivery-lead', 'dev'),
    member(projectId, 'qalead', 'QA Delivery Lead', 'delivery-lead', 'qa'),
    member(projectId, 'productlead', 'Product Delivery Lead', 'delivery-lead', 'product'),
    member(projectId, 'dev1', 'Dev Engineer', 'team-member', 'dev'),
    member(projectId, 'qa1', 'QA Engineer', 'team-member', 'qa'),
    member(projectId, 'admin1', 'Enterprise Integration Admin', 'enterprise-admin'),
  ];

  service.createProject({ id: projectId, organisationId, code: 'PORTAL', name: 'Legacy Customer Onboarding Portal Replacement', pmId: 'pm1', sponsorId: 'sponsor1',
    timezone: 'Asia/Dubai', baselineFinish: '2026-10-10', budget: 100000, currency: 'USD' }, members, 'system:organisation');

  const activities: ActivityCreateInput[] = [
    { id: 'A10', projectId, phase: 'Design', title: 'Complete onboarding UX and integration design', status: 'not-started', baselineStart: '2026-09-10', baselineFinish: '2026-09-15', forecastFinish: '2026-09-15', plannedTeamId: 'dev', priority: 'high', milestone: false, sourceSystem: 'Jira', sourceRef: 'jira:portal', evidenceRefs: [] },
    { id: 'A20', projectId, phase: 'Build', title: 'Build portal, Stripe and SSO integration', status: 'not-started', baselineStart: '2026-09-16', baselineFinish: '2026-09-22', forecastFinish: '2026-09-22', plannedTeamId: 'dev', priority: 'critical', milestone: true, sourceSystem: 'Jira', sourceRef: 'jira:portal', evidenceRefs: [] },
    { id: 'A30', projectId, phase: 'Test', title: 'System and integration testing', status: 'not-started', baselineStart: '2026-09-23', baselineFinish: '2026-09-30', forecastFinish: '2026-09-30', plannedTeamId: 'qa', priority: 'high', milestone: true, sourceSystem: 'QA', sourceRef: 'qa:portal', evidenceRefs: [] },
    { id: 'A40', projectId, phase: 'UAT', title: 'Customer UAT and acceptance', status: 'not-started', baselineStart: '2026-10-01', baselineFinish: '2026-10-06', forecastFinish: '2026-10-06', plannedTeamId: 'product', priority: 'high', milestone: true, evidenceRefs: [] },
    { id: 'A50', projectId, phase: 'Launch', title: 'Production release and launch', status: 'not-started', baselineStart: '2026-10-07', baselineFinish: '2026-10-10', forecastFinish: '2026-10-10', plannedTeamId: 'dev', priority: 'critical', milestone: true, sourceSystem: 'CI/CD', sourceRef: 'cicd:portal', evidenceRefs: [] },
  ];
  const dependencies: DependencyRecord[] = [
    { id: 'D1', projectId, predecessorActivityId: 'A10', successorActivityId: 'A20', gateType: 'finish-to-start', mandatory: true },
    { id: 'D2', projectId, predecessorActivityId: 'A20', successorActivityId: 'A30', gateType: 'accepted-deliverable', mandatory: true },
    { id: 'D3', projectId, predecessorActivityId: 'A30', successorActivityId: 'A40', gateType: 'accepted-deliverable', mandatory: true },
    { id: 'D4', projectId, predecessorActivityId: 'A40', successorActivityId: 'A50', gateType: 'finish-to-start', mandatory: true },
  ];
  service.importPlan(projectId, 'pm1', activities, dependencies);
  service.assignActivity(projectId, 'A10', 'dev1', 'pm1');
  service.assignActivity(projectId, 'A20', 'dev1', 'pm1');
  service.assignActivity(projectId, 'A30', 'qa1', 'pm1');
  service.assignActivity(projectId, 'A40', 'productlead', 'pm1');
  service.assignActivity(projectId, 'A50', 'devlead', 'pm1');

  const sources: SourceStateRecord[] = [
    { id: 'SRC-JIRA', projectId, sourceType: 'Work tracking', sourceRef: 'jira:portal', authority: 'schedule and execution', status: 'current', lastObservedAt: now().toISOString(), freshnessHours: 24, classification: 'internal', revision: 1 },
    { id: 'SRC-QA', projectId, sourceType: 'Quality', sourceRef: 'qa:portal', authority: 'quality and test evidence', status: 'current', lastObservedAt: now().toISOString(), freshnessHours: 24, classification: 'internal', revision: 1 },
    { id: 'SRC-CICD', projectId, sourceType: 'CI/CD', sourceRef: 'cicd:portal', authority: 'release evidence', status: 'current', lastObservedAt: now().toISOString(), freshnessHours: 24, classification: 'internal', revision: 1 },
    { id: 'SRC-FIN', projectId, sourceType: 'Finance', sourceRef: 'finance:portal', authority: 'finance actuals and budget', status: 'current', lastObservedAt: now().toISOString(), freshnessHours: 48, classification: 'confidential', revision: 1 },
  ];
  for (const source of sources) service.registerSource(projectId, 'admin1', source);
  service.configureProject(projectId, 'pm1', { baselineVersion: 'BL-1', baselineAccepted: true, materialOutcomesConfirmed: true, eac: 95000 });
  service.refreshDerivedProjectState(projectId);
  service.transitionProject(projectId, 'pm1', 'ready');
  service.transitionProject(projectId, 'pm1', 'active');

  const roleVisibility: Record<string, { activities: number; canAssign: boolean; canApprove: boolean; canViewMoney: boolean }> = {};
  for (const userId of ['pm1', 'program1', 'pmo1', 'sponsor1', 'devlead', 'dev1', 'admin1']) {
    const view = buildPersonalWorkspace(repo, projectId, userId);
    roleVisibility[userId] = { activities: view.activities.length, canAssign: view.capabilities.canAssign, canApprove: view.capabilities.canApprove, canViewMoney: view.capabilities.canViewMoney };
  }
  buildPortfolioWorkspace(repo, organisationId, 'program1');

  const initialCycle = await coordinator.run(projectId);

  setTime('2026-09-15T12:00:00.000Z');
  service.applySourceActivityUpdate(projectId, 'A10', 'jira:portal', { status: 'done', actualStart: '2026-09-10', actualFinish: '2026-09-15', evidenceRefs: ['jira:A10:done'] }, 'jira:event:A10:done');
  setTime('2026-09-22T12:00:00.000Z');
  service.applySourceActivityUpdate(projectId, 'A20', 'jira:portal', { status: 'done', actualStart: '2026-09-16', actualFinish: '2026-09-22', evidenceRefs: ['jira:A20:done', 'build:4.2'] }, 'jira:event:A20:done');
  service.createHandoff(projectId, 'dev1', { id: 'H1', projectId, sourceActivityId: 'A20', targetActivityId: 'A30', senderId: 'dev1', receiverId: 'qa1', deliverableVersion: '4.2', state: 'ready', requiredChecksPassed: 6, requiredChecksTotal: 6, blockingConditions: [], nonBlockingConditions: ['Release notes draft pending'], attempt: 1 });
  const handoffCycle = await coordinator.run(projectId);
  const handoffAttentionCreated = handoffCycle.signals.some((signal) => signal.kind === 'handoff');
  service.respondToHandoff(projectId, 'H1', 'qa1', { state: 'accepted' });
  await coordinator.run(projectId);

  setTime('2026-09-26T08:00:00.000Z');
  service.applySourceActivityUpdate(projectId, 'A30', 'qa:portal', { status: 'blocked', actualStart: '2026-09-23', forecastFinish: '2026-10-16', percentComplete: 55, blocker: 'Two Sev-1 defects block system test exit.', evidenceRefs: ['qa:defect:SEV1-1', 'qa:defect:SEV1-2'] }, 'qa:event:blocker');
  const exceptionCycle = await coordinator.run(projectId);
  const critical = repo.listAttention(projectId).find((item) => item.rootCauseKey === 'activity:A30:delivery' && item.state === 'open');
  const criticalExceptionCreated = critical?.consequence === 'critical';
  const pendingDecision = critical ? repo.getDecisionByAttention(projectId, critical.id) : undefined;
  const decisionPrepared = pendingDecision?.state === 'pending' && pendingDecision.decisionOwnerId === 'sponsor1';

  if (!pendingDecision) throw new Error('Expected a pending decision for the critical QA exception.');
  service.decide(projectId, pendingDecision.id, 'sponsor1', 'Add temporary QA capacity and protect the launch gate', 'selected', 'Material launch exposure warrants temporary recovery capacity.');
  service.addSupportOwner(projectId, 'A30', 'qalead', 'pm1');
  const decisionCompleted = repo.listDecisions(projectId).find((d) => d.id === pendingDecision.id)?.state === 'selected';
  const followThrough = critical ? repo.findOpenWorkAction(projectId, critical.id, 'corrective') : undefined;
  const decisionFollowThroughCreated = Boolean(followThrough && followThrough.ownerId === 'qa1');

  setTime('2026-10-02T18:00:00.000Z');
  service.applySourceActivityUpdate(projectId, 'A30', 'qa:portal', { status: 'done', actualFinish: '2026-10-02', forecastFinish: '2026-10-02', blocker: null, evidenceRefs: ['qa:test-exit:passed'] }, 'qa:event:exit');
  const resolvedCycle = await coordinator.run(projectId);
  const resolvedAttention = critical ? repo.getAttention(critical.id) : undefined;
  const exceptionAutoResolved = resolvedAttention?.state === 'resolved';
  const correctiveActionClosedOnProof = followThrough ? repo.listWorkActions(projectId).find((a) => a.id === followThrough.id)?.state === 'done' : false;

  service.createHandoff(projectId, 'qa1', { id: 'H2', projectId, sourceActivityId: 'A30', targetActivityId: 'A40', senderId: 'qa1', receiverId: 'productlead', deliverableVersion: 'test-exit-1', state: 'ready', requiredChecksPassed: 4, requiredChecksTotal: 4, blockingConditions: [], nonBlockingConditions: [], attempt: 1 });
  await coordinator.run(projectId);
  service.respondToHandoff(projectId, 'H2', 'productlead', { state: 'accepted' });

  setTime('2026-10-06T18:00:00.000Z');
  service.updateActivity(projectId, 'A40', 'productlead', { status: 'done', actualStart: '2026-10-03', actualFinish: '2026-10-06', evidenceRefs: ['uat:acceptance:customer'] });
  setTime('2026-10-10T18:00:00.000Z');
  service.applySourceActivityUpdate(projectId, 'A50', 'cicd:portal', { status: 'done', actualStart: '2026-10-07', actualFinish: '2026-10-10', evidenceRefs: ['cicd:release:prod-1'] }, 'cicd:event:prod');
  service.configureProject(projectId, 'pm1', { eac: 98000, forecastFinish: '2026-10-10' });
  await coordinator.run(projectId);
  service.transitionProject(projectId, 'pm1', 'closing');
  service.transitionProject(projectId, 'pm1', 'closed');

  const traceability = calculateTraceabilitySnapshot(repo, projectId);
  let appendOnlyAuditEnforced = false;
  const firstEvent = repo.listEvents(projectId)[0];
  if (firstEvent) {
    try { repo.db.prepare('UPDATE pc_project_events SET reason=? WHERE id=?').run('tamper', firstEvent.id); }
    catch { appendOnlyAuditEnforced = true; }
  }
  const final = repo.getProject(projectId)!;
  const reportSnapshots = repo.listProjections(projectId).length;
  const auditEvents = repo.listEvents(projectId).length;
  const workflowPass = final.lifecycle === 'closed' && initialCycle.cycle.suppressedAsNoMaterialChange && handoffAttentionCreated && criticalExceptionCreated && decisionPrepared && decisionCompleted &&
    decisionFollowThroughCreated && exceptionAutoResolved && correctiveActionClosedOnProof && traceability.pass && appendOnlyAuditEnforced && reportSnapshots >= 3 && auditEvents > 20 && resolvedCycle.traceability.pass;

  return {
    projectId,
    projectName: final.name,
    finalLifecycle: final.lifecycle,
    baselineActivities: repo.listActivities(projectId).length,
    dependencies: repo.listDependencies(projectId).length,
    roleVisibility,
    initialCycleSuppressed: initialCycle.cycle.suppressedAsNoMaterialChange,
    handoffAttentionCreated,
    criticalExceptionCreated,
    decisionPrepared,
    decisionCompleted,
    decisionFollowThroughCreated,
    exceptionAutoResolved,
    correctiveActionClosedOnProof,
    reportSnapshots,
    auditEvents,
    auditChainIntegrity: repo.verifyEventChain(projectId),
    traceability,
    appendOnlyAuditEnforced,
    workflowPass,
  };
}
