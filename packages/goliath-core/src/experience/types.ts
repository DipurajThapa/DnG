import type { ActingContext, ResponsibilityRole } from '../context/types.js';
import type { AttentionAction, ConsequenceLevel, EvidenceConfidence } from '../control/types.js';
import type {
  ActivityRecord,
  DecisionRecord,
  DependencyRecord,
  HandoffRecord,
  ProjectLifecycle,
  SourceStateRecord,
  WorkActionRecord,
} from '../project/types.js';
import type { AttentionItem } from '../control/types.js';
import type { FinanceProjection } from '../finance/types.js';
import type { CapacityView } from '../resource/types.js';
import type { TraceabilitySnapshot } from '../trace/metrics.js';
import type { RoleExperienceProfile } from './config.js';

export interface ExperienceProjectCard {
  projectId: string;
  code: string;
  name: string;
  lifecycle: ProjectLifecycle;
  baselineFinish?: string;
  forecastFinish?: string;
  openAttention: number;
  criticalAttention: number;
  blockedActivities: number;
  overdueActivities: number;
  unownedActivities: number;
  sourceHealthSummary: string;
  budgetVariance?: number;
}


export interface RoleAttentionSummary {
  attentionId: string;
  projectId: string;
  title: string;
  consequence: ConsequenceLevel;
  confidence: EvidenceConfidence;
  nextAction: AttentionAction;
  ownerId?: string;
  decisionOwnerId?: string;
  dueAt?: string;
}

export interface RoleCapabilities {
  canAssignProjectWork: boolean;
  canAssignTeamWork: boolean;
  canAllocateResources: boolean;
  canApproveDecisions: boolean;
  canManageProject: boolean;
  canViewProjectFinance: boolean;
  canViewCommercialFinance: boolean;
  canManageGovernance: boolean;
  canRequestResourceDemand: boolean;
  canRespondHandoff: boolean;
  canCoordinateTeam: boolean;
}

export interface RoleWorkspace {
  actorId: string;
  context: ActingContext;
  profile: RoleExperienceProfile;
  role: ResponsibilityRole;
  scopeLabel: string;
  availableProjectIds: readonly string[];
  capabilities: RoleCapabilities;
  projects: readonly ExperienceProjectCard[];
  attention: readonly RoleAttentionSummary[];
  selectedProject?: {
    projectId: string;
    code: string;
    name: string;
    lifecycle: ProjectLifecycle;
    baselineFinish?: string;
    forecastFinish?: string;
    evidenceConfidence: 'high' | 'medium' | 'low' | 'unknown';
    sourceHealthSummary: string;
    activities: readonly ActivityRecord[];
    /** Minimal governed project targets exposed so limited-role users can complete legitimate handoffs without receiving full project-plan visibility. */
    handoffTargets: readonly Pick<ActivityRecord,'id'|'title'|'status'|'plannedTeamId'|'currentTeamId'>[];
    members: readonly import('../project/types.js').ProjectMember[];
    fullActivityCount: number;
    attentionIds: readonly string[];
    attentionItems: readonly AttentionItem[];
    decisionIds: readonly string[];
    decisions: readonly DecisionRecord[];
    handoffIds: readonly string[];
    handoffs: readonly HandoffRecord[];
    dependencies: readonly DependencyRecord[];
    sources: readonly SourceStateRecord[];
    workActions: readonly WorkActionRecord[];
    finance?: FinanceProjection;
    capacity?: CapacityView;
    traceability?: TraceabilitySnapshot;
  };
  functionalCapacity?: CapacityView;
  administration?: {
    responsibilityContexts: number;
    organisationIds: readonly string[];
    users: readonly import('../context/types.js').UserDirectoryEntry[];
  };
}
