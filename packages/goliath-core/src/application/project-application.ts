import { GoliathError } from '../core/errors.js';
import type { ActingContext } from '../context/types.js';
import { ProjectControlService, type ActivityProgressUpdate, type ProjectSetupUpdate } from '../project/service.js';
import type { ActivityCreateInput, ActivityRecord, AssignmentRecord, DecisionRecord, DependencyRecord, HandoffRecord, ProjectLifecycle, ProjectRecord, SourceStateRecord } from '../project/types.js';
import { SqlProjectRepository } from '../project/sqlite-repository.js';
import { ActingContextBoundary, type ApplicationContextRequest } from './context-boundary.js';
import type { ProjectPermission } from '../project/types.js';

function projectPermissionsFromContext(context: ActingContext): readonly ProjectPermission[] {
  const permissions: ProjectPermission[]=[];
  if (context.permissions.includes('project:assign')) permissions.push('activity:assign-all');
  if (context.permissions.includes('team:assign')) permissions.push('activity:assign-team');
  if (context.permissions.includes('project:manage')) permissions.push('activity:update-all');
  if (context.permissions.includes('team:coordinate')) permissions.push('activity:update-team');
  if (context.permissions.includes('work:update-own')) permissions.push('activity:update-own');
  if (context.permissions.includes('decision:approve')) permissions.push('decision:approve');
  if (context.permissions.includes('decision:prepare')) permissions.push('decision:prepare');
  if (context.permissions.includes('project:view-full')) permissions.push('project:view-full','activity:view-all');
  if (context.permissions.includes('project:view-summary')) permissions.push('project:view-summary');
  return [...new Set(permissions)];
}

/**
 * Application-facing project operations. Selected acting context is always checked first.
 * Existing project-service membership guards remain defence-in-depth during the migration period.
 */
export class ContextualProjectApplication {
  constructor(
    private readonly boundary: ActingContextBoundary,
    private readonly repo: SqlProjectRepository,
    private readonly projects: ProjectControlService,
  ) {}

  importPlan(
    request: ApplicationContextRequest,
    projectId: string,
    activities: readonly ActivityCreateInput[],
    dependencies: readonly DependencyRecord[],
  ): void {
    this.boundary.requireProject(request, projectId, 'project:manage');
    this.projects.importPlan(projectId, request.userId, activities, dependencies);
  }

  configureProject(request: ApplicationContextRequest, projectId: string, update: ProjectSetupUpdate): ProjectRecord {
    this.boundary.requireProject(request, projectId, 'project:manage');
    return this.projects.configureProject(projectId, request.userId, update);
  }

  registerSource(request: ApplicationContextRequest, projectId: string, source: SourceStateRecord): void {
    this.boundary.requireProject(request, projectId, 'project:manage');
    this.projects.registerSource(projectId, request.userId, source);
  }

  transitionProject(request: ApplicationContextRequest, projectId: string, target: ProjectLifecycle): ProjectRecord {
    this.boundary.requireProject(request, projectId, 'project:manage');
    return this.projects.transitionProject(projectId, request.userId, target);
  }

  getActivities(request: ApplicationContextRequest, projectId: string): readonly ActivityRecord[] {
    const context = this.boundary.requireProjectAny(request, projectId, ['project:view-full', 'project:view-summary']);
    const all = this.repo.listActivities(projectId);
    if (context.permissions.includes('project:view-full')) {
      if ((context.role === 'delivery-lead' || context.role === 'agile-delivery-lead') && context.teamId) {
        return all.filter((activity) => (activity.currentTeamId ?? activity.plannedTeamId) === context.teamId);
      }
      return all;
    }
    if (context.role === 'team-member') return all.filter((activity) => activity.ownerId === request.userId);
    if (context.role === 'sponsor') return all.filter((activity) => activity.milestone || activity.priority === 'critical' || activity.status === 'blocked');
    return [];
  }

  assignActivity(
    request: ApplicationContextRequest,
    projectId: string,
    activityId: string,
    assigneeId: string,
    reason?: string,
    supportOwnerIds: readonly string[] = [],
  ): AssignmentRecord {
    const context = this.boundary.requireProjectAny(request, projectId, ['project:assign', 'team:assign']);
    if (context.permissions.includes('team:assign') && !context.permissions.includes('project:assign')) {
      const activity = this.repo.getActivity(activityId);
      if (!activity || activity.projectId !== projectId) throw new GoliathError('NOT_FOUND', 'Activity not found.');
      if (!context.teamId || (activity.currentTeamId ?? activity.plannedTeamId) !== context.teamId) {
        throw new GoliathError('ACCESS_DENIED', 'Team assignment authority applies only to the selected team context.');
      }
    }
    return this.projects.assignActivityAuthorized(projectId, activityId, assigneeId, { userId:request.userId, ...(context.teamId?{teamId:context.teamId}:{}), permissions:projectPermissionsFromContext(context) }, reason, supportOwnerIds);
  }

