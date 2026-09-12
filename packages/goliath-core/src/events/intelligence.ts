import { randomUUID } from 'node:crypto';
import { digest } from '../core/hash.js';
import { GoliathError } from '../core/errors.js';
import { FinanceService } from '../finance/service.js';
import { ProjectControlCoordinator, type ControlCycleOutcome } from '../project/coordinator.js';
import { ProjectControlService, type ActivityProgressUpdate } from '../project/service.js';
import { SqlProjectRepository } from '../project/sqlite-repository.js';
import { ResourceCapacityService } from '../resource/service.js';
import type { ActivityRecord } from '../project/types.js';
import type { EnterpriseEventOutcome, EnterpriseProjectEvent } from './types.js';

function parseTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new GoliathError('INVALID_INPUT', `${label} must be a valid date/time.`);
  return parsed;
}

function claimId(event: EnterpriseProjectEvent): string {
  return `enterprise:${digest({ sourceSystem:event.sourceSystem, sourceTenant:event.sourceTenant, sourceEventId:event.sourceEventId, kind:event.kind, sourceRef:event.sourceRef }).slice(0, 48)}`;
}

function payloadDigest(event: EnterpriseProjectEvent): string {
  return digest({
    projectId:event.projectId, organisationId:event.organisationId, kind:event.kind, entityId:event.entityId,
    sourceSystem:event.sourceSystem, sourceTenant:event.sourceTenant, sourceRef:event.sourceRef, sourceRevision:event.sourceRevision,
    sourceEffectiveAt:event.sourceEffectiveAt, payload:event.payload,
  });
}

function sameActivityUpdate(current: ActivityRecord, update: ActivityProgressUpdate): boolean {
  if (update.status !== undefined && update.status !== current.status) return false;
  if (update.forecastFinish !== undefined && update.forecastFinish !== current.forecastFinish) return false;
  if (update.actualStart !== undefined && update.actualStart !== current.actualStart) return false;
  if (update.actualFinish !== undefined && update.actualFinish !== current.actualFinish) return false;
  if (update.percentComplete !== undefined && update.percentComplete !== current.percentComplete) return false;
  if (update.blocker !== undefined && (update.blocker ?? undefined) !== current.blocker) return false;
  if (update.evidenceRefs !== undefined && update.evidenceRefs.some((ref) => !current.evidenceRefs.includes(ref))) return false;
  return true;
}

export interface ProjectControlRunner {
  run(projectId: string): Promise<ControlCycleOutcome>;
}

/**
 * Normalized enterprise-event boundary. Connector/provider specifics stay upstream;
 * this service applies already-authorized project-relevant facts to canonical GOLIATH
 * records, then runs one deterministic/AI-assisted control cycle.
 */
export class EnterpriseEventIntelligenceService {
  constructor(
    private readonly projects: SqlProjectRepository,
    private readonly projectService: ProjectControlService,
    private readonly resources: ResourceCapacityService,
    private readonly finance: FinanceService,
    private readonly control: ProjectControlRunner | ProjectControlCoordinator,
    private readonly now: () => Date = () => new Date(),
    private readonly meeting?: { ingest(event: Extract<EnterpriseProjectEvent,{kind:'meeting.transcript.received'}>): Promise<number> },
  ) {}

