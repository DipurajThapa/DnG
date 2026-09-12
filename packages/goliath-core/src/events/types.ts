import type { SourceStateRecord } from '../project/types.js';
import type { ActivityProgressUpdate } from '../project/service.js';
import type { FinanceEntryRecord } from '../finance/types.js';
import type { CapacityPeriodRecord, ResourceAllocationRecord } from '../resource/types.js';
import type { ControlCycleOutcome } from '../project/coordinator.js';

export type EnterpriseProjectEventKind =
  | 'activity.changed'
  | 'source.health.changed'
  | 'finance.entry.changed'
  | 'resource.capacity.changed'
  | 'resource.allocation.changed'
  | 'resource.worklog.changed'
  | 'meeting.transcript.received';

export interface EnterpriseProjectEventBase {
  projectId: string;
  organisationId: string;
  kind: EnterpriseProjectEventKind;
  sourceSystem: string;
  sourceTenant: string;
  sourceEventId: string;
  sourceRef: string;
  sourceRevision: string;
  sourceEffectiveAt: string;
  observedAt: string;
  correlationId: string;
}

export type EnterpriseProjectEvent =
  | (EnterpriseProjectEventBase & { kind: 'activity.changed'; entityId: string; payload: ActivityProgressUpdate })
  | (EnterpriseProjectEventBase & { kind: 'source.health.changed'; entityId: string; payload: { status: SourceStateRecord['status']; lastObservedAt?: string; freshnessHours?: number } })
  | (EnterpriseProjectEventBase & { kind: 'finance.entry.changed'; entityId: string; payload: Omit<FinanceEntryRecord, 'id' | 'projectId' | 'sourceSystem' | 'sourceRef' | 'sourceRevision' | 'revision'> })
  | (EnterpriseProjectEventBase & { kind: 'resource.capacity.changed'; entityId: string; payload: Omit<CapacityPeriodRecord, 'id' | 'resourceId' | 'sourceRef' | 'revision'> & { capacityId?: string } })
  | (EnterpriseProjectEventBase & { kind: 'resource.allocation.changed'; entityId: string; payload: Omit<ResourceAllocationRecord, 'id' | 'projectId' | 'createdBy' | 'createdAt' | 'revision'> })
  | (EnterpriseProjectEventBase & { kind: 'resource.worklog.changed'; entityId: string; payload: { resourceId:string; activityId?:string; workDate:string; hours:number; billable:boolean } })
  | (EnterpriseProjectEventBase & { kind: 'meeting.transcript.received'; entityId: string; payload: { transcriptRef:string; text:string; meetingTitle?:string } });

export interface EnterpriseEventOutcome {
  eventId: string;
  status: 'applied' | 'duplicate' | 'stale';
  changed: boolean;
  control?: ControlCycleOutcome;
}
