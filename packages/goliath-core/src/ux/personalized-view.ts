import { GoliathError } from '../core/errors.js';
import type { AttentionItem } from '../control/types.js';
import { effectivePermissions } from '../project/permissions.js';
import type { PersonalWorkspace, ProjectMember, ProjectRecord } from '../project/types.js';
import { SqlProjectRepository } from '../project/sqlite-repository.js';
import { globalNavigation, projectNavigation } from './navigation.js';

export interface PortfolioProjectCard {
  projectId: string;
  code: string;
  name: string;
  lifecycle: ProjectRecord['lifecycle'];
  forecastFinish?: string;
  baselineFinish?: string;
  openAttention: number;
  criticalAttention: number;
  blockedActivities: number;
  unownedActivities: number;
  sourceHealthSummary: string;
}

export interface PortfolioWorkspace {
  actorId: string;
  organisationId: string;
  role: ProjectMember['role'];
  projects: readonly PortfolioProjectCard[];
}

function activeAttention(items: readonly AttentionItem[]): AttentionItem[] {
  return items.filter((item) => item.state === 'open' || item.state === 'waiting');
}

function memberTeam(repo: SqlProjectRepository, projectId: string, userId: string | undefined): string | undefined {
  if (!userId) return undefined;
  return repo.getMember(projectId, userId)?.teamId;
}

export function buildPersonalWorkspace(repo: SqlProjectRepository, projectId: string, actorId: string): PersonalWorkspace {
  const project = repo.getProject(projectId);
  if (!project) throw new GoliathError('NOT_FOUND', 'Project not found.');
  const member = repo.getMember(projectId, actorId);
  if (!member || !member.active) throw new GoliathError('ACCESS_DENIED', 'Active project membership is required.');
  const permissions = effectivePermissions(member);

  const allActivities = repo.listActivities(projectId);
  const activities = permissions.includes('activity:view-all')
    ? allActivities
    : permissions.includes('activity:view-team') && member.teamId
      ? allActivities.filter((activity) => (activity.currentTeamId ?? activity.plannedTeamId) === member.teamId)
      : permissions.includes('activity:view-own')
        ? allActivities.filter((activity) => activity.ownerId === actorId)
        : [];

  const allAttention = activeAttention(repo.listAttention(projectId));
  const attention = permissions.includes('attention:view-all')
    ? allAttention
    : permissions.includes('attention:view-team') && member.teamId
      ? allAttention.filter((item) => memberTeam(repo, projectId, item.ownerId) === member.teamId || memberTeam(repo, projectId, item.decisionOwnerId) === member.teamId)
      : permissions.includes('attention:view-own')
        ? allAttention.filter((item) => item.ownerId === actorId || item.decisionOwnerId === actorId)
        : [];

  const allDecisions = repo.listDecisions(projectId);
  const decisions = permissions.includes('decision:view')
    ? (member.role === 'project-manager' || member.role === 'program-manager' || member.role === 'pmo' || member.role === 'delivery-lead'
      ? allDecisions
      : allDecisions.filter((decision) => decision.decisionOwnerId === actorId || decision.decidedBy === actorId))
    : [];

  const allHandoffs = repo.listHandoffs(projectId);
  const handoffs = member.role === 'project-manager' || member.role === 'program-manager' || member.role === 'pmo'
    ? allHandoffs
    : allHandoffs.filter((handoff) => handoff.senderId === actorId || handoff.receiverId === actorId ||
      (member.teamId !== undefined && (memberTeam(repo, projectId, handoff.senderId) === member.teamId || memberTeam(repo, projectId, handoff.receiverId) === member.teamId)));

  const allActions = repo.listWorkActions(projectId);
  const workActions = member.role === 'project-manager' || member.role === 'program-manager' || member.role === 'pmo'
    ? allActions
    : member.role === 'delivery-lead' && member.teamId
      ? allActions.filter((action) => memberTeam(repo, projectId, action.ownerId) === member.teamId)
      : allActions.filter((action) => action.ownerId === actorId);

  return {
    actorId,
    role: member.role,
    projectId,
    projectName: project.name,
    lifecycle: project.lifecycle,
    permissions,
    navigation: { global: globalNavigation(member.role), project: projectNavigation(member.role) },
    capabilities: {
      canAssign: permissions.includes('activity:assign-all') || permissions.includes('activity:assign-team'),
      canReassign: permissions.includes('activity:assign-all') || permissions.includes('activity:assign-team'),
      canApprove: permissions.includes('decision:approve'),
      canEditPlan: permissions.includes('plan:edit'),
      canViewMoney: permissions.includes('money:view') || permissions.includes('money:view-summary'),
      canViewPeople: permissions.includes('people:view-all') || permissions.includes('people:view-team'),
      canTransitionProject: permissions.includes('project:transition'),
    },
    attentionIds: attention.map((item) => item.id),
    activities,
    decisions,
    handoffs,
    workActions,
  };
}

export function buildPortfolioWorkspace(repo: SqlProjectRepository, organisationId: string, actorId: string): PortfolioWorkspace {
  const accessible = repo.listProjects(organisationId).filter((project) => repo.getMember(project.id, actorId)?.active);
  if (accessible.length === 0) throw new GoliathError('ACCESS_DENIED', 'No accessible projects found for this user.');
  const firstMembership = repo.getMember(accessible[0]!.id, actorId)!;
  const permissions = effectivePermissions(firstMembership);
  if (!permissions.includes('portfolio:view')) throw new GoliathError('ACCESS_DENIED', 'Portfolio view permission is required.');
  return {
    actorId,
    organisationId,
    role: firstMembership.role,
    projects: accessible.map((project) => {
      const attention = activeAttention(repo.listAttention(project.id));
      const activities = repo.listActivities(project.id);
      return {
        projectId: project.id,
        code: project.code,
        name: project.name,
        lifecycle: project.lifecycle,
        ...(project.forecastFinish ? { forecastFinish: project.forecastFinish } : {}),
        ...(project.baselineFinish ? { baselineFinish: project.baselineFinish } : {}),
        openAttention: attention.length,
        criticalAttention: attention.filter((item) => item.consequence === 'critical').length,
        blockedActivities: activities.filter((activity) => activity.status === 'blocked').length,
        unownedActivities: activities.filter((activity) => activity.status !== 'cancelled' && !activity.ownerId).length,
        sourceHealthSummary: project.sourceHealthSummary,
      };
    }),
  };
}
