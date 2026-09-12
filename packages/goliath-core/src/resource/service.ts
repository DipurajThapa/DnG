import { randomUUID } from 'node:crypto';
import { GoliathError } from '../core/errors.js';
import { ActingContextBoundary, type ApplicationContextRequest } from '../application/context-boundary.js';
import type { ActingContext } from '../context/types.js';
import { EnterpriseContextService } from '../context/service.js';
import { SqlProjectRepository } from '../project/sqlite-repository.js';
import { SqlResourceRepository } from './repository.js';
import type { CapacityPeriodRecord, CapacityView, ResourceAllocationRecord, ResourceCapacityLine, ResourceDemandRecord, ResourceRecord, ResourceWorklogRecord } from './types.js';

function dateMs(value: string): number {
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) throw new GoliathError('INVALID_INPUT', `Invalid date: ${value}`);
  return ms;
}
function overlapRatio(aStart: string, aEnd: string, wStart: string, wEnd: string): number {
  const s = Math.max(dateMs(aStart), dateMs(wStart));
  const e = Math.min(dateMs(aEnd), dateMs(wEnd));
  if (e < s) return 0;
  const day = 86_400_000;
  const overlapDays = Math.floor((e - s) / day) + 1;
  const totalDays = Math.floor((dateMs(aEnd) - dateMs(aStart)) / day) + 1;
  return overlapDays / totalDays;
}
function round(value: number): number { return Math.round(value * 100) / 100; }