  async process(event: EnterpriseProjectEvent): Promise<EnterpriseEventOutcome> {
    parseTime(event.sourceEffectiveAt, 'sourceEffectiveAt');
    parseTime(event.observedAt, 'observedAt');
    if (!event.sourceSystem.trim() || !event.sourceTenant.trim() || !event.sourceEventId.trim() || !event.sourceRef.trim() || !event.sourceRevision.trim()) {
      throw new GoliathError('INVALID_INPUT', 'Enterprise event source identity is incomplete.');
    }
    const project = this.projects.getProject(event.projectId);
    if (!project) throw new GoliathError('NOT_FOUND', 'Project not found.');
    if (project.organisationId !== event.organisationId) throw new GoliathError('ACCESS_DENIED', 'Enterprise event organisation does not match the project.');
    this.preflightSourceAuthority(event);

    const id = claimId(event);
    const digestValue = payloadDigest(event);
    const processedId = `${id}:processed`;
    const existingClaim = this.projects.getEvent(id);
    if (existingClaim) {
      if (String(existingClaim.metadata?.payloadDigest ?? '') !== digestValue) {
        this.projects.appendEvent({ id:randomUUID(), projectId:event.projectId, actorId:'system:event-intelligence', eventType:'enterprise.event.integrity-conflict',
          entityType:event.kind, entityId:event.entityId, result:'denied', reason:'The same external event identity arrived with different content.',
          occurredAt:this.now().toISOString(), correlationId:event.correlationId, sourceRefs:[event.sourceRef], metadata:{ claimId:id, sourceSystem:event.sourceSystem, sourceEventId:event.sourceEventId } });
        throw new GoliathError('DUPLICATE_EVENT', 'External event identity was reused with different content.');
      }
      if (this.projects.getEvent(processedId)) return { eventId:id, status:'duplicate', changed:false };
    } else {
      this.projects.appendEvent({ id, projectId:event.projectId, actorId:'system:event-intelligence', eventType:'enterprise.event.accepted', entityType:event.kind, entityId:event.entityId,
        result:'recorded', reason:'Normalized enterprise event accepted for canonical reconciliation.', occurredAt:event.observedAt, correlationId:event.correlationId,
        sourceRefs:[event.sourceRef], metadata:{ payloadDigest:digestValue, sourceSystem:event.sourceSystem, sourceTenant:event.sourceTenant, sourceEventId:event.sourceEventId,
          sourceRevision:event.sourceRevision, sourceEffectiveAt:event.sourceEffectiveAt, kind:event.kind, entityId:event.entityId, sourceRef:event.sourceRef } });
    }

    const latest = this.latestProcessedEffectiveAt(event);
    if (latest !== undefined && parseTime(event.sourceEffectiveAt,'sourceEffectiveAt') < latest) {
      this.markProcessed(processedId,event,id,'stale');
      return { eventId:id, status:'stale', changed:false };
    }

    try {
      const changed = await this.apply(event);
      const control = await this.control.run(event.projectId);
      this.markProcessed(processedId,event,id,'applied');
      return { eventId:id, status:'applied', changed, control };
    } catch (error) {
      this.projects.appendEvent({ id:randomUUID(), projectId:event.projectId, actorId:'system:event-intelligence', eventType:'enterprise.event.processing-failed', entityType:event.kind,
        entityId:event.entityId, result:'recorded', reason:error instanceof Error ? error.message : 'Enterprise event processing failed.', occurredAt:this.now().toISOString(),
        correlationId:event.correlationId, causationId:id, sourceRefs:[event.sourceRef], metadata:{ claimId:id, retryable:true } });
      throw error;
    }
  }

  private preflightSourceAuthority(event: EnterpriseProjectEvent): void {
    if (event.kind === 'activity.changed') {
      const activity = this.projects.getActivity(event.entityId);
      if (!activity || activity.projectId !== event.projectId) throw new GoliathError('NOT_FOUND', 'Mapped activity was not found in the event project.');
      const wrongRef = activity.sourceRef !== undefined && activity.sourceRef !== event.sourceRef;
      const wrongSystem = activity.sourceSystem !== undefined && activity.sourceSystem.toLowerCase() !== event.sourceSystem.toLowerCase();
      if (wrongRef || wrongSystem) this.rejectSourceAuthority(event, 'Activity event does not match the activity authoritative source identity.');
    }
    if (event.kind === 'resource.allocation.changed') {
      const prior = this.projects.listEvents(event.projectId).find((record) => record.eventType === 'enterprise.event.processed'
        && record.metadata?.kind === event.kind && record.metadata?.entityId === event.entityId && typeof record.metadata?.sourceRef === 'string');
      if (prior && (prior.metadata?.sourceRef !== event.sourceRef || String(prior.metadata?.sourceSystem ?? '').toLowerCase() !== event.sourceSystem.toLowerCase())) {
        this.rejectSourceAuthority(event, 'Allocation source authority cannot switch without an explicit governed remapping.');
      }
    }
  }

  private rejectSourceAuthority(event: EnterpriseProjectEvent, reason: string): never {
    this.projects.appendEvent({ id:randomUUID(), projectId:event.projectId, actorId:'system:event-intelligence', eventType:'enterprise.event.source-authority-denied',
      entityType:event.kind, entityId:event.entityId, result:'denied', reason, occurredAt:this.now().toISOString(), correlationId:event.correlationId, sourceRefs:[event.sourceRef],
      metadata:{ sourceSystem:event.sourceSystem, sourceTenant:event.sourceTenant, sourceEventId:event.sourceEventId } });
    throw new GoliathError('FIELD_AUTHORITY_DENIED', reason);
  }

