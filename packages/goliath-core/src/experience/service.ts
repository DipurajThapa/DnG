import { GoliathError } from '../core/errors.js';
import { ActingContextBoundary, type ApplicationContextRequest } from '../application/context-boundary.js';
import { FinanceService } from '../finance/service.js';
import { SqlProjectRepository } from '../project/sqlite-repository.js';
import { ResourceCapacityService } from '../resource/service.js';
import { calculateTraceabilitySnapshot } from '../trace/metrics.js';
import { roleExperienceProfile } from './config.js';
import type { ExperienceProjectCard, RoleAttentionSummary, RoleCapabilities, RoleWorkspace } from './types.js';

function activeAttention(repo: SqlProjectRepository, projectId: string) {
  return repo.listAttention(projectId).filter((x)=>x.state==='open'||x.state==='waiting');
}
function daysLate(date: string | undefined, now: Date): boolean { return date!==undefined && Date.parse(date)<now.getTime(); }

export class RoleExperienceService {
  constructor(
    private readonly boundary: ActingContextBoundary,
    private readonly projects: SqlProjectRepository,
    private readonly resources: ResourceCapacityService,
    private readonly finance: FinanceService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  build(
    request: ApplicationContextRequest,
    options: { projectId?: string; periodStart?: string; periodEnd?: string } = {},
  ): RoleWorkspace {
    const context=this.boundary.resolve(request);
    const profile=roleExperienceProfile(context.role);
    const capabilities: RoleCapabilities = {
      canAssignProjectWork:context.permissions.includes('project:assign'),
      canAssignTeamWork:context.permissions.includes('team:assign'),
      canAllocateResources:context.permissions.includes('resource:allocate'),
      canApproveDecisions:context.permissions.includes('decision:approve'),
      canManageProject:context.permissions.includes('project:manage'),
      canViewProjectFinance:context.permissions.includes('money:view-project')||context.permissions.includes('money:view-commercial'),
      canViewCommercialFinance:context.permissions.includes('money:view-commercial'),
      canManageGovernance:context.permissions.includes('governance:manage'),
      canRequestResourceDemand:context.permissions.includes('project:manage')||context.permissions.includes('team:coordinate'),
      canRespondHandoff:context.permissions.includes('handoff:respond')||context.permissions.includes('project:manage'),
      canCoordinateTeam:context.permissions.includes('team:coordinate'),
    };
    const cards=context.accessibleProjectIds.map((id)=>this.projectCard(context,request,id));
    const scopeAttention=this.scopeAttention(context.role,context.teamId,request.userId,context.accessibleProjectIds);
    const base: RoleWorkspace = { actorId:request.userId, context, profile, role:context.role, scopeLabel:context.scopeLabel, availableProjectIds:context.accessibleProjectIds, capabilities, projects:cards, attention:scopeAttention };

    if (context.role==='resource-manager') {
      const range=this.range(options,profile.defaultHorizonDays);
      return { ...base, functionalCapacity:this.resources.getFunctionalCapacity(request,range.start,range.end) };
    }
    if (context.role==='enterprise-admin') {
      const users=this.boundary.contexts.listUserDirectory(request.userId,request.actingAssignmentId);
      return { ...base, administration:{ responsibilityContexts:users.reduce((n,u)=>n+u.responsibilities.filter((r)=>r.active).length,0), organisationIds:context.accessibleOrganisationIds, users } };
    }
    if (!options.projectId && context.accessibleProjectIds.length > 1) return base;

    const projectId=options.projectId ?? context.accessibleProjectIds[0];
    if (!projectId) return base;
    this.boundary.requireProjectAny(request,projectId,['project:view-full','project:view-summary']);
    const project=this.projects.getProject(projectId);
    if (!project) throw new GoliathError('NOT_FOUND','Project not found.');
    const allActivities=this.projects.listActivities(projectId);
    const members=this.projects.listMembers(projectId).filter((member)=>member.active);
    const activities=this.activitiesForRole(context.role,context.teamId,request.userId,allActivities);
    const attention=activeAttention(this.projects,projectId).filter((item)=>this.canSeeAttention(context.role,context.teamId,request.userId,item,activities));
    const decisions=this.projects.listDecisions(projectId).filter((d)=> context.role==='sponsor'||context.role==='team-member' ? d.decisionOwnerId===request.userId||d.decidedBy===request.userId : true);
    const handoffs=this.projects.listHandoffs(projectId).filter((h)=>{
      if (context.role==='team-member') return h.senderId===request.userId||h.receiverId===request.userId;
      if ((context.role==='delivery-lead'||context.role==='agile-delivery-lead')&&context.teamId) {
        const ids=new Set(activities.map((a)=>a.id)); return ids.has(h.sourceActivityId)||ids.has(h.targetActivityId);
      }
      return true;
    });
    const visibleActivityIds=new Set(activities.map((activity)=>activity.id));
    const dependencies=this.projects.listDependencies(projectId).filter((dependency)=>{
      if (context.role==='team-member'||context.role==='delivery-lead'||context.role==='agile-delivery-lead') {
        return visibleActivityIds.has(dependency.predecessorActivityId)||visibleActivityIds.has(dependency.successorActivityId);
      }
      return true;
    });
    const visibleRefs=new Set(activities.flatMap((activity)=>[...(activity.sourceRef?[activity.sourceRef]:[]),...activity.evidenceRefs]));
    const sources=this.projects.listSources(projectId).filter((source)=>{
      if (context.role==='team-member'||context.role==='delivery-lead'||context.role==='agile-delivery-lead') return visibleRefs.has(source.sourceRef);
      return true;
    });
    const workActions=this.projects.listWorkActions(projectId).filter((action)=>{
      if (context.role==='team-member') return action.ownerId===request.userId;
      if ((context.role==='delivery-lead'||context.role==='agile-delivery-lead')&&context.teamId) return !action.activityId||visibleActivityIds.has(action.activityId);
      if (context.role==='sponsor') return action.ownerId===request.userId;
      return true;
    });
    const range=this.range(options,profile.defaultHorizonDays);
    let finance;
    if (context.permissions.some((p)=>p==='money:view-summary'||p==='money:view-project'||p==='money:view-commercial')) finance=this.finance.getProjection(request,projectId);
    let capacity;
    if (context.permissions.includes('resource:view-summary')) capacity=this.resources.getProjectCapacity(request,projectId,range.start,range.end);
    const traceability = context.role==='project-manager'||context.role==='project-director'||context.role==='pmo' ? calculateTraceabilitySnapshot(this.projects,projectId) : undefined;
    return { ...base, selectedProject:{
      projectId,
      code:project.code,
      name:project.name,
      lifecycle:project.lifecycle,
      ...(project.baselineFinish?{baselineFinish:project.baselineFinish}:{}),
      ...(project.forecastFinish?{forecastFinish:project.forecastFinish}:{}),
      evidenceConfidence:project.evidenceConfidence,
      sourceHealthSummary:project.sourceHealthSummary,
      activities,
      handoffTargets:allActivities.filter((activity)=>activity.status!=='cancelled').map((activity)=>({
        id:activity.id,
        title:activity.title,
        status:activity.status,
        ...(activity.plannedTeamId?{plannedTeamId:activity.plannedTeamId}:{}),
        ...(activity.currentTeamId?{currentTeamId:activity.currentTeamId}:{}),
      })),
      members,
      fullActivityCount:allActivities.length,
      attentionIds:attention.map((x)=>x.id),
      attentionItems:attention,
      decisionIds:decisions.map((x)=>x.id),
      decisions,
      handoffIds:handoffs.map((x)=>x.id),
      handoffs,
      dependencies,
      sources,
      workActions,
      ...(finance?{finance}:{}),
      ...(capacity?{capacity}:{}),
      ...(traceability?{traceability}:{}),
    } };
  }

  private scopeAttention(role: RoleWorkspace['role'], teamId: string|undefined, userId: string, projectIds: readonly string[]): RoleAttentionSummary[] {
    const result: RoleAttentionSummary[] = [];
    for (const projectId of projectIds) {
      const activities=this.projects.listActivities(projectId);
      for (const item of activeAttention(this.projects,projectId)) {
        if (!this.canSeeAttention(role,teamId,userId,item,activities)) continue;
        result.push({ attentionId:item.id, projectId, title:item.title, consequence:item.consequence, confidence:item.confidence, nextAction:item.nextAction,
          ...(item.ownerId?{ownerId:item.ownerId}:{}), ...(item.decisionOwnerId?{decisionOwnerId:item.decisionOwnerId}:{}), ...(item.dueAt?{dueAt:item.dueAt}:{}) });
      }
    }
    const weight={critical:4,high:3,medium:2,low:1} as const;
    return result.sort((a,b)=>weight[b.consequence]-weight[a.consequence] || (a.dueAt??'9999').localeCompare(b.dueAt??'9999'));
  }

  private canSeeAttention(role: RoleWorkspace['role'], teamId: string|undefined, userId: string, item: ReturnType<typeof activeAttention>[number], activities: readonly import('../project/types.js').ActivityRecord[]): boolean {
    if (role==='enterprise-admin'||role==='resource-manager') return false;
    if (role==='team-member') return item.ownerId===userId||item.decisionOwnerId===userId;
    if ((role==='delivery-lead'||role==='agile-delivery-lead')&&teamId) {
      const refs=new Set(activities.filter((a)=>(a.currentTeamId??a.plannedTeamId)===teamId).flatMap((a)=>[...(a.sourceRef?[a.sourceRef]:[]),...a.evidenceRefs]));
      return item.sourceRefs.some((ref)=>refs.has(ref))||item.ownerId===userId||item.decisionOwnerId===userId;
    }
    if (role==='sponsor') return item.decisionOwnerId===userId || item.consequence==='critical' || (item.consequence==='high' && (item.nextAction==='decide'||item.nextAction==='approve'));
    if (role==='program-manager'||role==='portfolio-manager') return item.consequence==='critical'||item.consequence==='high'||item.nextAction==='decide'||item.nextAction==='approve';
    return true;
  }

  private projectCard(context: import('../context/types.js').ActingContext, request: ApplicationContextRequest, projectId: string): ExperienceProjectCard {
    const project=this.projects.getProject(projectId);
    if (!project) throw new GoliathError('NOT_FOUND','Project not found.');
    const attention=activeAttention(this.projects,projectId);
    const activities=this.projects.listActivities(projectId);
    let budgetVariance:number|undefined;
    if (context.permissions.some((p)=>p==='money:view-summary'||p==='money:view-project'||p==='money:view-commercial')) {
      const projection=this.finance.getProjection(request,projectId);
      budgetVariance=projection.variance;
    }
    return { projectId, code:project.code, name:project.name, lifecycle:project.lifecycle, ...(project.baselineFinish?{baselineFinish:project.baselineFinish}:{}), ...(project.forecastFinish?{forecastFinish:project.forecastFinish}:{}),
      openAttention:attention.length, criticalAttention:attention.filter((x)=>x.consequence==='critical').length, blockedActivities:activities.filter((a)=>a.status==='blocked').length,
      overdueActivities:activities.filter((a)=>a.status!=='done'&&a.status!=='cancelled'&&daysLate(a.forecastFinish??a.baselineFinish,this.now())).length,
      unownedActivities:activities.filter((a)=>a.status!=='cancelled'&&!a.ownerId).length, sourceHealthSummary:project.sourceHealthSummary, ...(budgetVariance!==undefined?{budgetVariance}:{}) };
  }

  private activitiesForRole(role: RoleWorkspace['role'], teamId: string|undefined, userId: string, all: readonly import('../project/types.js').ActivityRecord[]) {
    if (role==='team-member') return all.filter((a)=>a.ownerId===userId);
    if ((role==='delivery-lead'||role==='agile-delivery-lead')&&teamId) return all.filter((a)=>(a.currentTeamId??a.plannedTeamId)===teamId);
    if (role==='sponsor') return all.filter((a)=>a.milestone||a.priority==='critical'||a.status==='blocked');
    if (role==='portfolio-manager') return [];
    return all;
  }

  private range(options:{periodStart?:string;periodEnd?:string},days:number):{start:string;end:string} {
    const start=options.periodStart??this.now().toISOString().slice(0,10);
    const end=options.periodEnd??new Date(Date.parse(`${start}T00:00:00.000Z`)+Math.max(1,days-1)*86_400_000).toISOString().slice(0,10);
    return {start,end};
  }
}