  updateActivity(request: ApplicationContextRequest, projectId: string, activityId: string, update: ActivityProgressUpdate): ActivityRecord {
    const context = this.boundary.requireProjectAny(request, projectId, ['project:manage', 'team:coordinate', 'work:update-own']);
    const activity = this.repo.getActivity(activityId);
    if (!activity || activity.projectId !== projectId) throw new GoliathError('NOT_FOUND', 'Activity not found.');
    if (context.role === 'team-member' && activity.ownerId !== request.userId) {
      throw new GoliathError('ACCESS_DENIED', 'Team members may update only their own work.');
    }
    if ((context.role === 'delivery-lead' || context.role === 'agile-delivery-lead') && context.teamId &&
      (activity.currentTeamId ?? activity.plannedTeamId) !== context.teamId) {
      throw new GoliathError('ACCESS_DENIED', 'Team coordination authority applies only to the selected team context.');
    }
    return this.projects.updateActivityAuthorized(projectId, activityId, { userId:request.userId, ...(context.teamId?{teamId:context.teamId}:{}), permissions:projectPermissionsFromContext(context) }, update);
  }

  decide(
    request: ApplicationContextRequest,
    projectId: string,
    decisionId: string,
    choice: string,
    state: 'approved' | 'rejected' | 'selected',
    reason?: string,
  ): DecisionRecord {
    const context=this.boundary.requireProject(request, projectId, 'decision:approve');
    return this.projects.decideAuthorized(projectId, decisionId, { userId:request.userId, ...(context.teamId?{teamId:context.teamId}:{}), permissions:projectPermissionsFromContext(context) }, choice, state, reason);
  }

  createHandoff(
    request: ApplicationContextRequest,
    projectId: string,
    input: Omit<HandoffRecord, 'revision' | 'projectId' | 'senderId'>,
  ): HandoffRecord {
    const context=this.boundary.requireProjectAny(request,projectId,['project:manage','team:coordinate','work:update-own']);
    const source=this.repo.getActivity(input.sourceActivityId);
    const target=this.repo.getActivity(input.targetActivityId);
    if (!source || source.projectId!==projectId || !target || target.projectId!==projectId) throw new GoliathError('NOT_FOUND','Handoff activities must belong to the selected project.');
    if (context.role==='team-member' && source.ownerId!==request.userId) throw new GoliathError('ACCESS_DENIED','Team members may hand off only their own completed work.');
    if ((context.role==='delivery-lead'||context.role==='agile-delivery-lead') && context.teamId && (source.currentTeamId??source.plannedTeamId)!==context.teamId) {
      throw new GoliathError('ACCESS_DENIED','Team leads may hand off only work owned by their selected team.');
    }
    return this.projects.createHandoff(projectId,request.userId,{...input,projectId,senderId:request.userId});
  }

  respondToHandoff(
    request: ApplicationContextRequest,
    projectId: string,
    handoffId: string,
    decision: { state: 'accepted' | 'returned'; reason?: string },
  ): HandoffRecord {
    const context = this.boundary.requireProjectAny(request, projectId, ['project:manage', 'team:coordinate', 'handoff:respond']);
    const handoff = this.repo.getHandoff(handoffId);
    if (!handoff || handoff.projectId !== projectId) throw new GoliathError('NOT_FOUND', 'Handoff not found.');
    if (!context.permissions.includes('project:manage')) {
      if (context.role === 'team-member' && handoff.receiverId !== request.userId) throw new GoliathError('ACCESS_DENIED', 'Only the receiving owner may respond in this context.');
      if ((context.role === 'delivery-lead' || context.role === 'agile-delivery-lead')) {
        const target=this.repo.getActivity(handoff.targetActivityId);
        if (!target || !context.teamId || (target.currentTeamId??target.plannedTeamId)!==context.teamId) throw new GoliathError('ACCESS_DENIED','Only the receiving team may respond in this context.');
      }
    }
    return this.projects.respondToHandoff(projectId, handoffId, request.userId, decision);
  }

  context(request: ApplicationContextRequest): ActingContext { return this.boundary.resolve(request); }
}
