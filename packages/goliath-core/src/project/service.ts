import { randomUUID } from 'node:crypto';
import { GoliathError } from '../core/errors.js';
import { digest } from '../core/hash.js';
import { decideHandoff } from '../workflow/handoff.js';
import { evaluateMinimumReadiness } from '../workflow/readiness.js';
import { effectivePermissions } from './permissions.js';
import type {
  ActivityCreateInput,
  ActivityRecord,
  AssignmentRecord,
  DecisionRecord,
  DependencyRecord,
  HandoffRecord,
  ProjectCreateInput,
  ProjectLifecycle,
  ProjectMember,
  ProjectPermission,
  ProjectRecord,
  SourceStateRecord,
  WorkActionRecord,
} from './types.js';
import { SqlProjectRepository } from './sqlite-repository.js';

export interface ActivityProgressUpdate {
  status?: ActivityRecord['status'];
  forecastFinish?: string;
  actualStart?: string;
  actualFinish?: string;
  percentComplete?: number;
  blocker?: string | null;
  evidenceRefs?: readonly string[];
}

export interface ProjectSetupUpdate {
  baselineVersion?: string;
  baselineAccepted?: boolean;
  materialOutcomesConfirmed?: boolean;
  firstWorkReady?: boolean;
  requiredTeamLeadsAssigned?: boolean;
  legitimateEvidenceSourceAvailable?: boolean;
  forecastFinish?: string;
  eac?: number;
  evidenceConfidence?: ProjectRecord['evidenceConfidence'];
  sourceHealthSummary?: string;
}

export interface AuthorizedProjectActor {
  userId: string;
  teamId?: string;
  permissions: readonly ProjectPermission[];
}

function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }

function ensureDate(value: string | undefined, label: string): void {
  if (value !== undefined && !Number.isFinite(Date.parse(value))) throw new GoliathError('INVALID_INPUT', `${label} is not a valid date.`);
}

function ensurePercent(value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100)) throw new GoliathError('INVALID_INPUT', 'Percent complete must be between 0 and 100.');
}

export class ProjectControlService {
  constructor(private readonly repo: SqlProjectRepository, private readonly now: () => Date = () => new Date()) {}

