import type { EvidenceConfidence } from '../control/types.js';
import type { UserRole } from '../ux/navigation.js';

export type ProjectLifecycle = 'draft' | 'ready' | 'active' | 'on-hold' | 'closing' | 'closed';
export type ActivityStatus = 'not-started' | 'in-progress' | 'done' | 'blocked' | 'cancelled';
export type ProjectPermission =
  | 'project:view-summary'
  | 'project:view-full'
  | 'project:transition'
  | 'plan:edit'
  | 'activity:view-all'
  | 'activity:view-team'
  | 'activity:view-own'
  | 'activity:update-all'
  | 'activity:update-team'
  | 'activity:update-own'
  | 'activity:assign-all'
  | 'activity:assign-team'
  | 'people:view-all'
  | 'people:view-team'
  | 'money:view'
  | 'money:view-summary'
  | 'attention:view-all'
  | 'attention:view-team'
  | 'attention:view-own'
  | 'decision:view'
  | 'decision:approve'
  | 'decision:prepare'
  | 'handoff:respond'
  | 'report:view'
  | 'portfolio:view'
  | 'admin:integrations'
  | 'admin:policy';

export interface ProjectRecord {
  id: string;
  organisationId: string;
  code: string;
  name: string;
  lifecycle: ProjectLifecycle;
  pmId: string;
  sponsorId?: string;
  timezone: string;
  baselineVersion?: string;
  baselineAccepted: boolean;
  materialOutcomesConfirmed: boolean;
  firstWorkReady: boolean;
  requiredTeamLeadsAssigned: boolean;
  legitimateEvidenceSourceAvailable: boolean;
  baselineFinish?: string;
  forecastFinish?: string;
  budget?: number;
  eac?: number;
  currency?: string;
  evidenceConfidence: EvidenceConfidence;
  sourceHealthSummary: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  displayName: string;
  role: UserRole;
  teamId?: string;
  active: boolean;
  permissions: readonly ProjectPermission[];
  joinedAt: string;
}

export interface ActivityRecord {
  id: string;
  projectId: string;
  phase: string;
  title: string;
  description?: string;
  status: ActivityStatus;
  baselineStart?: string;
  baselineFinish?: string;
  forecastFinish?: string;
  actualStart?: string;
  actualFinish?: string;
  plannedTeamId?: string;
  currentTeamId?: string;
  ownerId?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  percentComplete?: number;
  milestone: boolean;
  sourceSystem?: string;
  sourceRef?: string;
  evidenceRefs: readonly string[];
  blocker?: string;
  revision: number;
}

export interface DependencyRecord {
  id: string;
  projectId: string;
  predecessorActivityId: string;
  successorActivityId: string;
  gateType: 'finish-to-start' | 'accepted-deliverable';
  mandatory: boolean;
}

export interface AssignmentRecord {
  id: string;
  projectId: string;
  activityId: string;
  assigneeId: string;
  teamId?: string;
  supportOwnerIds: readonly string[];
  assignedBy: string;
  effectiveFrom: string;
  endedAt?: string;
  reason?: string;
  revision: number;
}

export interface DecisionRecord {
  id: string;
  projectId: string;
  attentionItemId: string;
  decisionOwnerId: string;
  decidedBy?: string;
  state: 'pending' | 'approved' | 'rejected' | 'selected' | 'superseded';
  choice?: string;
  reason?: string;
  evidenceRefs: readonly string[];
  createdAt: string;
  decidedAt?: string;
  revision: number;
}

export interface HandoffRecord {
  id: string;
  projectId: string;
  sourceActivityId: string;
  targetActivityId: string;
  senderId: string;
  receiverId: string;
  deliverableVersion: string;
  state: 'ready' | 'accepted' | 'returned';
  requiredChecksPassed: number;
  requiredChecksTotal: number;
  blockingConditions: readonly string[];
  nonBlockingConditions: readonly string[];
  attempt: number;
  returnedReason?: string;
  acceptedAt?: string;
  revision: number;
}

export interface SourceStateRecord {
  id: string;
  projectId: string;
  sourceType: string;
  sourceRef: string;
  authority: string;
  status: 'current' | 'stale' | 'unavailable' | 'unconfigured';
  lastObservedAt?: string;
  freshnessHours: number;
  classification: 'public' | 'internal' | 'confidential' | 'restricted';
  revision: number;
}

export interface WorkActionRecord {
  id: string;
  projectId: string;
  attentionItemId?: string;
  activityId?: string;
  type: 'corrective' | 'evidence-request' | 'decision-preparation' | 'manual';
  title: string;
  ownerId: string;
  dueAt?: string;
  state: 'open' | 'done' | 'cancelled';
  createdBy: string;
  createdAt: string;
  completedAt?: string;
  sourceRefs: readonly string[];
  revision: number;
}

export interface ProjectEventRecord {
  id: string;
  projectId: string;
  actorId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  result: 'allowed' | 'denied' | 'recorded';
  reason: string;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  beforeRevision?: number;
  afterRevision?: number;
  sourceRefs: readonly string[];
  metadata?: Readonly<Record<string, unknown>>;
  previousHash?: string;
  eventHash: string;
}

export interface StoredProjectionRecord {
  id: string;
  projectId: string;
  audience: 'pm' | 'program' | 'sponsor';
  generatedAt: string;
  headline: string;
  projectionHash: string;
  projectionJson: string;
  sourceRefs: readonly string[];
}

export interface ProjectCreateInput {
  id: string;
  organisationId: string;
  code: string;
  name: string;
  pmId: string;
  sponsorId?: string;
  timezone: string;
  baselineFinish?: string;
  budget?: number;
  currency?: string;
}

export interface ActivityCreateInput extends Omit<ActivityRecord, 'revision' | 'evidenceRefs'> {
  evidenceRefs?: readonly string[];
}

export interface PersonalWorkspace {
  actorId: string;
  role: UserRole;
  projectId: string;
  projectName: string;
  lifecycle: ProjectLifecycle;
  permissions: readonly ProjectPermission[];
  navigation: {
    global: readonly string[];
    project: readonly string[];
  };
  capabilities: {
    canAssign: boolean;
    canReassign: boolean;
    canApprove: boolean;
    canEditPlan: boolean;
    canViewMoney: boolean;
    canViewPeople: boolean;
    canTransitionProject: boolean;
  };
  attentionIds: readonly string[];
  activities: readonly ActivityRecord[];
  decisions: readonly DecisionRecord[];
  handoffs: readonly HandoffRecord[];
  workActions: readonly WorkActionRecord[];
}
