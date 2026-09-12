import { randomUUID } from 'node:crypto';
import { GoliathError } from '../core/errors.js';
import { digest } from '../core/hash.js';
import { requireBindingEnabled, requireInboundFields, requireOutboundAction, requirePermission, requireProject } from '../core/policy.js';
import type { IntegrationRepository } from '../core/store.js';
import type {
  ActorContext,
  ApprovalEvidence,
  AuditEvent,
  EffectIntent,
  InboundObservation,
  IntegrationBinding,
  ProviderAdapter,
  ReconciliationResult,
} from '../core/types.js';
import { getDomainContract } from './catalog.js';

function audit(repo: IntegrationRepository, event: Omit<AuditEvent, 'id' | 'occurredAt'>): void {
  repo.appendAudit({ id: randomUUID(), occurredAt: new Date().toISOString(), ...event });
}

function parseTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new GoliathError('INVALID_INPUT', `${label} must be a valid ISO date/time.`);
  return parsed;
}

function requireMappingEffective(effectiveFrom: string, effectiveTo: string | undefined, sourceEffectiveAt: string): void {
  const factTime = parseTime(sourceEffectiveAt, 'sourceEffectiveAt');
  const from = parseTime(effectiveFrom, 'mapping effectiveFrom');
  const to = effectiveTo ? parseTime(effectiveTo, 'mapping effectiveTo') : undefined;
  if (factTime < from || (to !== undefined && factTime >= to)) {
    throw new GoliathError('MAPPING_REQUIRED', 'External mapping is not effective for the source fact time.');
  }
}

function requireIntentBindingIntegrity(binding: IntegrationBinding, intent: EffectIntent): void {
  if (
    binding.id !== intent.bindingId
    || binding.organisationId !== intent.organisationId
    || binding.projectId !== intent.projectId
    || binding.domain !== intent.domain
    || binding.provider !== intent.target.provider
    || binding.environment !== intent.target.environment
  ) {
    throw new GoliathError('ACCESS_DENIED', 'Effect intent no longer matches its authorised binding scope.');
  }
  requireBindingEnabled(binding);
  requireOutboundAction(binding, intent.action);
  if (digest(intent.exactPayload) !== intent.payloadDigest) {
    throw new GoliathError('INVALID_INPUT', 'Effect intent payload integrity check failed.');
  }
}

function requireApprovalMatches(
  approval: ApprovalEvidence,
  expected: {
    organisationId: string;
    projectId: string;
    bindingId: string;
    action: string;
    targetExternalId: string;
    payloadDigest: string;
  },
  nowMs: number,
): void {
  const fieldsMatch =
    approval.organisationId === expected.organisationId
    && approval.projectId === expected.projectId
    && approval.bindingId === expected.bindingId
    && approval.action === expected.action
    && approval.targetExternalId === expected.targetExternalId
    && approval.payloadDigest === expected.payloadDigest;
  if (!fieldsMatch) throw new GoliathError('APPROVAL_REQUIRED', 'Approval does not match the exact organisation/project/action/target/payload scope.');
  if (!approval.approvalId.trim() || !approval.approvedBy.trim() || !approval.approvalVersion.trim()) {
    throw new GoliathError('APPROVAL_REQUIRED', 'Approval identity/version is incomplete.');
  }
  const approvedAt = parseTime(approval.approvedAt, 'approval approvedAt');
  const expiresAt = parseTime(approval.expiresAt, 'approval expiresAt');
  if (approvedAt > nowMs) throw new GoliathError('APPROVAL_REQUIRED', 'Approval cannot become valid in the future.');
  if (expiresAt <= approvedAt || expiresAt <= nowMs) throw new GoliathError('APPROVAL_REQUIRED', 'Approval is expired or has an invalid validity window.');
}