export class ResourceCapacityService {
  constructor(
    private readonly boundary: ActingContextBoundary,
    private readonly contexts: EnterpriseContextService,
    public readonly repo: SqlResourceRepository,
    private readonly projects: SqlProjectRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createResource(request: ApplicationContextRequest, input: Omit<ResourceRecord, 'createdAt' | 'revision'>): ResourceRecord {
    const context = this.boundary.requireFunctionalUnit(request, input.orgUnitId, 'resource:allocate');
    if (!context.accessibleOrganisationIds.includes(input.organisationId)) throw new GoliathError('ACCESS_DENIED', 'Resource organisation is outside the selected context.');
    if (!input.displayName.trim() || input.weeklyContractHours < 0) throw new GoliathError('INVALID_INPUT', 'Resource name and non-negative contract hours are required.');
    const record: ResourceRecord = { ...input, skills:[...new Set(input.skills.map((s) => s.trim()).filter(Boolean))], createdAt:this.now().toISOString(), revision:1 };
    this.repo.insertResource(record);
    this.contexts.recordDomainEvent(request.userId, 'resource.created', 'org-unit', input.orgUnitId, 'allowed', 'Resource registered in the canonical functional hierarchy.', { resourceId:record.id }, context.assignmentId);
    return record;
  }

  setCapacity(request: ApplicationContextRequest, input: Omit<CapacityPeriodRecord, 'revision'>): CapacityPeriodRecord {
    const resource = this.requireResource(input.resourceId);
    const context = this.boundary.requireFunctionalUnit(request, resource.orgUnitId, 'resource:allocate');
    if (input.grossHours < 0 || input.unavailableHours < 0 || input.unavailableHours > input.grossHours) throw new GoliathError('INVALID_INPUT', 'Capacity hours are invalid.');
    dateMs(input.periodStart); dateMs(input.periodEnd);
    if (input.periodEnd < input.periodStart) throw new GoliathError('INVALID_INPUT', 'Capacity period end must be on or after start.');
    const record: CapacityPeriodRecord = { ...input, revision:1 };
    this.repo.upsertCapacity(record);
    const saved=this.repo.getCapacityPeriod(input.resourceId,input.periodStart,input.periodEnd)!;
    this.contexts.recordDomainEvent(request.userId, 'resource.capacity-recorded', 'org-unit', resource.orgUnitId, 'allowed', 'Capacity recorded from the approved workforce/calendar basis.', { resourceId:resource.id, periodStart:input.periodStart, periodEnd:input.periodEnd, grossHours:input.grossHours, unavailableHours:input.unavailableHours }, context.assignmentId);
    return saved;
  }

  getCapacityRecord(resourceId: string, periodStart: string, periodEnd: string): CapacityPeriodRecord | undefined {
    return this.repo.getCapacityPeriod(resourceId, periodStart, periodEnd);
  }

  getAllocationRecord(allocationId: string): ResourceAllocationRecord | undefined {
    return this.repo.getAllocation(allocationId);
  }

  /** Integration-owned reconciliation of approved workforce/calendar capacity. */
  ingestAuthoritativeCapacity(input: CapacityPeriodRecord, actorId = 'system:workforce'): CapacityPeriodRecord {
    const resource = this.requireResource(input.resourceId);
    if (!input.sourceRef?.trim()) throw new GoliathError('INVALID_INPUT', 'Authoritative capacity requires a sourceRef.');
    if (input.grossHours < 0 || input.unavailableHours < 0 || input.unavailableHours > input.grossHours) throw new GoliathError('INVALID_INPUT', 'Capacity hours are invalid.');
    dateMs(input.periodStart); dateMs(input.periodEnd);
    if (input.periodEnd < input.periodStart) throw new GoliathError('INVALID_INPUT', 'Capacity period end must be on or after start.');
    const current = this.repo.getCapacityPeriod(input.resourceId, input.periodStart, input.periodEnd);
    if (current?.sourceRef && current.sourceRef !== input.sourceRef) throw new GoliathError('FIELD_AUTHORITY_DENIED', 'Capacity period is already owned by another authoritative source.');
    const same = current && current.grossHours === input.grossHours && current.unavailableHours === input.unavailableHours && current.sourceRef === input.sourceRef;
    if (same) return current;
    const next: CapacityPeriodRecord = { ...input, id: current?.id ?? input.id, revision: (current?.revision ?? 0) + 1 };
    this.repo.upsertCapacity(next);
    const saved = this.repo.getCapacityPeriod(input.resourceId, input.periodStart, input.periodEnd)!;
    this.contexts.recordDomainEvent(actorId, 'resource.capacity-reconciled', 'org-unit', resource.orgUnitId, 'recorded', 'Authoritative workforce/calendar capacity reconciled.',
      { resourceId:resource.id, periodStart:input.periodStart, periodEnd:input.periodEnd, grossHours:input.grossHours, unavailableHours:input.unavailableHours, sourceRef:input.sourceRef });
    return saved;
  }

  /** Integration-owned reconciliation of an externally confirmed allocation. */
  ingestAuthoritativeAllocation(input: Omit<ResourceAllocationRecord, 'createdBy' | 'createdAt' | 'revision'>, actorId = 'system:workforce'): ResourceAllocationRecord {
    const resource = this.requireResource(input.resourceId);
    const projectOrg = this.repo.projectOrganisation(input.projectId);
    if (!projectOrg || projectOrg !== resource.organisationId) throw new GoliathError('ACTION_NOT_ALLOWED', 'Resource and project must belong to the same organisation.');
    if (input.hours < 0) throw new GoliathError('INVALID_INPUT', 'Allocation hours cannot be negative.');
    dateMs(input.periodStart); dateMs(input.periodEnd);
    if (input.periodEnd < input.periodStart) throw new GoliathError('INVALID_INPUT', 'Allocation period end must be on or after start.');
    if (input.activityId) {
      const activity = this.projects.getActivity(input.activityId);
      if (!activity || activity.projectId !== input.projectId) throw new GoliathError('INVALID_INPUT', 'Allocation activity must belong to the selected project.');
    }
    const current = this.repo.getAllocation(input.id);
    if (current && (current.resourceId !== input.resourceId || current.projectId !== input.projectId)) throw new GoliathError('FIELD_AUTHORITY_DENIED', 'Authoritative allocation cannot be retargeted to another resource/project.');
    const same = current && current.activityId === input.activityId && current.teamId === input.teamId && current.periodStart === input.periodStart
      && current.periodEnd === input.periodEnd && current.hours === input.hours && current.status === input.status;
    if (same) return current;
    const at = this.now().toISOString();
    const next: ResourceAllocationRecord = current
      ? { ...current, ...input, revision: current.revision + 1 }
      : { ...input, createdBy: actorId, createdAt: at, revision: 1 };
    this.repo.transaction(() => current ? this.repo.updateAllocation(next) : this.repo.insertAllocation(next));
    this.reconcileDemands(next.projectId);
    this.contexts.recordDomainEvent(actorId, 'resource.allocation-reconciled', 'org-unit', resource.orgUnitId, 'recorded', 'Authoritative workforce allocation reconciled.',
      { allocationId:next.id, projectId:next.projectId, resourceId:next.resourceId, hours:next.hours, status:next.status });
    return next;
  }


  ingestAuthoritativeWorklog(input: Omit<ResourceWorklogRecord,'createdAt'|'revision'>, actorId='system:timesheet'):ResourceWorklogRecord {
    const resource=this.requireResource(input.resourceId);
    const projectOrg=this.repo.projectOrganisation(input.projectId);
    if(!projectOrg||projectOrg!==resource.organisationId) throw new GoliathError('ACTION_NOT_ALLOWED','Worklog resource and project must belong to the same organisation.');
    if(input.hours<0||input.hours>24) throw new GoliathError('INVALID_INPUT','Worklog hours must be between 0 and 24.');
    dateMs(input.workDate);
    if(input.activityId){const a=this.projects.getActivity(input.activityId);if(!a||a.projectId!==input.projectId)throw new GoliathError('INVALID_INPUT','Worklog activity must belong to the selected project.');}
    if(!input.sourceSystem.trim()||!input.sourceRef.trim()||!input.sourceRevision.trim()) throw new GoliathError('INVALID_INPUT','Authoritative worklog source identity is required.');
    const current=this.repo.getWorklogBySource(input.sourceSystem,input.sourceRef);
    const saved=this.repo.upsertWorklog({...input,createdAt:current?.createdAt??this.now().toISOString(),revision:(current?.revision??0)+1});
    this.contexts.recordDomainEvent(actorId,'resource.worklog-reconciled','project',input.projectId,'recorded','Authoritative actual effort reconciled.',{worklogId:saved.id,resourceId:saved.resourceId,hours:saved.hours,workDate:saved.workDate,sourceRef:saved.sourceRef});
    return saved;
  }

  getProjectActualEffort(projectId:string):number{return Math.round(this.repo.listWorklogsForProject(projectId).reduce((s,x)=>s+x.hours,0)*100)/100;}

  requestDemand(request: ApplicationContextRequest, input: Omit<ResourceDemandRecord, 'requestedBy' | 'createdAt' | 'revision' | 'state'>): ResourceDemandRecord {
    const context = this.boundary.requireProjectAny(request, input.projectId, ['project:manage','project:assign','team:coordinate']);
    if (input.requiredHours <= 0) throw new GoliathError('INVALID_INPUT', 'Required demand hours must be greater than zero.');
    dateMs(input.periodStart); dateMs(input.periodEnd);
    if (input.periodEnd < input.periodStart) throw new GoliathError('INVALID_INPUT', 'Demand period end must be on or after start.');
    const record: ResourceDemandRecord = { ...input, state:'open', requestedBy:request.userId, createdAt:this.now().toISOString(), revision:1 };
    this.repo.insertDemand(record);
    this.contexts.recordDomainEvent(request.userId, 'resource.demand-requested', 'project', input.projectId, 'allowed', 'Project resource demand recorded without changing employee allocation.', { demandId:record.id, requiredHours:record.requiredHours, orgUnitId:record.orgUnitId ?? null, skill:record.skill ?? null }, context.assignmentId);
    return record;
  }

  allocate(request: ApplicationContextRequest, input: Omit<ResourceAllocationRecord, 'createdBy' | 'createdAt' | 'revision'>): ResourceAllocationRecord {
    const resource = this.requireResource(input.resourceId);
    const context = this.boundary.requireFunctionalUnit(request, resource.orgUnitId, 'resource:allocate');
    const projectOrg = this.repo.projectOrganisation(input.projectId);
    if (!projectOrg || projectOrg !== resource.organisationId) throw new GoliathError('ACTION_NOT_ALLOWED', 'Resource and project must belong to the same organisation.');
    if (input.hours < 0) throw new GoliathError('INVALID_INPUT', 'Allocation hours cannot be negative.');
    if (input.activityId) {
      const activity = this.projects.getActivity(input.activityId);
      if (!activity || activity.projectId !== input.projectId) throw new GoliathError('INVALID_INPUT', 'Allocation activity must belong to the selected project.');
    }
    dateMs(input.periodStart); dateMs(input.periodEnd);
    if (input.periodEnd < input.periodStart) throw new GoliathError('INVALID_INPUT', 'Allocation period end must be on or after start.');
    const record: ResourceAllocationRecord = { ...input, createdBy:request.userId, createdAt:this.now().toISOString(), revision:1 };
    this.repo.insertAllocation(record);
    this.reconcileDemands(record.projectId);
    const availability = this.capacityForResource(resource, input.periodStart, input.periodEnd);
    this.contexts.recordDomainEvent(request.userId, 'resource.allocation-recorded', 'org-unit', resource.orgUnitId, 'allowed', 'Functional resource allocation recorded.', { allocationId:record.id, projectId:record.projectId, hours:record.hours, conflict:availability.conflict }, context.assignmentId);
    return record;
  }

  changeAllocation(request: ApplicationContextRequest, allocationId: string, update: { hours?: number; periodStart?: string; periodEnd?: string; status?: ResourceAllocationRecord['status']; reason?: string }): ResourceAllocationRecord {
    const current=this.repo.getAllocation(allocationId);
    if (!current) throw new GoliathError('NOT_FOUND','Resource allocation not found.');
    const resource=this.requireResource(current.resourceId);
    const context=this.boundary.requireFunctionalUnit(request,resource.orgUnitId,'resource:allocate');
    const next:ResourceAllocationRecord={ ...current, ...(update.hours!==undefined?{hours:update.hours}:{}), ...(update.periodStart?{periodStart:update.periodStart}:{}), ...(update.periodEnd?{periodEnd:update.periodEnd}:{}), ...(update.status?{status:update.status}:{}), ...(update.reason!==undefined?{reason:update.reason}:{}), revision:current.revision+1 };
    if (next.hours<0) throw new GoliathError('INVALID_INPUT','Allocation hours cannot be negative.');
    dateMs(next.periodStart); dateMs(next.periodEnd);
    if (next.periodEnd<next.periodStart) throw new GoliathError('INVALID_INPUT','Allocation period end must be on or after start.');
    if ((next.status==='released' || next.hours!==current.hours) && !next.reason?.trim()) throw new GoliathError('INVALID_INPUT','Changing or releasing a confirmed allocation needs a short reason.');
    this.repo.updateAllocation(next);
    this.reconcileDemands(next.projectId);
    this.contexts.recordDomainEvent(request.userId,'resource.allocation-changed','org-unit',resource.orgUnitId,'allowed','Functional resource allocation changed with retained history.',{ allocationId, projectId:current.projectId, previousHours:current.hours, hours:next.hours, previousStatus:current.status, status:next.status, reason:next.reason??null },context.assignmentId);
    return next;
  }

  getFunctionalCapacity(request: ApplicationContextRequest, periodStart: string, periodEnd: string): CapacityView {
    const context = this.boundary.resolve(request);
    if (!context.permissions.includes('resource:view-functional')) throw new GoliathError('ACCESS_DENIED', 'Functional resource visibility is required.');
    return this.buildView(this.repo.listResourcesByOrgUnits(context.functionalOrgUnitIds), periodStart, periodEnd, context);
  }

  getProjectCapacity(request: ApplicationContextRequest, projectId: string, periodStart: string, periodEnd: string): CapacityView {
    const context = this.boundary.requireProjectAny(request, projectId, ['resource:view-summary','resource:view-functional']);
    const allocations = this.repo.listAllocationsForProject(projectId).filter((a) => a.status === 'confirmed' && overlapRatio(a.periodStart,a.periodEnd,periodStart,periodEnd) > 0);
    let resourceIds = [...new Set(allocations.map((a) => a.resourceId))];
    if ((context.role === 'delivery-lead' || context.role === 'agile-delivery-lead') && context.teamId) {
      resourceIds = [...new Set(allocations.filter((a) => a.teamId === context.teamId).map((a) => a.resourceId))];
    }
    const resources = resourceIds.map((id) => this.repo.getResource(id)).filter((r): r is ResourceRecord => r !== undefined);
    return this.buildView(resources, periodStart, periodEnd, context, projectId);
  }

  private buildView(resources: readonly ResourceRecord[], periodStart: string, periodEnd: string, _context: ActingContext, projectId?: string): CapacityView {
    dateMs(periodStart); dateMs(periodEnd);
    if (periodEnd < periodStart) throw new GoliathError('INVALID_INPUT', 'Capacity window end must be on or after start.');
    const lines = resources.map((resource) => this.capacityForResource(resource, periodStart, periodEnd, projectId));
    const demand = projectId ? this.repo.listDemandsForProject(projectId) : this.repo.listDemandsForOrgUnits(_context.functionalOrgUnitIds);
    const openDemandHours = demand.filter((d) => d.state === 'open' || d.state === 'partially-filled').reduce((sum,d) => sum + this.remainingDemandHours(d) * overlapRatio(d.periodStart,d.periodEnd,periodStart,periodEnd), 0);
    return {
      periodStart, periodEnd, resources:lines,
      totalGrossHours:round(lines.reduce((s,x)=>s+x.grossHours,0)),
      totalUnavailableHours:round(lines.reduce((s,x)=>s+x.unavailableHours,0)),
      totalAllocatedHours:round(lines.reduce((s,x)=>s+x.confirmedAllocationHours,0)),
      totalAvailableHours:round(lines.reduce((s,x)=>s+x.availableHours,0)),
      openDemandHours:round(openDemandHours), missingCapacityResourceIds:lines.filter((x)=>!x.capacityKnown).map((x)=>x.resourceId), demands:demand,
    };
  }

  private capacityForResource(resource: ResourceRecord, periodStart: string, periodEnd: string, projectId?: string): ResourceCapacityLine {
    const periods = this.repo.listCapacity(resource.id);
    const relevantPeriods=periods.filter((p)=>overlapRatio(p.periodStart,p.periodEnd,periodStart,periodEnd)>0);
    const capacityKnown=relevantPeriods.length>0;
    const gross = relevantPeriods.reduce((s,p)=>s+p.grossHours*overlapRatio(p.periodStart,p.periodEnd,periodStart,periodEnd),0);
    const unavailable = relevantPeriods.reduce((s,p)=>s+p.unavailableHours*overlapRatio(p.periodStart,p.periodEnd,periodStart,periodEnd),0);
    const allocations = this.repo.listAllocationsForResource(resource.id).filter((a)=>a.status==='confirmed' && overlapRatio(a.periodStart,a.periodEnd,periodStart,periodEnd)>0);
    const projectAllocations = new Map<string,number>();
    for (const a of allocations) projectAllocations.set(a.projectId, (projectAllocations.get(a.projectId) ?? 0) + a.hours*overlapRatio(a.periodStart,a.periodEnd,periodStart,periodEnd));
    const visibleAllocation = projectId ? (projectAllocations.get(projectId) ?? 0) : [...projectAllocations.values()].reduce((s,x)=>s+x,0);
    const totalAllocation = [...projectAllocations.values()].reduce((s,x)=>s+x,0);
    const netCapacity = Math.max(0, gross-unavailable);
    const available = Math.max(0, netCapacity-totalAllocation);
    return {
      resourceId:resource.id, displayName:resource.displayName, orgUnitId:resource.orgUnitId, skills:resource.skills,
      grossHours:round(gross), unavailableHours:round(unavailable), confirmedAllocationHours:round(visibleAllocation), availableHours:round(available),
      ...(capacityKnown&&netCapacity>0?{utilizationPercent:round((totalAllocation/netCapacity)*100)}:{}), capacityKnown, conflict:capacityKnown&&totalAllocation>netCapacity+0.001,
      projectAllocations:(projectId ? [[projectId, projectAllocations.get(projectId) ?? 0] as const] : [...projectAllocations.entries()])
        .filter(([,hours])=>hours>0)
        .map(([pid,hours])=>({projectId:pid,hours:round(hours)})).sort((a,b)=>a.projectId.localeCompare(b.projectId)),
    };
  }

  private allocationMatchesDemand(allocation: ResourceAllocationRecord, demand: ResourceDemandRecord): boolean {
    if (allocation.status !== 'confirmed') return false;
    const resource=this.repo.getResource(allocation.resourceId);
    if (!resource?.active) return false;
    if (demand.teamId && allocation.teamId !== demand.teamId) return false;
    if (demand.orgUnitId && resource.orgUnitId !== demand.orgUnitId) return false;
    if (demand.skill && !resource.skills.includes(demand.skill)) return false;
    return overlapRatio(allocation.periodStart,allocation.periodEnd,demand.periodStart,demand.periodEnd)>0;
  }

  private matchedDemandHours(demand: ResourceDemandRecord): number {
    return this.repo.listAllocationsForProject(demand.projectId)
      .filter((allocation)=>this.allocationMatchesDemand(allocation,demand))
      .reduce((sum,allocation)=>sum+allocation.hours*overlapRatio(allocation.periodStart,allocation.periodEnd,demand.periodStart,demand.periodEnd),0);
  }

  private remainingDemandHours(demand: ResourceDemandRecord): number {
    if (demand.state==='cancelled'||demand.state==='filled') return 0;
    return Math.max(0,demand.requiredHours-this.matchedDemandHours(demand));
  }

  private reconcileDemands(projectId: string): void {
    for (const demand of this.repo.listDemandsForProject(projectId)) {
      if (demand.state==='cancelled') continue;
      const matched=this.matchedDemandHours(demand);
      const state:ResourceDemandRecord['state']=matched<=0.001?'open':matched+0.001>=demand.requiredHours?'filled':'partially-filled';
      if (state===demand.state) continue;
      this.repo.updateDemand({...demand,state,revision:demand.revision+1});
    }
  }

  private requireResource(id: string): ResourceRecord {
    const resource = this.repo.getResource(id);
    if (!resource || !resource.active) throw new GoliathError('NOT_FOUND', 'Active resource not found.');
    return resource;
  }
}
