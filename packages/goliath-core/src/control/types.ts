export type ConsequenceLevel = 'critical' | 'high' | 'medium' | 'low';
export type EvidenceConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type AttentionAction = 'decide' | 'approve' | 'assign' | 'correct' | 'confirm' | 'accept' | 'return' | 'resolve' | 'none';
export type AttentionState = 'open' | 'waiting' | 'resolved' | 'dismissed';
export type SignalKind =
  | 'schedule'
  | 'budget'
  | 'resource'
  | 'quality'
  | 'acceptance'
  | 'dependency'
  | 'risk'
  | 'issue'
  | 'handoff'
  | 'evidence'
  | 'source-health';

export interface ProjectSignal {
  signalId: string;
  organisationId: string;
  projectId: string;
  kind: SignalKind;
  rootCauseKey: string;
  title: string;
  observedAt: string;
  consequence: ConsequenceLevel;
  confidence: EvidenceConfidence;
  material: boolean;
  situation: string;
  impact: string;
  ownerId?: string;
  decisionOwnerId?: string;
  dueAt?: string;
  sourceRefs: readonly string[];
  suggestedAction?: AttentionAction;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface AiOption {
  optionId: string;
  label: string;
  expectedEffect: string;
  risks: readonly string[];
  evidenceLimits: readonly string[];
}

export interface AiAssessment {
  assessmentId: string;
  generatedAt: string;
  modelLabel: string;
  summary: string;
  recommendedOptionId?: string;
  options: readonly AiOption[];
  missingInformation: readonly string[];
  confidence: EvidenceConfidence;
  sourceRefs: readonly string[];
  abstained: boolean;
  /** Hash of the attention/evidence basis used to avoid regenerating unchanged AI advice. */
  basisHash?: string;
}

export interface AttentionItem {
  id: string;
  organisationId: string;
  projectId: string;
  rootCauseKey: string;
  title: string;
  state: AttentionState;
  consequence: ConsequenceLevel;
  confidence: EvidenceConfidence;
  situation: string;
  impact: string;
  ownerId?: string;
  decisionOwnerId?: string;
  dueAt?: string;
  nextAction: AttentionAction;
  sourceSignalIds: readonly string[];
  sourceRefs: readonly string[];
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  aiAssessment?: AiAssessment;
  revision: number;
}

export interface AutonomousAction {
  actionId: string;
  attentionItemId: string;
  projectId: string;
  type: 'prepare-reminder' | 'prepare-decision-brief' | 'create-internal-action' | 'request-evidence' | 'no-op';
  rationale: string;
  requiresHumanAuthority: boolean;
  targetOwnerId?: string;
}

export interface AutonomousCycleResult {
  cycleId: string;
  projectId: string;
  observedSignals: number;
  materialSignals: number;
  attentionCreated: number;
  attentionUpdated: number;
  autoResolved: number;
  preparedActions: readonly AutonomousAction[];
  aiAssessments: number;
  suppressedAsNoMaterialChange: boolean;
  completedAt: string;
}

export interface ProjectOrientation {
  projectId: string;
  projectName: string;
  lifecycle: 'draft' | 'ready' | 'active' | 'closing' | 'closed' | 'on-hold';
  baselineVersion?: string;
  forecastFinish?: string;
  baselineFinish?: string;
  budget?: number;
  eac?: number;
  currency?: string;
  openAttentionCount: number;
  criticalAttentionCount: number;
  evidenceConfidence: EvidenceConfidence;
  sourceHealthSummary: string;
}
