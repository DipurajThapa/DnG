export type OperationalDomain =
  | 'crm'
  | 'recruitment'
  | 'procurement'
  | 'contract'
  | 'billing'
  | 'cicd'
  | 'qa'
  | 'documents'
  | 'itsm'
  | 'logistics'
  | 'assets';

export type Classification = 'public' | 'internal' | 'confidential' | 'restricted';
export type AuthorityMode = 'manual-review' | 'automatic-approved';
export type EffectState = 'prepared' | 'approved' | 'dispatched' | 'confirmed' | 'rejected' | 'unknown' | 'retryable' | 'cancelled';

export interface ActorContext {
  actorId: string;
  organisationId: string;
  projectIds: readonly string[];
  permissions: readonly string[];
}

export interface SourceIdentity {
  provider: string;
  environment: string;
  accountId: string;
  resourceType: string;
  externalId: string;
}

export interface IntegrationBinding {
  id: string;
  organisationId: string;
  projectId: string;
  domain: OperationalDomain;
  provider: string;
  environment: string;
  enabled: boolean;
  authorityMode: AuthorityMode;
  allowedInboundFields: readonly string[];
  allowedOutboundActions: readonly string[];
  classification: Classification;
}

export interface ExternalMapping {
  id: string;
  organisationId: string;
  projectId: string;
  bindingId: string;
  external: SourceIdentity;
  localEntityType: string;
  localEntityId: string;
  mappingVersion: number;
  effectiveFrom: string;
  effectiveTo?: string;
  tombstonedAt?: string;
}

export interface InboundObservation {
  eventId: string;
  bindingId: string;
  source: SourceIdentity;
  sourceVersion: string;
  sourceEffectiveAt: string;
  observedAt: string;
  schemaVersion: string;
  fields: Readonly<Record<string, unknown>>;
  payloadDigest: string;
  correlationId: string;
}

export interface ProjectionRecord {
  organisationId: string;
  projectId: string;
  localEntityType: string;
  localEntityId: string;
  values: Readonly<Record<string, unknown>>;
  sourceVersions: Readonly<Record<string, string>>;
  updatedAt: string;
  revision: number;
}

/**
 * Business approval is bound to the exact effect being authorized.  A generic
 * approval label is deliberately insufficient for material external writes.
 */
export interface ApprovalEvidence {
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  approvalVersion: string;
  organisationId: string;
  projectId: string;
  bindingId: string;
  action: string;
  targetExternalId: string;
  payloadDigest: string;
}

export interface EffectIntent {
  id: string;
  organisationId: string;
  projectId: string;
  bindingId: string;
  domain: OperationalDomain;
  action: string;
  target: SourceIdentity;
  exactPayload: Readonly<Record<string, unknown>>;
  payloadDigest: string;
  requestedBy: string;
  requestedAt: string;
  state: EffectState;
  approval?: ApprovalEvidence;
  providerReceiptId?: string;
  providerReference?: string;
  lastError?: string;
  correlationId: string;
}

export interface ProviderReceipt {
  receiptId: string;
  intentId: string;
  provider: string;
  providerReference: string;
  acceptedAt: string;
  result: 'accepted' | 'rejected' | 'unknown';
  message?: string;
}

export interface ReconciliationResult {
  intentId: string;
  reconciledAt: string;
  result: 'confirmed' | 'rejected' | 'absent-safe-to-retry' | 'manual-investigation';
  providerReference?: string;
  observedState?: Readonly<Record<string, unknown>>;
}

export interface AuditEvent {
  id: string;
  organisationId: string;
  projectId?: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  result: 'allowed' | 'denied' | 'recorded';
  reason: string;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  beforeRevision?: number;
  afterRevision?: number;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderAdapter {
  readonly provider: string;
  readonly domains: readonly OperationalDomain[];
  dispatch(intent: EffectIntent): Promise<ProviderReceipt>;
  readBack(intent: EffectIntent, receipt?: ProviderReceipt): Promise<ReconciliationResult>;
}
