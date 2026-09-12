import type { ProjectSignal } from '../control/types.js';
import { SqlProjectRepository } from './sqlite-repository.js';

function daysBetween(a: string, b: string): number | null {
  const x = Date.parse(a); const y = Date.parse(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.round((y - x) / 86_400_000);
}

function slipConsequence(days: number, milestone: boolean): ProjectSignal['consequence'] {
  if (days >= 14 || (milestone && days >= 8)) return 'critical';
  if (days >= 5 || (milestone && days >= 3)) return 'high';
  return 'medium';
}

export function detectProjectSignals(repo: SqlProjectRepository, projectId: string, now: Date = new Date()): readonly ProjectSignal[] {
  const project = repo.getProject(projectId);
  if (!project) return [];
  const signals: ProjectSignal[] = [];
  const activities = repo.listActivities(projectId);
  const dependencies = repo.listDependencies(projectId);
  const handoffs = repo.listHandoffs(projectId);
  const sourceRefs = repo.listSources(projectId);
  const nowIso = now.toISOString();

  for (const activity of activities) {
    if (activity.status === 'cancelled') continue;
    const refs = [...new Set([...(activity.sourceRef ? [activity.sourceRef] : []), ...activity.evidenceRefs])];
    const confidence: ProjectSignal['confidence'] = refs.length > 0 ? 'high' : 'medium';

    if (!activity.ownerId && activity.status !== 'done') {
      signals.push({
        signalId: `ownership:${activity.id}:${activity.revision}`,
        organisationId: project.organisationId,
        projectId,
        kind: 'resource',
        rootCauseKey: `activity:${activity.id}:ownership`,
        title: `${activity.title} has no accountable owner`,
        observedAt: nowIso,
        consequence: activity.priority === 'critical' ? 'critical' : 'high',
        confidence: 'high',
        material: true,
        situation: 'Executable project work has no current accountable owner.',
        impact: 'Progress, escalation and handoff responsibility are ambiguous until ownership is assigned.',
        decisionOwnerId: project.pmId,
        ...((activity.baselineStart ?? activity.baselineFinish) ? { dueAt: activity.baselineStart ?? activity.baselineFinish! } : {}),
        sourceRefs: refs,
        suggestedAction: 'assign',
        metadata: { activityId: activity.id },
      });
    }

    if (activity.status === 'blocked') {
      signals.push({
        signalId: `blocked:${activity.id}:${activity.revision}`,
        organisationId: project.organisationId,
        projectId,
        kind: 'issue',
        rootCauseKey: `activity:${activity.id}:delivery`,
        title: `${activity.title} is blocked`,
        observedAt: nowIso,
        consequence: activity.priority === 'critical' ? 'critical' : activity.priority === 'high' ? 'high' : 'medium',
        confidence,
        material: true,
        situation: activity.blocker ?? 'The activity is blocked.',
        impact: activity.milestone ? 'A project milestone cannot progress until the blocker is resolved.' : 'Dependent project work may be delayed.',
        ...(activity.ownerId ? { ownerId: activity.ownerId } : {}),
        decisionOwnerId: project.pmId,
        ...((activity.forecastFinish ?? activity.baselineFinish) ? { dueAt: activity.forecastFinish ?? activity.baselineFinish! } : {}),
        sourceRefs: refs,
        suggestedAction: 'resolve',
        metadata: { activityId: activity.id },
      });
    }

    if (activity.baselineFinish && activity.forecastFinish && activity.status !== 'done') {
      const slip = daysBetween(activity.baselineFinish, activity.forecastFinish);
      if (slip !== null && slip > 0) {
        const consequence = slipConsequence(slip, activity.milestone);
        signals.push({
          signalId: `slip:${activity.id}:${activity.revision}`,
          organisationId: project.organisationId,
          projectId,
          kind: 'schedule',
          rootCauseKey: `activity:${activity.id}:delivery`,
          title: `${activity.title} forecast moved by ${slip} day${slip === 1 ? '' : 's'}`,
          observedAt: nowIso,
          consequence,
          confidence,
          material: consequence !== 'low',
          situation: `Forecast finish ${activity.forecastFinish} is later than baseline ${activity.baselineFinish}.`,
          impact: activity.milestone ? 'The milestone forecast has moved beyond its approved baseline.' : 'Downstream activities may need re-sequencing or recovery action.',
          ...(activity.ownerId ? { ownerId: activity.ownerId } : {}),
          decisionOwnerId: consequence === 'critical' && project.sponsorId ? project.sponsorId : project.pmId,
          dueAt: activity.baselineFinish,
          sourceRefs: refs,
          suggestedAction: consequence === 'critical' || consequence === 'high' ? 'decide' : 'resolve',
          metadata: { activityId: activity.id, slipDays: slip },
        });
      }
    }

    if (activity.baselineFinish && Date.parse(activity.baselineFinish) < now.getTime() && activity.status !== 'done') {
      const overdueDays = Math.max(1, Math.round((now.getTime() - Date.parse(activity.baselineFinish)) / 86_400_000));
      signals.push({
        signalId: `overdue:${activity.id}:${activity.revision}`,
        organisationId: project.organisationId,
        projectId,
        kind: 'schedule',
        rootCauseKey: `activity:${activity.id}:delivery`,
        title: `${activity.title} is overdue`,
        observedAt: nowIso,
        consequence: slipConsequence(overdueDays, activity.milestone),
        confidence,
        material: true,
        situation: `The baseline finish date passed ${overdueDays} day${overdueDays === 1 ? '' : 's'} ago and the activity is not complete.`,
        impact: 'The project needs an updated forecast or recovery action.',
        ...(activity.ownerId ? { ownerId: activity.ownerId } : {}),
        decisionOwnerId: project.pmId,
        dueAt: activity.baselineFinish,
        sourceRefs: refs,
        suggestedAction: 'decide',
        metadata: { activityId: activity.id, overdueDays },
      });
    }
  }

  for (const dependency of dependencies.filter((d) => d.mandatory)) {
    const predecessor = activities.find((a) => a.id === dependency.predecessorActivityId);
    const successor = activities.find((a) => a.id === dependency.successorActivityId);
    if (!predecessor || !successor || successor.status === 'cancelled') continue;
    const gateSatisfied = dependency.gateType === 'finish-to-start'
      ? predecessor.status === 'done'
      : handoffs.some((h) => h.sourceActivityId === predecessor.id && h.targetActivityId === successor.id && h.state === 'accepted');
    const successorStarted = successor.status === 'in-progress' || successor.status === 'blocked' || successor.status === 'done';
    const plannedStartReached = successor.baselineStart ? Date.parse(successor.baselineStart) <= now.getTime() : false;
    if (!gateSatisfied && (successorStarted || plannedStartReached)) {
      signals.push({
        signalId: `dependency:${dependency.id}:${predecessor.revision}:${successor.revision}`,
        organisationId: project.organisationId,
        projectId,
        kind: 'dependency',
        rootCauseKey: `dependency:${dependency.id}`,
        title: `Dependency gate is not satisfied for ${successor.title}`,
        observedAt: nowIso,
        consequence: successor.milestone || successor.priority === 'critical' ? 'high' : 'medium',
        confidence: 'high',
        material: true,
        situation: `${predecessor.title} has not satisfied the required ${dependency.gateType} gate.`,
        impact: successorStarted ? 'Downstream work has started before a mandatory gate was satisfied.' : 'The successor cannot safely start on its planned date.',
        ...(successor.ownerId ? { ownerId: successor.ownerId } : {}),
        decisionOwnerId: project.pmId,
        ...(successor.baselineStart ? { dueAt: successor.baselineStart } : {}),
        sourceRefs: [...new Set([...predecessor.evidenceRefs, ...successor.evidenceRefs])],
        suggestedAction: successorStarted ? 'correct' : 'resolve',
        metadata: { dependencyId: dependency.id, predecessorId: predecessor.id, successorId: successor.id },
      });
    }
  }

  for (const handoff of handoffs.filter((h) => h.state === 'ready')) {
    signals.push({
      signalId: `handoff:${handoff.id}:${handoff.revision}`,
      organisationId: project.organisationId,
      projectId,
      kind: 'handoff',
      rootCauseKey: `handoff:${handoff.id}`,
      title: 'Deliverable is waiting for receiving-team acceptance',
      observedAt: nowIso,
      consequence: handoff.blockingConditions.length > 0 ? 'high' : 'medium',
      confidence: 'high',
      material: true,
      situation: `Handoff ${handoff.id} is ready for ${handoff.receiverId}.`,
      impact: 'The receiving activity remains gated until the accountable receiver accepts or returns the deliverable.',
      ownerId: handoff.receiverId,
      decisionOwnerId: handoff.receiverId,
      sourceRefs: [],
      suggestedAction: 'accept',
      metadata: { handoffId: handoff.id, sourceActivityId: handoff.sourceActivityId, targetActivityId: handoff.targetActivityId },
    });
  }

  if (project.budget !== undefined && project.eac !== undefined && project.eac > project.budget) {
    const over = project.eac - project.budget;
    const pct = over / Math.max(Math.abs(project.budget), 1) * 100;
    signals.push({
      signalId: `budget:${project.id}:${project.revision}`,
      organisationId: project.organisationId,
      projectId,
      kind: 'budget',
      rootCauseKey: `project:${project.id}:budget`,
      title: `Forecast cost is ${pct.toFixed(1)}% above approved budget`,
      observedAt: nowIso,
      consequence: pct >= 10 ? 'critical' : pct >= 5 ? 'high' : 'medium',
      confidence: project.evidenceConfidence,
      material: true,
      situation: `EAC ${project.eac} ${project.currency ?? ''} exceeds budget ${project.budget} ${project.currency ?? ''}.`,
      impact: 'Management needs a cost recovery, scope, funding or acceptance decision before the variance grows.',
      ownerId: project.pmId,
      decisionOwnerId: project.sponsorId ?? project.pmId,
      ...(project.forecastFinish ? { dueAt: project.forecastFinish } : {}),
      sourceRefs: sourceRefs.filter((s) => /finance|budget|erp/i.test(`${s.sourceType} ${s.authority}`)).map((s) => s.sourceRef),
      suggestedAction: 'decide',
      metadata: { overBudget: over, overBudgetPercent: pct },
    });
  }

  for (const source of sourceRefs.filter((s) => s.status === 'stale' || s.status === 'unavailable')) {
    signals.push({
      signalId: `source:${source.id}:${source.revision}`,
      organisationId: project.organisationId,
      projectId,
      kind: 'source-health',
      rootCauseKey: `source:${source.id}:health`,
      title: `${source.sourceType} source is ${source.status}`,
      observedAt: nowIso,
      consequence: /schedule|finance|acceptance|quality/i.test(source.authority) ? 'high' : 'medium',
      confidence: 'high',
      material: true,
      situation: `Authoritative source ${source.sourceRef} is ${source.status}.`,
      impact: 'Affected conclusions must retain last-known state and visibly reduce evidence confidence until the source recovers.',
      decisionOwnerId: project.pmId,
      sourceRefs: [source.sourceRef],
      suggestedAction: 'correct',
      metadata: { sourceId: source.id, authority: source.authority },
    });
  }

  return signals;
}