  createProject(input: ProjectCreateInput, initialMembers: readonly ProjectMember[], actorId: string): ProjectRecord {
    ensureDate(input.baselineFinish, 'Baseline finish');
    if (!input.id.trim() || !input.organisationId.trim() || !input.code.trim() || !input.name.trim() || !input.pmId.trim()) {
      throw new GoliathError('INVALID_INPUT', 'Project identity, organisation, code, name and Project Manager are required.');
    }
    if (this.repo.getProject(input.id)) throw new GoliathError('INVALID_INPUT', `Project ${input.id} already exists.`);
    const pm = initialMembers.find((m) => m.userId === input.pmId && m.role === 'project-manager' && m.active);
    if (!pm) throw new GoliathError('INVALID_INPUT', 'The named Project Manager must be an active initial project member.');
    if (input.sponsorId && !initialMembers.some((m) => m.userId === input.sponsorId && m.active)) {
      throw new GoliathError('INVALID_INPUT', 'The named sponsor must be an active initial project member.');
    }
    if (initialMembers.some((m) => m.projectId !== input.id)) throw new GoliathError('INVALID_INPUT', 'All initial members must belong to the new project.');

    const at = this.now().toISOString();
    const project: ProjectRecord = {
      id: input.id,
      organisationId: input.organisationId,
      code: input.code,
      name: input.name,
      lifecycle: 'draft',
      pmId: input.pmId,
      ...(input.sponsorId ? { sponsorId: input.sponsorId } : {}),
      timezone: input.timezone,
      baselineAccepted: false,
      materialOutcomesConfirmed: false,
      firstWorkReady: false,
      requiredTeamLeadsAssigned: false,
      legitimateEvidenceSourceAvailable: false,
      ...(input.baselineFinish ? { baselineFinish: input.baselineFinish, forecastFinish: input.baselineFinish } : {}),
      ...(input.budget !== undefined ? { budget: input.budget, eac: 0 } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      evidenceConfidence: 'unknown',
      sourceHealthSummary: 'Sources not yet configured',
      createdAt: at,
      updatedAt: at,
      revision: 1,
    };

    this.repo.transaction(() => {
      this.repo.insertProject(project);
      for (const member of initialMembers) this.repo.upsertMember(member);
      this.repo.appendEvent({
        id: randomUUID(), projectId: project.id, actorId, eventType: 'project.created', entityType: 'project', entityId: project.id,
        result: 'allowed', reason: 'New project created with explicit PM and initial scoped membership.', occurredAt: at,
        correlationId: `create:${project.id}`, afterRevision: 1, sourceRefs: [], metadata: { memberCount: initialMembers.length },
      });
    });
    return project;
  }

  addOrUpdateMember(projectId: string, actorId: string, member: ProjectMember): void {
    const actor = this.requireMember(projectId, actorId);
    this.requireAnyPermission(actor, ['project:transition', 'admin:policy']);
    if (member.projectId !== projectId) throw new GoliathError('INVALID_INPUT', 'Membership cannot be written across projects.');
    const at = this.now().toISOString();
    this.repo.transaction(() => {
      this.repo.upsertMember(member);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'membership.updated', entityType: 'member', entityId: member.userId,
        result: 'allowed', reason: 'Scoped project membership updated.', occurredAt: at, correlationId: `member:${projectId}:${member.userId}:${at}`,
        sourceRefs: [], metadata: { role: member.role, active: member.active } });
    });
  }

  importPlan(projectId: string, actorId: string, activities: readonly ActivityCreateInput[], dependencies: readonly DependencyRecord[]): void {
    const actor = this.requireMember(projectId, actorId);
    this.requirePermission(actor, 'plan:edit');
    if (activities.length === 0) throw new GoliathError('INVALID_INPUT', 'A project plan needs at least one activity.');
    const ids = new Set<string>();
    for (const activity of activities) {
      if (activity.projectId !== projectId) throw new GoliathError('INVALID_INPUT', 'Plan activity belongs to a different project.');
      if (!activity.id.trim() || ids.has(activity.id)) throw new GoliathError('INVALID_INPUT', `Duplicate or missing activity id ${activity.id}.`);
      ids.add(activity.id);
      ensureDate(activity.baselineStart, 'Baseline start'); ensureDate(activity.baselineFinish, 'Baseline finish'); ensureDate(activity.forecastFinish, 'Forecast finish');
      if (activity.baselineStart && activity.baselineFinish && Date.parse(activity.baselineStart) > Date.parse(activity.baselineFinish)) throw new GoliathError('INVALID_INPUT', `Activity ${activity.id} starts after it finishes.`);
    }
    for (const dep of dependencies) {
      if (dep.projectId !== projectId || !ids.has(dep.predecessorActivityId) || !ids.has(dep.successorActivityId)) throw new GoliathError('INVALID_INPUT', `Dependency ${dep.id} references an activity outside this plan.`);
    }
    this.assertAcyclic(activities.map((x) => x.id), dependencies);
    const at = this.now().toISOString();
    this.repo.transaction(() => {
      for (const input of activities) this.repo.insertActivity({ ...input, evidenceRefs: input.evidenceRefs ?? [], revision: 1 });
      for (const dep of dependencies) this.repo.insertDependency(dep);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'plan.imported', entityType: 'project', entityId: projectId,
        result: 'allowed', reason: 'Initial plan imported with stable activity identities and validated dependencies.', occurredAt: at,
        correlationId: `plan:${projectId}:${at}`, sourceRefs: unique(activities.flatMap((a) => a.sourceRef ? [a.sourceRef] : [])),
        metadata: { activities: activities.length, dependencies: dependencies.length } });
    });
  }

  configureProject(projectId: string, actorId: string, update: ProjectSetupUpdate): ProjectRecord {
    const actor = this.requireMember(projectId, actorId);
    this.requireAnyPermission(actor, ['plan:edit', 'project:transition']);
    const current = this.requireProject(projectId);
    if (current.lifecycle === 'closed') throw new GoliathError('ACTION_NOT_ALLOWED', 'A closed project must be reopened before its control settings change.');
    ensureDate(update.forecastFinish, 'Forecast finish');
    const next: ProjectRecord = {
      ...current,
      ...(update.baselineVersion !== undefined ? { baselineVersion: update.baselineVersion } : {}),
      ...(update.baselineAccepted !== undefined ? { baselineAccepted: update.baselineAccepted } : {}),
      ...(update.materialOutcomesConfirmed !== undefined ? { materialOutcomesConfirmed: update.materialOutcomesConfirmed } : {}),
      ...(update.firstWorkReady !== undefined ? { firstWorkReady: update.firstWorkReady } : {}),
      ...(update.requiredTeamLeadsAssigned !== undefined ? { requiredTeamLeadsAssigned: update.requiredTeamLeadsAssigned } : {}),
      ...(update.legitimateEvidenceSourceAvailable !== undefined ? { legitimateEvidenceSourceAvailable: update.legitimateEvidenceSourceAvailable } : {}),
      ...(update.forecastFinish !== undefined ? { forecastFinish: update.forecastFinish } : {}),
      ...(update.eac !== undefined ? { eac: update.eac } : {}),
      ...(update.evidenceConfidence !== undefined ? { evidenceConfidence: update.evidenceConfidence } : {}),
      ...(update.sourceHealthSummary !== undefined ? { sourceHealthSummary: update.sourceHealthSummary } : {}),
      updatedAt: this.now().toISOString(), revision: current.revision + 1,
    };
    this.repo.transaction(() => {
      this.repo.updateProject(next);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'project.control-configured', entityType: 'project', entityId: projectId,
        result: 'allowed', reason: 'Project control readiness/settings updated.', occurredAt: next.updatedAt, correlationId: `config:${projectId}:${next.revision}`,
        beforeRevision: current.revision, afterRevision: next.revision, sourceRefs: [], metadata: update as Record<string, unknown> });
    });
    return next;
  }

  reconcileSourceState(
    projectId: string,
    sourceRef: string,
    update: { status: SourceStateRecord['status']; lastObservedAt?: string; freshnessHours?: number },
    correlationId: string,
    actorId = 'system:integration',
  ): SourceStateRecord {
    const current = this.repo.listSources(projectId).find((source) => source.sourceRef === sourceRef);
    if (!current) throw new GoliathError('NOT_FOUND', 'Registered project source was not found.');
    if (update.lastObservedAt && !Number.isFinite(Date.parse(update.lastObservedAt))) throw new GoliathError('INVALID_INPUT', 'Source lastObservedAt must be a valid date/time.');
    if (update.freshnessHours !== undefined && (!Number.isFinite(update.freshnessHours) || update.freshnessHours < 0)) throw new GoliathError('INVALID_INPUT', 'Source freshnessHours must be non-negative.');
    const same = current.status === update.status
      && (update.lastObservedAt === undefined || current.lastObservedAt === update.lastObservedAt)
      && (update.freshnessHours === undefined || current.freshnessHours === update.freshnessHours);
    if (same) return current;
    const next: SourceStateRecord = {
      ...current, status: update.status,
      ...(update.lastObservedAt !== undefined ? { lastObservedAt: update.lastObservedAt } : {}),
      ...(update.freshnessHours !== undefined ? { freshnessHours: update.freshnessHours } : {}),
      revision: current.revision + 1,
    };
    const at = this.now().toISOString();
    this.repo.transaction(() => {
      this.repo.upsertSource(next);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'source.health-reconciled', entityType: 'source', entityId: current.id,
        result: 'recorded', reason: 'Authoritative source-health event reconciled into the project source state.', occurredAt: at, correlationId,
        beforeRevision: current.revision, afterRevision: next.revision, sourceRefs: [sourceRef], metadata: { previousStatus: current.status, status: next.status, lastObservedAt: next.lastObservedAt ?? null } });
    });
    return next;
  }

  registerSource(projectId: string, actorId: string, source: SourceStateRecord): void {
    const actor = this.requireMember(projectId, actorId);
    this.requireAnyPermission(actor, ['admin:integrations', 'plan:edit']);
    if (source.projectId !== projectId) throw new GoliathError('INVALID_INPUT', 'Source belongs to a different project.');
    const at = this.now().toISOString();
    this.repo.transaction(() => {
      this.repo.upsertSource(source);
      const project = this.requireProject(projectId);
      const sources = [...this.repo.listSources(projectId), source].filter((s, i, all) => all.findIndex((x) => x.sourceRef === s.sourceRef) === i);
      const currentSources = sources.filter((s) => s.status === 'current');
      const next: ProjectRecord = { ...project, legitimateEvidenceSourceAvailable: currentSources.length > 0,
        sourceHealthSummary: currentSources.length === sources.length ? `All ${sources.length} registered source${sources.length === 1 ? '' : 's'} current` : `${currentSources.length}/${sources.length} sources current`,
        evidenceConfidence: currentSources.length > 0 ? project.evidenceConfidence : 'unknown', updatedAt: at, revision: project.revision + 1 };
      this.repo.updateProject(next);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'source.registered', entityType: 'source', entityId: source.id,
        result: 'allowed', reason: 'Project evidence source registered or refreshed.', occurredAt: at, correlationId: `source:${projectId}:${source.id}:${source.revision}`,
        sourceRefs: [source.sourceRef], metadata: { status: source.status, authority: source.authority } });
    });
  }

  refreshDerivedProjectState(projectId: string, actorId = 'system:control'): ProjectRecord {
    const current = this.requireProject(projectId);
    const activities = this.repo.listActivities(projectId).filter((activity) => activity.status !== 'cancelled');
    const dependencies = this.repo.listDependencies(projectId).filter((dependency) => dependency.mandatory);
    const members = this.repo.listMembers(projectId).filter((member) => member.active);
    const sources = this.repo.listSources(projectId);
    const teams = unique(activities.map((activity) => activity.currentTeamId ?? activity.plannedTeamId).filter((team): team is string => Boolean(team)));
    const requiredTeamLeadsAssigned = teams.every((team) => members.some((member) => member.role === 'delivery-lead' && member.teamId === team));
    const predecessorIds = new Set(dependencies.map((dependency) => dependency.successorActivityId));
    const firstWorkReady = activities.some((activity) => activity.status !== 'done' && !predecessorIds.has(activity.id));
    const currentSources = sources.filter((source) => source.status === 'current');
    const legitimateEvidenceSourceAvailable = currentSources.length > 0;
    const sourceHealthSummary = sources.length === 0 ? 'No source state recorded' : currentSources.length === sources.length
      ? `All ${sources.length} registered source${sources.length === 1 ? '' : 's'} current`
      : `${currentSources.length}/${sources.length} sources current`;
    const evidenceConfidence: ProjectRecord['evidenceConfidence'] = sources.length === 0 ? 'unknown'
      : sources.some((source) => source.status === 'unavailable') ? 'low'
      : sources.some((source) => source.status === 'stale') ? 'medium'
      : 'high';
    const forecastDates = activities.map((activity) => activity.forecastFinish ?? activity.baselineFinish).filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)));
    const forecastFinish = forecastDates.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
    const changed = requiredTeamLeadsAssigned !== current.requiredTeamLeadsAssigned || firstWorkReady !== current.firstWorkReady ||
      legitimateEvidenceSourceAvailable !== current.legitimateEvidenceSourceAvailable || sourceHealthSummary !== current.sourceHealthSummary ||
      evidenceConfidence !== current.evidenceConfidence || forecastFinish !== current.forecastFinish;
    if (!changed) return current;
    const at = this.now().toISOString();
    const next: ProjectRecord = { ...current, requiredTeamLeadsAssigned, firstWorkReady, legitimateEvidenceSourceAvailable, sourceHealthSummary,
      evidenceConfidence, ...(forecastFinish ? { forecastFinish } : {}), updatedAt: at, revision: current.revision + 1 };
    this.repo.transaction(() => {
      this.repo.updateProject(next);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'project.derived-state-refreshed', entityType: 'project', entityId: projectId,
        result: 'recorded', reason: 'Project readiness, source health and forecast orientation recomputed from current governed records.', occurredAt: at,
        correlationId: `derive:${projectId}:${next.revision}`, beforeRevision: current.revision, afterRevision: next.revision,
        sourceRefs: sources.map((source) => source.sourceRef), metadata: { requiredTeamLeadsAssigned, firstWorkReady, legitimateEvidenceSourceAvailable, sourceHealthSummary, evidenceConfidence, forecastFinish: forecastFinish ?? null } });
    });
    return next;
  }

  evaluateReadiness(projectId: string) {
    const project = this.requireProject(projectId);
    return evaluateMinimumReadiness({ projectId, pmAssigned: Boolean(project.pmId), baselineAccepted: project.baselineAccepted,
      executableWorkReady: project.firstWorkReady, materialCommitmentsDefined: project.materialOutcomesConfirmed,
      requiredTeamLeadsAssigned: project.requiredTeamLeadsAssigned, legitimateEvidenceSourceAvailable: project.legitimateEvidenceSourceAvailable });
  }

  transitionProject(projectId: string, actorId: string, target: ProjectLifecycle): ProjectRecord {
    const actor = this.requireMember(projectId, actorId);
    this.requirePermission(actor, 'project:transition');
    const current = this.requireProject(projectId);
    const allowed: Readonly<Record<ProjectLifecycle, readonly ProjectLifecycle[]>> = {
      draft: ['ready'], ready: ['active', 'draft'], active: ['on-hold', 'closing'], 'on-hold': ['active', 'closing'], closing: ['active', 'closed'], closed: ['active'],
    };
    if (!allowed[current.lifecycle].includes(target)) throw new GoliathError('ACTION_NOT_ALLOWED', `Cannot move project from ${current.lifecycle} to ${target}.`);
    if ((target === 'ready' || target === 'active') && !this.evaluateReadiness(projectId).ready) throw new GoliathError('APPROVAL_REQUIRED', 'Project minimum readiness is not satisfied.');
    if (target === 'closed') {
      const openActivities = this.repo.listActivities(projectId).filter((a) => a.status !== 'done' && a.status !== 'cancelled');
      const openAttention = this.repo.listAttention(projectId).filter((a) => a.state === 'open' || a.state === 'waiting');
      const openHandoffs = this.repo.listHandoffs(projectId).filter((h) => h.state === 'ready');
      if (openActivities.length || openAttention.length || openHandoffs.length) throw new GoliathError('APPROVAL_REQUIRED', 'Project closure still has unresolved activities, attention items or handoffs.');
    }
    const at = this.now().toISOString();
    const next: ProjectRecord = { ...current, lifecycle: target, updatedAt: at, revision: current.revision + 1 };
    this.repo.transaction(() => {
      this.repo.updateProject(next);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'project.transitioned', entityType: 'project', entityId: projectId,
        result: 'allowed', reason: `${current.lifecycle} → ${target}`, occurredAt: at, correlationId: `lifecycle:${projectId}:${next.revision}`,
        beforeRevision: current.revision, afterRevision: next.revision, sourceRefs: [] });
    });
    return next;
  }

  assignActivity(projectId: string, activityId: string, assigneeId: string, actorId: string, reason?: string, supportOwnerIds: readonly string[] = []): AssignmentRecord {
    const actor = this.requireMember(projectId, actorId);
    return this.assignActivityAuthorized(projectId, activityId, assigneeId, { userId:actor.userId, ...(actor.teamId?{teamId:actor.teamId}:{}), permissions:effectivePermissions(actor) }, reason, supportOwnerIds);
  }

  assignActivityAuthorized(projectId: string, activityId: string, assigneeId: string, actor: AuthorizedProjectActor, reason?: string, supportOwnerIds: readonly string[] = []): AssignmentRecord {
    const activity = this.requireActivity(projectId, activityId);
    const target = this.requireMember(projectId, assigneeId);
    if (!target.active) throw new GoliathError('ACCESS_DENIED', 'Cannot assign work to an inactive project member.');
    const canAll = actor.permissions.includes('activity:assign-all');
    const canTeam = actor.permissions.includes('activity:assign-team') && actor.teamId !== undefined && actor.teamId === (activity.currentTeamId ?? activity.plannedTeamId ?? target.teamId);
    if (!canAll && !canTeam) return this.denyAssignment(projectId, activityId, actor.userId, 'Actor does not have assignment authority for this activity.');
    const existing = this.repo.getActiveAssignment(activityId);
    if (existing && existing.assigneeId !== assigneeId && !reason?.trim()) throw new GoliathError('INVALID_INPUT', 'Reassignment needs a short reason so ownership history remains clear.');
    for (const supportId of supportOwnerIds) this.requireMember(projectId, supportId);
    const at = this.now().toISOString();
    const assignment: AssignmentRecord = {
      id: randomUUID(), projectId, activityId, assigneeId, ...(target.teamId ? { teamId: target.teamId } : {}), supportOwnerIds: unique(supportOwnerIds),
      assignedBy: actor.userId, effectiveFrom: at, ...(reason ? { reason } : {}), revision: 1,
    };
    const nextActivity: ActivityRecord = { ...activity, ownerId: assigneeId, ...(target.teamId ? { currentTeamId: target.teamId } : {}), revision: activity.revision + 1 };
    this.repo.transaction(() => {
      if (existing) this.repo.endActiveAssignment(activityId, at);
      this.repo.insertAssignment(assignment);
      this.repo.updateActivity(nextActivity);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId:actor.userId, eventType: existing ? 'activity.reassigned' : 'activity.assigned', entityType: 'assignment', entityId: assignment.id,
        result: 'allowed', reason: reason ?? 'Initial accountable owner assigned.', occurredAt: at, correlationId: `assign:${activityId}:${assignment.id}`,
        beforeRevision: activity.revision, afterRevision: nextActivity.revision, sourceRefs: activity.sourceRef ? [activity.sourceRef] : [],
        metadata: { activityId, previousOwner: existing?.assigneeId ?? null, assigneeId, supportOwnerIds: assignment.supportOwnerIds } });
    });
    return assignment;
  }

  addSupportOwner(projectId: string, activityId: string, supportOwnerId: string, actorId: string): AssignmentRecord {
    const actor = this.requireMember(projectId, actorId);
    const activity = this.requireActivity(projectId, activityId);
    const target = this.requireMember(projectId, supportOwnerId);
    const permissions = effectivePermissions(actor);
    const canAll = permissions.includes('activity:assign-all');
    const canTeam = permissions.includes('activity:assign-team') && actor.teamId !== undefined && actor.teamId === (activity.currentTeamId ?? activity.plannedTeamId);
    if (!canAll && !canTeam) throw new GoliathError('ACCESS_DENIED', 'Actor cannot add support ownership for this activity.');
    const assignment = this.repo.getActiveAssignment(activityId);
    if (!assignment) throw new GoliathError('NOT_FOUND', 'Assign the accountable owner before adding support owners.');
    const at = this.now().toISOString();
    const next: AssignmentRecord = { ...assignment, supportOwnerIds: unique([...assignment.supportOwnerIds, target.userId]), revision: assignment.revision + 1 };
    this.repo.transaction(() => {
      this.repo.updateAssignment(next);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'activity.support-owner-added', entityType: 'assignment', entityId: assignment.id,
        result: 'allowed', reason: 'Supporting owner added without changing accountability.', occurredAt: at, correlationId: `support:${assignment.id}:${target.userId}:${next.revision}`,
        beforeRevision: assignment.revision, afterRevision: next.revision, sourceRefs: [], metadata: { activityId, supportOwnerId } });
    });
    return next;
  }

  updateActivity(projectId: string, activityId: string, actorId: string, update: ActivityProgressUpdate): ActivityRecord {
    const actor = this.requireMember(projectId, actorId);
    return this.updateActivityAuthorized(projectId, activityId, { userId:actor.userId, ...(actor.teamId?{teamId:actor.teamId}:{}), permissions:effectivePermissions(actor) }, update);
  }

  updateActivityAuthorized(projectId: string, activityId: string, actor: AuthorizedProjectActor, update: ActivityProgressUpdate): ActivityRecord {
    const activity = this.requireActivity(projectId, activityId);
    this.assertAuthorizedActivityUpdate(actor, activity);
    return this.applyActivityUpdate(activity, actor.userId, update, `user:${actor.userId}`, `activity:${activityId}:${this.now().toISOString()}`);
  }

  applySourceActivityUpdate(projectId: string, activityId: string, sourceRef: string, update: ActivityProgressUpdate, correlationId: string): ActivityRecord {
    const activity = this.requireActivity(projectId, activityId);
    const source = this.repo.listSources(projectId).find((s) => s.sourceRef === sourceRef);
    if (!source || source.status !== 'current') throw new GoliathError('INTEGRATION_DISABLED', 'A current registered source is required before source facts can update project state.');
    return this.applyActivityUpdate(activity, 'system:integration', update, sourceRef, correlationId);
  }

  createHandoff(projectId: string, actorId: string, input: Omit<HandoffRecord, 'revision'>): HandoffRecord {
    const actor = this.requireMember(projectId, actorId);
    const source = this.requireActivity(projectId, input.sourceActivityId);
    this.requireActivity(projectId, input.targetActivityId);
    this.requireMember(projectId, input.receiverId);
    if (actorId !== input.senderId && !effectivePermissions(actor).includes('activity:update-all')) throw new GoliathError('ACCESS_DENIED', 'Only the sender or Project Manager can prepare this handoff.');
    if (source.status !== 'done') throw new GoliathError('APPROVAL_REQUIRED', 'Source activity must be complete before handoff.');
    if (input.projectId !== projectId) throw new GoliathError('INVALID_INPUT', 'Handoff belongs to another project.');
    const handoff: HandoffRecord = { ...input, revision: 1 };
    const at = this.now().toISOString();
    this.repo.transaction(() => {
      this.repo.insertHandoff(handoff);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'handoff.ready', entityType: 'handoff', entityId: handoff.id,
        result: 'allowed', reason: 'Completed deliverable submitted to the named receiving owner.', occurredAt: at, correlationId: `handoff:${handoff.id}:1`,
        sourceRefs: source.evidenceRefs, metadata: { sourceActivityId: source.id, targetActivityId: input.targetActivityId, receiverId: input.receiverId } });
    });
    return handoff;
  }

  respondToHandoff(projectId: string, handoffId: string, actorId: string, decision: { state: 'accepted' | 'returned'; reason?: string }): HandoffRecord {
    this.requireMember(projectId, actorId);
    const current = this.repo.getHandoff(handoffId);
    if (!current || current.projectId !== projectId) throw new GoliathError('NOT_FOUND', 'Handoff was not found in this project.');
    const nextBase = decideHandoff({ handoffId: current.id, projectId, deliverableVersion: current.deliverableVersion, senderId: current.senderId,
      receiverId: current.receiverId, requiredChecksPassed: current.requiredChecksPassed, requiredChecksTotal: current.requiredChecksTotal,
      blockingConditions: current.blockingConditions, nonBlockingConditions: current.nonBlockingConditions, state: current.state, attempt: current.attempt }, actorId, decision);
    const at = this.now().toISOString();
    const next: HandoffRecord = { ...current, state: nextBase.state, attempt: nextBase.attempt,
      ...(decision.state === 'returned' && decision.reason ? { returnedReason: decision.reason } : {}), ...(decision.state === 'accepted' ? { acceptedAt: at } : {}), revision: current.revision + 1 };
    this.repo.transaction(() => {
      this.repo.updateHandoff(next);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: decision.state === 'accepted' ? 'handoff.accepted' : 'handoff.returned', entityType: 'handoff', entityId: handoffId,
        result: 'allowed', reason: decision.reason ?? 'Receiving owner accepted the deliverable.', occurredAt: at, correlationId: `handoff:${handoffId}:${next.revision}`,
        beforeRevision: current.revision, afterRevision: next.revision, sourceRefs: [], metadata: { attempt: next.attempt } });
    });
    return next;
  }

  createPendingDecision(projectId: string, attentionItemId: string, decisionOwnerId: string, sourceRefs: readonly string[], actorId = 'system:autonomy'): DecisionRecord {
    const existing = this.repo.getDecisionByAttention(projectId, attentionItemId);
    if (existing) return existing;
    this.requireMember(projectId, decisionOwnerId);
    const at = this.now().toISOString();
    const decision: DecisionRecord = { id: randomUUID(), projectId, attentionItemId, decisionOwnerId, state: 'pending', evidenceRefs: unique(sourceRefs), createdAt: at, revision: 1 };
    this.repo.transaction(() => {
      this.repo.upsertDecision(decision);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'decision.prepared', entityType: 'decision', entityId: decision.id,
        result: 'recorded', reason: 'Decision brief prepared from a material attention item; authority remains human.', occurredAt: at,
        correlationId: `decision:${decision.id}:1`, sourceRefs: decision.evidenceRefs, metadata: { attentionItemId, decisionOwnerId } });
    });
    return decision;
  }

  decide(projectId: string, decisionId: string, actorId: string, choice: string, state: 'approved' | 'rejected' | 'selected', reason?: string): DecisionRecord {
    const actor = this.requireMember(projectId, actorId);
    return this.decideAuthorized(projectId, decisionId, { userId:actor.userId, ...(actor.teamId?{teamId:actor.teamId}:{}), permissions:effectivePermissions(actor) }, choice, state, reason);
  }

  decideAuthorized(projectId: string, decisionId: string, actor: AuthorizedProjectActor, choice: string, state: 'approved' | 'rejected' | 'selected', reason?: string): DecisionRecord {
    const actorId=actor.userId;
    const current = this.repo.listDecisions(projectId).find((d) => d.id === decisionId);
    if (!current) throw new GoliathError('NOT_FOUND', 'Decision not found.');
    if (current.state !== 'pending') throw new GoliathError('ACTION_NOT_ALLOWED', 'Decision has already been completed.');
    if (current.decisionOwnerId !== actorId || !actor.permissions.includes('decision:approve')) throw new GoliathError('ACCESS_DENIED', 'Only the named authorised decision owner can complete this decision.');
    if (!choice.trim()) throw new GoliathError('INVALID_INPUT', 'Decision choice is required.');
    const at = this.now().toISOString();
    const next: DecisionRecord = { ...current, decidedBy: actorId, state, choice, ...(reason?.trim() ? { reason } : {}), decidedAt: at, revision: current.revision + 1 };
    this.repo.transaction(() => {
      this.repo.upsertDecision(next);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'decision.completed', entityType: 'decision', entityId: decisionId,
        result: 'allowed', reason: reason ?? `Decision completed as ${state}.`, occurredAt: at, correlationId: `decision:${decisionId}:${next.revision}`,
        beforeRevision: current.revision, afterRevision: next.revision, sourceRefs: next.evidenceRefs, metadata: { state, choice } });
      if (state === 'approved' || state === 'selected') {
        const attention = this.repo.getAttention(current.attentionItemId);
        const ownerId = attention?.ownerId ?? this.requireProject(projectId).pmId;
        if (attention && !this.repo.findOpenWorkAction(projectId, attention.id, 'corrective')) {
          const action: WorkActionRecord = {
            id: randomUUID(), projectId, attentionItemId: attention.id, type: 'corrective', title: `Implement decision: ${choice}`,
            ownerId, ...(attention.dueAt ? { dueAt: attention.dueAt } : {}), state: 'open', createdBy: 'system:decision-follow-through',
            createdAt: at, sourceRefs: unique([...attention.sourceRefs, ...next.evidenceRefs]), revision: 1,
          };
          this.repo.insertWorkAction(action);
          this.repo.appendEvent({ id: randomUUID(), projectId, actorId: 'system:decision-follow-through', eventType: 'work-action.created', entityType: 'work-action', entityId: action.id,
            result: 'recorded', reason: 'Approved decision produced one traceable follow-through action without PM re-entry.', occurredAt: at,
            correlationId: `action:${action.id}:1`, causationId: decisionId, sourceRefs: action.sourceRefs,
            metadata: { ownerId, attentionItemId: attention.id, decisionId } });
        }
      }
    });
    return next;
  }

  supersedePendingDecision(projectId: string, attentionItemId: string, actorId = 'system:autonomy'): DecisionRecord | undefined {
    const current = this.repo.getDecisionByAttention(projectId, attentionItemId);
    if (!current || current.state !== 'pending') return current;
    const at = this.now().toISOString();
    const next: DecisionRecord = { ...current, state: 'superseded', decidedBy: actorId, decidedAt: at, reason: 'Underlying attention item resolved before a human decision was required.', revision: current.revision + 1 };
    this.repo.transaction(() => {
      this.repo.upsertDecision(next);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'decision.superseded', entityType: 'decision', entityId: current.id,
        result: 'recorded', reason: next.reason ?? 'Decision superseded.', occurredAt: at, correlationId: `decision:${current.id}:${next.revision}`,
        beforeRevision: current.revision, afterRevision: next.revision, sourceRefs: next.evidenceRefs, metadata: { attentionItemId } });
    });
    return next;
  }

  createWorkAction(action: WorkActionRecord): void {
    this.repo.transaction(() => {
      this.repo.insertWorkAction(action);
      this.repo.appendEvent({ id: randomUUID(), projectId: action.projectId, actorId: action.createdBy, eventType: 'work-action.created', entityType: 'work-action', entityId: action.id,
        result: 'recorded', reason: 'Traceable action created from project control state.', occurredAt: action.createdAt, correlationId: `action:${action.id}:1`,
        sourceRefs: action.sourceRefs, metadata: { ownerId: action.ownerId, type: action.type, attentionItemId: action.attentionItemId ?? null } });
    });
  }

  completeWorkActionFromResolvedAttention(projectId: string, actionId: string, causationId: string, actorId = 'system:autonomy'): WorkActionRecord {
    const current = this.repo.listWorkActions(projectId).find((a) => a.id === actionId);
    if (!current) throw new GoliathError('NOT_FOUND', 'Work action not found.');
    if (current.state !== 'open') return current;
    const at = this.now().toISOString();
    const next: WorkActionRecord = { ...current, state: 'done', completedAt: at, revision: current.revision + 1 };
    this.repo.transaction(() => {
      this.repo.updateWorkAction(next);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'work-action.auto-completed', entityType: 'work-action', entityId: actionId,
        result: 'recorded', reason: 'Underlying attention condition is no longer present in governed project state.', occurredAt: at,
        correlationId: `action:${actionId}:${next.revision}`, causationId, beforeRevision: current.revision, afterRevision: next.revision,
        sourceRefs: next.sourceRefs });
    });
    return next;
  }

  completeWorkAction(projectId: string, actionId: string, actorId: string): WorkActionRecord {
    const member = this.requireMember(projectId, actorId);
    const current = this.repo.listWorkActions(projectId).find((a) => a.id === actionId);
    if (!current) throw new GoliathError('NOT_FOUND', 'Work action not found.');
    if (current.ownerId !== actorId && !effectivePermissions(member).includes('activity:update-all')) throw new GoliathError('ACCESS_DENIED', 'Only the owner or Project Manager can complete this action.');
    const at = this.now().toISOString();
    const next: WorkActionRecord = { ...current, state: 'done', completedAt: at, revision: current.revision + 1 };
    this.repo.transaction(() => {
      this.repo.updateWorkAction(next);
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'work-action.completed', entityType: 'work-action', entityId: actionId,
        result: 'allowed', reason: 'Work action marked complete by an authorised owner.', occurredAt: at, correlationId: `action:${actionId}:${next.revision}`,
        beforeRevision: current.revision, afterRevision: next.revision, sourceRefs: next.sourceRefs });
    });
    return next;
  }

  private applyActivityUpdate(activity: ActivityRecord, actorId: string, update: ActivityProgressUpdate, sourceRef: string, correlationId: string): ActivityRecord {
    ensureDate(update.forecastFinish, 'Forecast finish'); ensureDate(update.actualStart, 'Actual start'); ensureDate(update.actualFinish, 'Actual finish'); ensurePercent(update.percentComplete);
    if (update.status === 'blocked' && !update.blocker?.trim() && !activity.blocker) throw new GoliathError('INVALID_INPUT', 'Blocked work needs a concise blocker.');
    const status = update.status ?? activity.status;
    const percentComplete = status === 'done' ? 100 : update.percentComplete ?? activity.percentComplete;
    if (status === 'done' && !(update.actualFinish ?? activity.actualFinish)) throw new GoliathError('INVALID_INPUT', 'Completed work needs an actual finish date.');
    const next: ActivityRecord = {
      ...activity, status, ...(update.forecastFinish !== undefined ? { forecastFinish: update.forecastFinish } : {}),
      ...(update.actualStart !== undefined ? { actualStart: update.actualStart } : {}), ...(update.actualFinish !== undefined ? { actualFinish: update.actualFinish } : {}),
      ...(percentComplete !== undefined ? { percentComplete } : {}),
      ...(update.blocker !== undefined && update.blocker !== null ? { blocker: update.blocker } : {}),
      ...(update.evidenceRefs !== undefined ? { evidenceRefs: unique([...activity.evidenceRefs, ...update.evidenceRefs]) } : {}),
      revision: activity.revision + 1,
    };
    // exactOptionalPropertyTypes means removing the blocker must be explicit rather than assigning undefined.
    const normalized = update.blocker === null ? (({ blocker: _ignored, ...rest }) => rest)(next) as ActivityRecord : next;
    const at = this.now().toISOString();
    this.repo.transaction(() => {
      this.repo.updateActivity(normalized);
      this.repo.appendEvent({ id: randomUUID(), projectId: activity.projectId, actorId, eventType: actorId === 'system:integration' ? 'activity.source-updated' : 'activity.updated',
        entityType: 'activity', entityId: activity.id, result: 'allowed', reason: actorId === 'system:integration' ? 'Authoritative source fact reconciled into project state.' : 'Permitted activity update recorded.',
        occurredAt: at, correlationId, beforeRevision: activity.revision, afterRevision: normalized.revision, sourceRefs: [sourceRef], metadata: update as Record<string, unknown> });
    });
    return normalized;
  }

  private requireProject(projectId: string): ProjectRecord {
    const project = this.repo.getProject(projectId);
    if (!project) throw new GoliathError('NOT_FOUND', `Project ${projectId} not found.`);
    return project;
  }

  private requireActivity(projectId: string, activityId: string): ActivityRecord {
    const activity = this.repo.getActivity(activityId);
    if (!activity || activity.projectId !== projectId) throw new GoliathError('NOT_FOUND', `Activity ${activityId} not found in this project.`);
    return activity;
  }

  private requireMember(projectId: string, actorId: string): ProjectMember {
    const member = this.repo.getMember(projectId, actorId);
    if (!member || !member.active) throw new GoliathError('ACCESS_DENIED', 'Active scoped project membership is required.');
    return member;
  }

  private requirePermission(member: ProjectMember, permission: ProjectPermission): void {
    if (!effectivePermissions(member).includes(permission)) throw new GoliathError('ACCESS_DENIED', `Permission ${permission} is required.`);
  }

  private requireAnyPermission(member: ProjectMember, permissions: readonly ProjectPermission[]): void {
    const effective = effectivePermissions(member);
    if (!permissions.some((permission) => effective.includes(permission))) throw new GoliathError('ACCESS_DENIED', `One of ${permissions.join(', ')} is required.`);
  }

  private assertAuthorizedActivityUpdate(actor: AuthorizedProjectActor, activity: ActivityRecord): void {
    if (actor.permissions.includes('activity:update-all')) return;
    if (actor.permissions.includes('activity:update-team') && actor.teamId && actor.teamId === (activity.currentTeamId ?? activity.plannedTeamId)) return;
    if (actor.permissions.includes('activity:update-own') && activity.ownerId === actor.userId) return;
    throw new GoliathError('ACCESS_DENIED', 'Actor cannot update this activity.');
  }

  private assertActivityUpdatePermission(member: ProjectMember, activity: ActivityRecord): void {
    const permissions = effectivePermissions(member);
    if (permissions.includes('activity:update-all')) return;
    if (permissions.includes('activity:update-team') && member.teamId && member.teamId === (activity.currentTeamId ?? activity.plannedTeamId)) return;
    if (permissions.includes('activity:update-own') && activity.ownerId === member.userId) return;
    throw new GoliathError('ACCESS_DENIED', 'Actor cannot update this activity.');
  }

  private denyAssignment(projectId: string, activityId: string, actorId: string, message: string): never {
    const at = this.now().toISOString();
    this.repo.transaction(() => {
      this.repo.appendEvent({ id: randomUUID(), projectId, actorId, eventType: 'activity.assignment-denied', entityType: 'activity', entityId: activityId,
        result: 'denied', reason: message, occurredAt: at, correlationId: `deny-assign:${activityId}:${at}`, sourceRefs: [] });
    });
    throw new GoliathError('ACCESS_DENIED', message);
  }

  private assertAcyclic(activityIds: readonly string[], dependencies: readonly DependencyRecord[]): void {
    const graph = new Map<string, string[]>();
    for (const id of activityIds) graph.set(id, []);
    for (const dep of dependencies) graph.get(dep.predecessorActivityId)?.push(dep.successorActivityId);
    const visiting = new Set<string>(); const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new GoliathError('INVALID_INPUT', 'Project dependencies contain a cycle.');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const next of graph.get(id) ?? []) visit(next);
      visiting.delete(id); visited.add(id);
    };
    for (const id of activityIds) visit(id);
  }
}