export class IntegrationOrchestrator {
  constructor(
    private readonly repo: IntegrationRepository,
    private readonly adapters: Readonly<Record<string, ProviderAdapter>>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  ingest(actor: ActorContext, observation: InboundObservation): { applied: boolean; duplicate: boolean; revision?: number } {
    const binding = this.repo.getBinding(observation.bindingId);
    if (!binding) throw new GoliathError('NOT_FOUND', 'Binding not found.');
    requireProject(actor, binding.organisationId, binding.projectId);
    requirePermission(actor, 'integration.ingest');
    requireBindingEnabled(binding);
    if (binding.provider !== observation.source.provider || binding.environment !== observation.source.environment) {
      throw new GoliathError('INVALID_INPUT', 'Observation provider/environment does not match the binding.');
    }

    const contract = getDomainContract(binding.domain);
    const fields = Object.keys(observation.fields);
    requireInboundFields(binding, fields);
    const forbidden = fields.filter((f) => contract.sensitiveFields.includes(f));
    if (forbidden.length > 0) throw new GoliathError('FIELD_AUTHORITY_DENIED', `Sensitive fields cannot be imported: ${forbidden.join(', ')}`);

    // Mapping and its effective period are recoverable validation.  Do not claim
    // provider-event dedupe until these checks pass, otherwise a corrected
    // mapping could never replay the same authoritative event.
    const mapping = this.repo.findMapping(binding.id, observation.source);
    if (!mapping || mapping.tombstonedAt) throw new GoliathError('MAPPING_REQUIRED', 'External record is not mapped to a current GOLIATH entity.');
    if (mapping.organisationId !== binding.organisationId || mapping.projectId !== binding.projectId) {
      throw new GoliathError('ACCESS_DENIED', 'Cross-scope mapping rejected.');
    }
    requireMappingEffective(mapping.effectiveFrom, mapping.effectiveTo, observation.sourceEffectiveAt);

    const eventKey = `${binding.id}:${observation.source.accountId}:${observation.source.resourceType}:${observation.eventId}`;
    const claim = this.repo.claimEvent(eventKey, observation.payloadDigest);
    if (claim === 'duplicate') {
      audit(this.repo, {
        organisationId: binding.organisationId,
        projectId: binding.projectId,
        actorId: actor.actorId,
        action: 'integration.observation.duplicate',
        resourceType: binding.domain,
        resourceId: observation.eventId,
        result: 'recorded',
        reason: 'Duplicate provider event ignored without changing projection.',
        correlationId: observation.correlationId,
      });
      return { applied: false, duplicate: true };
    }
    if (claim === 'conflict') {
      audit(this.repo, {
        organisationId: binding.organisationId,
        projectId: binding.projectId,
        actorId: actor.actorId,
        action: 'integration.observation.integrity-conflict',
        resourceType: binding.domain,
        resourceId: observation.eventId,
        result: 'denied',
        reason: 'The same provider event identity arrived with a different payload digest.',
        correlationId: observation.correlationId,
      });
      throw new GoliathError('DUPLICATE_EVENT', 'Provider event identity was reused with different content.');
    }

    try {
      if (binding.authorityMode !== 'automatic-approved') {
        audit(this.repo, {
          organisationId: binding.organisationId,
          projectId: binding.projectId,
          actorId: actor.actorId,
          action: 'integration.observation.held',
          resourceType: mapping.localEntityType,
          resourceId: mapping.localEntityId,
          result: 'recorded',
          reason: 'Binding requires manual review before projection changes.',
          correlationId: observation.correlationId,
        });
        this.repo.completeEvent(eventKey, 'held');
        return { applied: false, duplicate: false };
      }

      const current = this.repo.getProjection(binding.projectId, mapping.localEntityType, mapping.localEntityId);
      const nextRevision = (current?.revision ?? 0) + 1;
      const nextValues = { ...(current?.values ?? {}), ...observation.fields };
      const nextSources = { ...(current?.sourceVersions ?? {}), [binding.domain]: observation.sourceVersion };
      this.repo.putProjection({
        organisationId: binding.organisationId,
        projectId: binding.projectId,
        localEntityType: mapping.localEntityType,
        localEntityId: mapping.localEntityId,
        values: nextValues,
        sourceVersions: nextSources,
        updatedAt: observation.observedAt,
        revision: nextRevision,
      });
      audit(this.repo, {
        organisationId: binding.organisationId,
        projectId: binding.projectId,
        actorId: actor.actorId,
        action: 'integration.observation.applied',
        resourceType: mapping.localEntityType,
        resourceId: mapping.localEntityId,
        result: 'allowed',
        reason: 'Authoritative approved source fields applied to shared projection.',
        correlationId: observation.correlationId,
        ...(current ? { beforeRevision: current.revision } : {}),
        afterRevision: nextRevision,
        metadata: { domain: binding.domain, sourceVersion: observation.sourceVersion, payloadDigest: observation.payloadDigest },
      });
      this.repo.completeEvent(eventKey, 'applied');
      return { applied: true, duplicate: false, revision: nextRevision };
    } catch (error) {
      // A local failure must not permanently poison the provider event identity.
      // The SQL-backed merge should execute claim, projection/audit, and final
      // inbox state in one transaction; this release mirrors that recovery rule.
      this.repo.releaseEvent(eventKey);
      throw error;
    }
  }

  prepareEffect(
    actor: ActorContext,
    input: {
      id?: string;
      bindingId: string;
      action: string;
      targetExternalId: string;
      targetResourceType: string;
      payload: Readonly<Record<string, unknown>>;
      correlationId: string;
      approval?: ApprovalEvidence;
    },
  ): EffectIntent {
    const binding = this.repo.getBinding(input.bindingId);
    if (!binding) throw new GoliathError('NOT_FOUND', 'Binding not found.');
    requireProject(actor, binding.organisationId, binding.projectId);
    requirePermission(actor, 'integration.effect.prepare');
    requireBindingEnabled(binding);
    requireOutboundAction(binding, input.action);
    const contract = getDomainContract(binding.domain);
    const payloadDigest = digest(input.payload);
    const approvalRequired = contract.requiredOutboundApproval.includes(input.action);
    if (approvalRequired && !input.approval) {
      throw new GoliathError('APPROVAL_REQUIRED', `Action ${input.action} requires business approval.`);
    }
    if (input.approval) {
      requireApprovalMatches(input.approval, {
        organisationId: binding.organisationId,
        projectId: binding.projectId,
        bindingId: binding.id,
        action: input.action,
        targetExternalId: input.targetExternalId,
        payloadDigest,
      }, this.now().getTime());
    }

    const intent: EffectIntent = {
      id: input.id ?? randomUUID(),
      organisationId: binding.organisationId,
      projectId: binding.projectId,
      bindingId: binding.id,
      domain: binding.domain,
      action: input.action,
      target: {
        provider: binding.provider,
        environment: binding.environment,
        accountId: 'bound-account',
        resourceType: input.targetResourceType,
        externalId: input.targetExternalId,
      },
      exactPayload: input.payload,
      payloadDigest,
      requestedBy: actor.actorId,
      requestedAt: this.now().toISOString(),
      state: input.approval ? 'approved' : 'prepared',
      ...(input.approval ? { approval: input.approval } : {}),
      correlationId: input.correlationId,
    };
    this.repo.putIntent(intent);
    audit(this.repo, {
      organisationId: binding.organisationId,
      projectId: binding.projectId,
      actorId: actor.actorId,
      action: 'integration.effect.prepared',
      resourceType: binding.domain,
      resourceId: intent.id,
      result: 'allowed',
      reason: input.approval ? 'Approved immutable effect intent prepared.' : 'Low-risk effect intent prepared.',
      correlationId: input.correlationId,
      metadata: { action: input.action, payloadDigest: intent.payloadDigest, approvalId: input.approval?.approvalId ?? null },
    });
    return intent;
  }

  async dispatch(actor: ActorContext, intentId: string): Promise<EffectIntent> {
    const intent = this.repo.getIntent(intentId);
    if (!intent) throw new GoliathError('NOT_FOUND', 'Effect intent not found.');
    requireProject(actor, intent.organisationId, intent.projectId);
    requirePermission(actor, 'integration.effect.dispatch');
    if (!['approved', 'prepared', 'retryable'].includes(intent.state)) {
      throw new GoliathError('INVALID_INPUT', `Intent state ${intent.state} cannot be dispatched; reconcile unknown outcomes before retrying.`);
    }

    const binding = this.repo.getBinding(intent.bindingId);
    if (!binding) throw new GoliathError('NOT_FOUND', 'Effect binding no longer exists.');
    requireIntentBindingIntegrity(binding, intent);
    const contract = getDomainContract(intent.domain);
    const approvalRequired = contract.requiredOutboundApproval.includes(intent.action);
    if (approvalRequired && !intent.approval) throw new GoliathError('APPROVAL_REQUIRED', 'Required approval is missing at dispatch.');
    if (intent.approval) {
      requireApprovalMatches(intent.approval, {
        organisationId: intent.organisationId,
        projectId: intent.projectId,
        bindingId: intent.bindingId,
        action: intent.action,
        targetExternalId: intent.target.externalId,
        payloadDigest: intent.payloadDigest,
      }, this.now().getTime());
    }

    const adapter = this.adapters[intent.target.provider];
    if (!adapter || !adapter.domains.includes(intent.domain)) throw new GoliathError('NOT_FOUND', 'Provider adapter for domain is unavailable.');
    const receipt = await adapter.dispatch(intent);
    if (receipt.intentId !== intent.id || receipt.provider !== intent.target.provider) {
      throw new GoliathError('INVALID_INPUT', 'Provider receipt identity does not match the dispatched intent.');
    }
    this.repo.putReceipt(receipt);
    const next: EffectIntent = {
      ...intent,
      state: receipt.result === 'rejected' ? 'rejected' : receipt.result === 'accepted' ? 'dispatched' : 'unknown',
      providerReceiptId: receipt.receiptId,
      providerReference: receipt.providerReference,
      ...(receipt.message ? { lastError: receipt.message } : {}),
    };
    this.repo.putIntent(next);
    audit(this.repo, {
      organisationId: intent.organisationId,
      projectId: intent.projectId,
      actorId: actor.actorId,
      action: 'integration.effect.dispatched',
      resourceType: intent.domain,
      resourceId: intent.id,
      result: receipt.result === 'rejected' ? 'denied' : 'recorded',
      reason: `Provider returned ${receipt.result}.`,
      correlationId: intent.correlationId,
      metadata: { providerReference: receipt.providerReference, receiptId: receipt.receiptId },
    });
    return next;
  }

  async reconcile(actor: ActorContext, intentId: string): Promise<ReconciliationResult> {
    const intent = this.repo.getIntent(intentId);
    if (!intent) throw new GoliathError('NOT_FOUND', 'Effect intent not found.');
    requireProject(actor, intent.organisationId, intent.projectId);
    requirePermission(actor, 'integration.effect.reconcile');
    if (!['dispatched', 'unknown', 'rejected', 'retryable'].includes(intent.state)) {
      throw new GoliathError('INVALID_INPUT', `Intent state ${intent.state} has no provider outcome to reconcile.`);
    }
    const binding = this.repo.getBinding(intent.bindingId);
    if (!binding) throw new GoliathError('NOT_FOUND', 'Effect binding no longer exists.');
    requireIntentBindingIntegrity(binding, intent);
    const adapter = this.adapters[intent.target.provider];
    if (!adapter || !adapter.domains.includes(intent.domain)) throw new GoliathError('NOT_FOUND', 'Provider adapter unavailable for domain.');
    const receipt = this.repo.getReceiptForIntent(intent.id);
    const result = await adapter.readBack(intent, receipt);
    if (result.intentId !== intent.id) throw new GoliathError('INVALID_INPUT', 'Reconciliation result does not match the intent.');
    const state = result.result === 'confirmed'
      ? 'confirmed'
      : result.result === 'rejected'
        ? 'rejected'
        : result.result === 'absent-safe-to-retry'
          ? 'retryable'
          : 'unknown';
    const next: EffectIntent = {
      ...intent,
      state,
      ...(result.providerReference ? { providerReference: result.providerReference } : {}),
      ...(result.result === 'manual-investigation' ? { lastError: 'Provider outcome requires manual investigation.' } : {}),
    };
    this.repo.putIntent(next);
    audit(this.repo, {
      organisationId: intent.organisationId,
      projectId: intent.projectId,
      actorId: actor.actorId,
      action: 'integration.effect.reconciled',
      resourceType: intent.domain,
      resourceId: intent.id,
      result: 'recorded',
      reason: result.result,
      correlationId: intent.correlationId,
      metadata: { reconciledAt: result.reconciledAt, nextState: state },
    });
    return result;
  }
}