  private async apply(event: EnterpriseProjectEvent): Promise<boolean> {
    switch (event.kind) {
      case 'activity.changed': {
        const current = this.projects.getActivity(event.entityId);
        if (!current || current.projectId !== event.projectId) throw new GoliathError('NOT_FOUND', 'Mapped activity was not found in the event project.');
        if (sameActivityUpdate(current,event.payload)) return false;
        this.projectService.applySourceActivityUpdate(event.projectId,event.entityId,event.sourceRef,event.payload,event.correlationId);
        return true;
      }
      case 'source.health.changed': {
        const current = this.projects.listSources(event.projectId).find((source) => source.id === event.entityId && source.sourceRef === event.sourceRef);
        if (!current) throw new GoliathError('NOT_FOUND','Mapped project source was not found.');
        const next = this.projectService.reconcileSourceState(event.projectId,event.sourceRef,event.payload,event.correlationId);
        return next.revision !== current.revision;
      }
      case 'finance.entry.changed': {
        const before = this.financeEntry(event.sourceSystem,event.sourceRef);
        const next = this.finance.ingestAuthoritativeEntry({ ...event.payload, projectId:event.projectId, sourceSystem:event.sourceSystem, sourceRef:event.sourceRef,
          sourceRevision:event.sourceRevision },'system:event-intelligence');
        return !before || next.revision !== before.revision;
      }
      case 'resource.capacity.changed': {
        const before = this.resources.getCapacityRecord(event.entityId,event.payload.periodStart,event.payload.periodEnd);
        const next = this.resources.ingestAuthoritativeCapacity({ id:event.payload.capacityId ?? before?.id ?? `capacity:${event.entityId}:${event.payload.periodStart}:${event.payload.periodEnd}`,
          resourceId:event.entityId, periodStart:event.payload.periodStart, periodEnd:event.payload.periodEnd, grossHours:event.payload.grossHours,
          unavailableHours:event.payload.unavailableHours, sourceRef:event.sourceRef, revision:(before?.revision ?? 0)+1 },'system:event-intelligence');
        return !before || next.revision !== before.revision;
      }
      case 'resource.allocation.changed': {
        const before = this.resources.getAllocationRecord(event.entityId);
        const next = this.resources.ingestAuthoritativeAllocation({ id:event.entityId, projectId:event.projectId, ...event.payload },'system:event-intelligence');
        return !before || next.revision !== before.revision;
      }
      case 'resource.worklog.changed': {
        const before=this.resources.repo.getWorklogBySource(event.sourceSystem,event.sourceRef);
        const next=this.resources.ingestAuthoritativeWorklog({id:event.entityId,resourceId:event.payload.resourceId,projectId:event.projectId,...(event.payload.activityId?{activityId:event.payload.activityId}:{}),workDate:event.payload.workDate,hours:event.payload.hours,billable:event.payload.billable,sourceSystem:event.sourceSystem,sourceRef:event.sourceRef,sourceRevision:event.sourceRevision},'system:event-intelligence');
        return !before || next.revision!==before.revision;
      }
      case 'meeting.transcript.received': {
        if(!this.meeting) return false;
        return (await this.meeting.ingest(event))>0;
      }
    }
  }

  private financeEntry(sourceSystem: string, sourceRef: string) {
    return this.finance.getAuthoritativeEntryBySource(sourceSystem,sourceRef);
  }

  private latestProcessedEffectiveAt(event: EnterpriseProjectEvent): number | undefined {
    let latest: number | undefined;
    for (const record of this.projects.listEvents(event.projectId)) {
      if (record.eventType !== 'enterprise.event.processed') continue;
      if (record.metadata?.kind !== event.kind || record.metadata?.entityId !== event.entityId || record.metadata?.sourceRef !== event.sourceRef) continue;
      const value = record.metadata?.sourceEffectiveAt;
      if (typeof value !== 'string') continue;
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed) && (latest === undefined || parsed > latest)) latest = parsed;
    }
    return latest;
  }

  private markProcessed(processedId: string, event: EnterpriseProjectEvent, causationId: string, outcome: 'applied' | 'stale'): void {
    if (this.projects.getEvent(processedId)) return;
    this.projects.appendEvent({ id:processedId, projectId:event.projectId, actorId:'system:event-intelligence', eventType:'enterprise.event.processed', entityType:event.kind,
      entityId:event.entityId, result:'recorded', reason:outcome === 'stale' ? 'Older source event retained for audit but ignored.' : 'Enterprise event reconciled and project control cycle completed.',
      occurredAt:this.now().toISOString(), correlationId:event.correlationId, causationId, sourceRefs:[event.sourceRef], metadata:{ outcome, kind:event.kind, entityId:event.entityId,
        sourceRef:event.sourceRef, sourceSystem:event.sourceSystem, sourceRevision:event.sourceRevision, sourceEffectiveAt:event.sourceEffectiveAt } });
  }
}
