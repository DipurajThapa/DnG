export interface ResourceRecord {
  id: string;
  userId?: string;
  displayName: string;
  organisationId: string;
  orgUnitId: string;
  active: boolean;
  skills: readonly string[];
  weeklyContractHours: number;
  createdAt: string;
  revision: number;
}

export interface CapacityPeriodRecord {
  id: string;
  resourceId: string;
  periodStart: string;
  periodEnd: string;
  grossHours: number;
  unavailableHours: number;
  sourceRef?: string;
  revision: number;
}

export interface ResourceAllocationRecord {
  id: string;
  resourceId: string;
  projectId: string;
  activityId?: string;
  teamId?: string;
  periodStart: string;
  periodEnd: string;
  hours: number;
  status: 'requested' | 'confirmed' | 'released';
  createdBy: string;
  createdAt: string;
  reason?: string;
  revision: number;
}

export interface ResourceDemandRecord {
  id: string;
  projectId: string;
  teamId?: string;
  orgUnitId?: string;
  skill?: string;
  periodStart: string;
  periodEnd: string;
  requiredHours: number;
  state: 'open' | 'partially-filled' | 'filled' | 'cancelled';
  requestedBy: string;
  createdAt: string;
  revision: number;
}

export interface ResourceCapacityLine {
  resourceId: string;
  displayName: string;
  orgUnitId: string;
  skills: readonly string[];
  grossHours: number;
  unavailableHours: number;
  confirmedAllocationHours: number;
  availableHours: number;
  utilizationPercent?: number;
  capacityKnown: boolean;
  conflict: boolean;
  projectAllocations: readonly { projectId: string; hours: number }[];
}

export interface CapacityView {
  periodStart: string;
  periodEnd: string;
  resources: readonly ResourceCapacityLine[];
  totalGrossHours: number;
  totalUnavailableHours: number;
  totalAllocatedHours: number;
  totalAvailableHours: number;
  openDemandHours: number;
  missingCapacityResourceIds: readonly string[];
  demands: readonly ResourceDemandRecord[];
}

export interface ResourceWorklogRecord {
  id: string;
  resourceId: string;
  projectId: string;
  activityId?: string;
  workDate: string;
  hours: number;
  billable: boolean;
  sourceSystem: string;
  sourceRef: string;
  sourceRevision: string;
  createdAt: string;
  revision: number;
}
