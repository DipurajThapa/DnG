import { SqlProjectRepository } from '../project/sqlite-repository.js';

export interface CoverageMetric {
  numerator: number;
  denominator: number;
  percent: number | null;
  pass: boolean;
}

export interface TraceabilitySnapshot {
  projectId: string;
  ownershipCoverage: CoverageMetric;
  assignmentConsistency: CoverageMetric;
  dependencyIntegrity: CoverageMetric;
  sourceLineageCoverage: CoverageMetric;
  attentionOwnership: CoverageMetric;
  decisionLinkage: CoverageMetric;
  handoffLinkage: CoverageMetric;
  auditChainIntegrity: boolean;
  orphanRecords: readonly string[];
  totalAuditEvents: number;
  totalActivities: number;
  totalAssignments: number;
  totalDecisions: number;
  totalHandoffs: number;
  totalAttention: number;
  pass: boolean;
}

function metric(numerator: number, denominator: number, emptyPass = true): CoverageMetric {
  const percent = denominator > 0 ? numerator / denominator * 100 : null;
  return { numerator, denominator, percent, pass: denominator === 0 ? emptyPass : numerator === denominator };
}

export function calculateTraceabilitySnapshot(repo: SqlProjectRepository, projectId: string): TraceabilitySnapshot {
  const project = repo.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found.`);
  const members = repo.listMembers(projectId);
  const activeMemberIds = new Set(members.filter((m) => m.active).map((m) => m.userId));
  const activities = repo.listActivities(projectId);
  const dependencies = repo.listDependencies(projectId);
  const assignments = repo.listAssignments(projectId);
  const activeAssignments = assignments.filter((a) => !a.endedAt);
  const attention = repo.listAttention(projectId);
  const decisions = repo.listDecisions(projectId);
  const handoffs = repo.listHandoffs(projectId);
  const actions = repo.listWorkActions(projectId);
  const activityIds = new Set(activities.map((a) => a.id));
  const attentionIds = new Set(attention.map((a) => a.id));
  const orphans: string[] = [];

  const executable = activities.filter((a) => a.status !== 'cancelled');
  const owned = executable.filter((a) => a.ownerId && activeMemberIds.has(a.ownerId));
  const ownershipCoverage = metric(owned.length, executable.length);

  const consistentAssignments = executable.filter((activity) => {
    if (!activity.ownerId) return false;
    const current = activeAssignments.find((assignment) => assignment.activityId === activity.id);
    return current?.assigneeId === activity.ownerId && activeMemberIds.has(current.assigneeId);
  });
  const assignmentConsistency = metric(consistentAssignments.length, executable.length);

  let dependencyGood = 0;
  for (const dep of dependencies) {
    const good = activityIds.has(dep.predecessorActivityId) && activityIds.has(dep.successorActivityId) && dep.predecessorActivityId !== dep.successorActivityId;
    if (good) dependencyGood += 1; else orphans.push(`dependency:${dep.id}`);
  }
  const dependencyIntegrity = metric(dependencyGood, dependencies.length);

  const sourceBacked = activities.filter((a) => a.sourceSystem !== undefined);
  const sourceLinked = sourceBacked.filter((a) => Boolean(a.sourceRef) || a.evidenceRefs.length > 0);
  const sourceLineageCoverage = metric(sourceLinked.length, sourceBacked.length);

  const openAttention = attention.filter((a) => a.state === 'open' || a.state === 'waiting');
  const attentionOwned = openAttention.filter((item) => {
    const required = item.nextAction === 'decide' || item.nextAction === 'approve' || item.nextAction === 'accept'
      ? item.decisionOwnerId ?? item.ownerId
      : item.ownerId ?? item.decisionOwnerId;
    return Boolean(required && activeMemberIds.has(required));
  });
  const attentionOwnership = metric(attentionOwned.length, openAttention.length);

  let decisionGood = 0;
  for (const decision of decisions) {
    const good = attentionIds.has(decision.attentionItemId) && activeMemberIds.has(decision.decisionOwnerId);
    if (good) decisionGood += 1; else orphans.push(`decision:${decision.id}`);
  }
  const decisionLinkage = metric(decisionGood, decisions.length);

  let handoffGood = 0;
  for (const handoff of handoffs) {
    const good = activityIds.has(handoff.sourceActivityId) && activityIds.has(handoff.targetActivityId) && activeMemberIds.has(handoff.senderId) && activeMemberIds.has(handoff.receiverId);
    if (good) handoffGood += 1; else orphans.push(`handoff:${handoff.id}`);
  }
  const handoffLinkage = metric(handoffGood, handoffs.length);

  for (const assignment of activeAssignments) {
    if (!activityIds.has(assignment.activityId) || !activeMemberIds.has(assignment.assigneeId)) orphans.push(`assignment:${assignment.id}`);
    for (const support of assignment.supportOwnerIds) if (!activeMemberIds.has(support)) orphans.push(`assignment-support:${assignment.id}:${support}`);
  }
  for (const action of actions) {
    if (!activeMemberIds.has(action.ownerId)) orphans.push(`work-action:${action.id}`);
    if (action.attentionItemId && !attentionIds.has(action.attentionItemId)) orphans.push(`work-action-attention:${action.id}`);
    if (action.activityId && !activityIds.has(action.activityId)) orphans.push(`work-action-activity:${action.id}`);
  }

  const auditChainIntegrity = repo.verifyEventChain(projectId);
  const requiredMetrics = [ownershipCoverage, assignmentConsistency, dependencyIntegrity, sourceLineageCoverage, attentionOwnership, decisionLinkage, handoffLinkage];
  return {
    projectId,
    ownershipCoverage,
    assignmentConsistency,
    dependencyIntegrity,
    sourceLineageCoverage,
    attentionOwnership,
    decisionLinkage,
    handoffLinkage,
    auditChainIntegrity,
    orphanRecords: [...new Set(orphans)],
    totalAuditEvents: repo.listEvents(projectId).length,
    totalActivities: activities.length,
    totalAssignments: assignments.length,
    totalDecisions: decisions.length,
    totalHandoffs: handoffs.length,
    totalAttention: attention.length,
    pass: auditChainIntegrity && orphans.length === 0 && requiredMetrics.every((x) => x.pass),
  };
}
