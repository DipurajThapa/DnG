import { GoliathError } from './errors.js';
import type {
  AuditEvent,
  EffectIntent,
  ExternalMapping,
  IntegrationBinding,
  ProjectionRecord,
  ProviderReceipt,
  SourceIdentity,
} from './types.js';

export type InboxState = 'processing' | 'held' | 'applied';
export type EventClaimResult = 'acquired' | 'duplicate' | 'conflict';

export interface IntegrationRepository {
  putBinding(binding: IntegrationBinding): void;
  getBinding(id: string): IntegrationBinding | undefined;
  putMapping(mapping: ExternalMapping): void;
  findMapping(bindingId: string, external: SourceIdentity): ExternalMapping | undefined;
  claimEvent(key: string, payloadDigest: string): EventClaimResult;
  completeEvent(key: string, state: Exclude<InboxState, 'processing'>): void;
  releaseEvent(key: string): void;
  getProjection(projectId: string, entityType: string, entityId: string): ProjectionRecord | undefined;
  putProjection(record: ProjectionRecord): void;
  putIntent(intent: EffectIntent): void;
  getIntent(id: string): EffectIntent | undefined;
  putReceipt(receipt: ProviderReceipt): void;
  getReceiptForIntent(intentId: string): ProviderReceipt | undefined;
  listReceiptsForIntent(intentId: string): readonly ProviderReceipt[];
  appendAudit(event: AuditEvent): void;
  listAudit(): readonly AuditEvent[];
}

interface InboxRecord {
  payloadDigest: string;
  state: InboxState;
}

export class InMemoryIntegrationRepository implements IntegrationRepository {
  readonly bindings = new Map<string, IntegrationBinding>();
  readonly mappings = new Map<string, ExternalMapping>();
  readonly inbox = new Map<string, InboxRecord>();
  readonly projections = new Map<string, ProjectionRecord>();
  readonly intents = new Map<string, EffectIntent>();
  readonly receipts = new Map<string, ProviderReceipt[]>();
  readonly audit: AuditEvent[] = [];

  putBinding(binding: IntegrationBinding): void { this.bindings.set(binding.id, binding); }
  getBinding(id: string): IntegrationBinding | undefined { return this.bindings.get(id); }
  private mappingKey(bindingId: string, external: SourceIdentity): string {
    return [bindingId, external.provider, external.environment, external.accountId, external.resourceType, external.externalId].join(':');
  }
  putMapping(mapping: ExternalMapping): void { this.mappings.set(this.mappingKey(mapping.bindingId, mapping.external), mapping); }
  findMapping(bindingId: string, external: SourceIdentity): ExternalMapping | undefined { return this.mappings.get(this.mappingKey(bindingId, external)); }

  claimEvent(key: string, payloadDigest: string): EventClaimResult {
    const existing = this.inbox.get(key);
    if (existing) return existing.payloadDigest === payloadDigest ? 'duplicate' : 'conflict';
    this.inbox.set(key, { payloadDigest, state: 'processing' });
    return 'acquired';
  }

  completeEvent(key: string, state: Exclude<InboxState, 'processing'>): void {
    const existing = this.inbox.get(key);
    if (!existing || existing.state !== 'processing') throw new GoliathError('INVALID_INPUT', `Inbox event ${key} is not actively processing.`);
    this.inbox.set(key, { ...existing, state });
  }

  releaseEvent(key: string): void {
    const existing = this.inbox.get(key);
    if (existing?.state === 'processing') this.inbox.delete(key);
  }

  getProjection(projectId: string, entityType: string, entityId: string): ProjectionRecord | undefined {
    return this.projections.get(`${projectId}:${entityType}:${entityId}`);
  }
  putProjection(record: ProjectionRecord): void { this.projections.set(`${record.projectId}:${record.localEntityType}:${record.localEntityId}`, record); }
  putIntent(intent: EffectIntent): void { this.intents.set(intent.id, intent); }
  getIntent(id: string): EffectIntent | undefined { return this.intents.get(id); }
  putReceipt(receipt: ProviderReceipt): void {
    const current = this.receipts.get(receipt.intentId) ?? [];
    this.receipts.set(receipt.intentId, [...current, receipt]);
  }
  getReceiptForIntent(intentId: string): ProviderReceipt | undefined {
    const receipts = this.receipts.get(intentId);
    return receipts?.[receipts.length - 1];
  }
  listReceiptsForIntent(intentId: string): readonly ProviderReceipt[] { return this.receipts.get(intentId) ?? []; }
  appendAudit(event: AuditEvent): void { this.audit.push(event); }
  listAudit(): readonly AuditEvent[] { return this.audit; }
}
