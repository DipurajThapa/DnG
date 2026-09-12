import test from 'node:test';
import assert from 'node:assert/strict';
import {
  B14_DOMAIN_CONTRACTS,
  ContractTestAdapter,
  digest,
  GoliathError,
  InMemoryIntegrationRepository,
  IntegrationOrchestrator,
  type ActorContext,
  type ApprovalEvidence,
  type ExternalMapping,
  type IntegrationBinding,
  type ProjectionRecord,
  type ProviderAdapter,
} from '../src/index.js';

const actor: ActorContext = {
  actorId: 'pm-1', organisationId: 'org-1', projectIds: ['p-1'],
  permissions: ['integration.ingest', 'integration.effect.prepare', 'integration.effect.dispatch', 'integration.effect.reconcile'],
};
const FIXED_NOW = '2026-09-09T12:00:00Z';
const clock = () => new Date(FIXED_NOW);

function approvalFor(binding: IntegrationBinding, action: string, targetExternalId: string, payload: Readonly<Record<string, unknown>>, overrides: Partial<ApprovalEvidence> = {}): ApprovalEvidence {
  return {
    approvalId: 'ap-1',
    approvedBy: 'owner-1',
    approvedAt: '2026-09-09T10:10:00Z',
    expiresAt: '2026-09-10T10:10:00Z',
    approvalVersion: '1',
    organisationId: binding.organisationId,
    projectId: binding.projectId,
    bindingId: binding.id,
    action,
    targetExternalId,
    payloadDigest: digest(payload),
    ...overrides,
  };
}

function mappedBinding(domain: IntegrationBinding['domain'], provider: string, overrides: Partial<IntegrationBinding> = {}): { binding: IntegrationBinding; mapping: ExternalMapping } {
  const contract = B14_DOMAIN_CONTRACTS[domain];
  if (!contract) throw new Error(`Missing contract ${domain}`);
  const binding: IntegrationBinding = {
    id: `b-${domain}`, organisationId: 'org-1', projectId: 'p-1', domain,
    provider, environment: 'sandbox', enabled: true, authorityMode: 'automatic-approved',
    allowedInboundFields: contract.inboundFields, allowedOutboundActions: contract.outboundActions, classification: 'internal',
    ...overrides,
  };
  const mapping: ExternalMapping = {
    id: `m-${domain}`, organisationId: 'org-1', projectId: 'p-1', bindingId: binding.id,
    external: { provider, environment: 'sandbox', accountId: 'acct', resourceType: domain, externalId: 'ext-1' },
    localEntityType: 'activity', localEntityId: 'act-1', mappingVersion: 1, effectiveFrom: '2026-09-09T00:00:00Z',
  };
  return { binding, mapping };
}

for (const contract of Object.values(B14_DOMAIN_CONTRACTS)) {
  test(`B14 ${contract.domain}: inbound -> projection -> outbound -> confirmed read-back`, async () => {
    const repo = new InMemoryIntegrationRepository();
    const provider = `provider-${contract.domain}`;
    const { binding, mapping } = mappedBinding(contract.domain, provider);
    repo.putBinding(binding);
    repo.putMapping(mapping);
    const adapter = new ContractTestAdapter(provider, [contract.domain]);
    const orchestrator = new IntegrationOrchestrator(repo, { [provider]: adapter }, clock);
    const field = contract.inboundFields[0];
    if (!field) throw new Error(`No inbound field configured for ${contract.domain}`);
    const observation = {
      eventId: 'evt-1', bindingId: binding.id, source: mapping.external, sourceVersion: 'v1', sourceEffectiveAt: '2026-09-09T10:00:00Z',
      observedAt: '2026-09-09T10:00:01Z', schemaVersion: '1', fields: { [field]: 'value' }, payloadDigest: digest({ [field]: 'value' }), correlationId: 'corr-1',
    };
    const applied = orchestrator.ingest(actor, observation);
    assert.equal(applied.applied, true);
    assert.equal(repo.getProjection('p-1', 'activity', 'act-1')?.values[field], 'value');
    const duplicate = orchestrator.ingest(actor, observation);
    assert.equal(duplicate.duplicate, true);

    const action = contract.outboundActions[0];
    if (!action) return;
    const payload = { reason: 'validated test' };
    const approval = contract.requiredOutboundApproval.includes(action) ? approvalFor(binding, action, 'ext-1', payload) : undefined;
    const intent = orchestrator.prepareEffect(actor, {
      bindingId: binding.id, action, targetExternalId: 'ext-1', targetResourceType: contract.domain,
      payload, correlationId: 'corr-2', ...(approval ? { approval } : {}),
    });
    await orchestrator.dispatch(actor, intent.id);
    const result = await orchestrator.reconcile(actor, intent.id);
    assert.equal(result.result, 'confirmed');
    assert.equal(repo.getIntent(intent.id)?.state, 'confirmed');
  });
}

test('B14 mapping correction can replay the same provider event identity', () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding, mapping } = mappedBinding('crm', 'crm-provider');
  repo.putBinding(binding);
  const orchestrator = new IntegrationOrchestrator(repo, { 'crm-provider': new ContractTestAdapter('crm-provider', ['crm']) }, clock);
  const observation = { eventId: 'evt-recover', bindingId: binding.id, source: mapping.external, sourceVersion: '1', sourceEffectiveAt: '2026-09-09T10:00:00Z', observedAt: '2026-09-09T10:00:01Z', schemaVersion: '1', fields: { accountId: 'a1' }, payloadDigest: digest({ accountId: 'a1' }), correlationId: 'corr-recover' };
  assert.throws(() => orchestrator.ingest(actor, observation), (e: unknown) => e instanceof GoliathError && e.code === 'MAPPING_REQUIRED');
  repo.putMapping(mapping);
  assert.equal(orchestrator.ingest(actor, observation).applied, true);
});

test('B14 same event identity with changed payload is an integrity conflict, not a duplicate', () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding, mapping } = mappedBinding('crm', 'crm-provider');
  repo.putBinding(binding); repo.putMapping(mapping);
  const orchestrator = new IntegrationOrchestrator(repo, { 'crm-provider': new ContractTestAdapter('crm-provider', ['crm']) }, clock);
  orchestrator.ingest(actor, { eventId: 'evt-conflict', bindingId: binding.id, source: mapping.external, sourceVersion: '1', sourceEffectiveAt: '2026-09-09T10:00:00Z', observedAt: '2026-09-09T10:00:01Z', schemaVersion: '1', fields: { accountId: 'a1' }, payloadDigest: digest({ accountId: 'a1' }), correlationId: 'c1' });
  assert.throws(() => orchestrator.ingest(actor, { eventId: 'evt-conflict', bindingId: binding.id, source: mapping.external, sourceVersion: '2', sourceEffectiveAt: '2026-09-09T10:00:00Z', observedAt: '2026-09-09T10:00:02Z', schemaVersion: '1', fields: { accountId: 'a2' }, payloadDigest: digest({ accountId: 'a2' }), correlationId: 'c2' }), (e: unknown) => e instanceof GoliathError && e.code === 'DUPLICATE_EVENT');
});

test('B14 mapping effective period is enforced before an event is consumed', () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding, mapping } = mappedBinding('crm', 'crm-provider');
  repo.putBinding(binding); repo.putMapping({ ...mapping, effectiveFrom: '2026-09-10T00:00:00Z' });
  const orchestrator = new IntegrationOrchestrator(repo, { 'crm-provider': new ContractTestAdapter('crm-provider', ['crm']) }, clock);
  const obs = { eventId: 'evt-early', bindingId: binding.id, source: mapping.external, sourceVersion: '1', sourceEffectiveAt: '2026-09-09T10:00:00Z', observedAt: '2026-09-09T10:00:01Z', schemaVersion: '1', fields: { accountId: 'a1' }, payloadDigest: digest({ accountId: 'a1' }), correlationId: 'c' };
  assert.throws(() => orchestrator.ingest(actor, obs), (e: unknown) => e instanceof GoliathError && e.code === 'MAPPING_REQUIRED');
  repo.putMapping(mapping);
  assert.equal(orchestrator.ingest(actor, obs).applied, true);
});

test('B14 exact approval binding rejects wrong action, target or payload', () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding } = mappedBinding('procurement', 'erp');
  repo.putBinding(binding);
  const orchestrator = new IntegrationOrchestrator(repo, { erp: new ContractTestAdapter('erp', ['procurement']) }, clock);
  const payload = { amount: 100 };
  const wrong = approvalFor(binding, 'requestChange', 'po-1', payload, { action: 'requestCancel' });
  assert.throws(() => orchestrator.prepareEffect(actor, { bindingId: binding.id, action: 'requestChange', targetExternalId: 'po-1', targetResourceType: 'po', payload, correlationId: 'c', approval: wrong }), (e: unknown) => e instanceof GoliathError && e.code === 'APPROVAL_REQUIRED');
  const wrongDigest = approvalFor(binding, 'requestChange', 'po-1', payload, { payloadDigest: digest({ amount: 999 }) });
  assert.throws(() => orchestrator.prepareEffect(actor, { bindingId: binding.id, action: 'requestChange', targetExternalId: 'po-1', targetResourceType: 'po', payload, correlationId: 'c', approval: wrongDigest }), (e: unknown) => e instanceof GoliathError && e.code === 'APPROVAL_REQUIRED');
});

test('B14 unknown provider outcome is fenced until reconciliation marks it retryable', async () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding } = mappedBinding('itsm', 'itsm-provider');
  repo.putBinding(binding);
  const adapter = new ContractTestAdapter('itsm-provider', ['itsm'], { dispatch: 'unknown', readBack: 'absent-safe-to-retry' });
  const orchestrator = new IntegrationOrchestrator(repo, { 'itsm-provider': adapter }, clock);
  const intent = orchestrator.prepareEffect(actor, { id: 'intent-stable', bindingId: binding.id, action: 'requestIncident', targetExternalId: 'svc-1', targetResourceType: 'service', payload: { summary: 'outage' }, correlationId: 'corr-unknown' });
  assert.equal((await orchestrator.dispatch(actor, intent.id)).state, 'unknown');
  await assert.rejects(orchestrator.dispatch(actor, intent.id), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
  assert.equal((await orchestrator.reconcile(actor, intent.id)).result, 'absent-safe-to-retry');
  assert.equal(repo.getIntent(intent.id)?.state, 'retryable');
  assert.equal((await orchestrator.dispatch(actor, intent.id)).state, 'unknown');
  assert.equal(repo.listReceiptsForIntent(intent.id).length, 2);
});

test('B14 dispatch revalidates binding revocation and approval expiry', async () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding } = mappedBinding('billing', 'finance');
  repo.putBinding(binding);
  let now = new Date('2026-09-09T12:00:00Z');
  const orchestrator = new IntegrationOrchestrator(repo, { finance: new ContractTestAdapter('finance', ['billing']) }, () => now);
  const payload = { milestone: 'm1' };
  const approval = approvalFor(binding, 'requestMilestoneBilling', 'invoice-request', payload, { expiresAt: '2026-09-09T13:00:00Z' });
  const intent = orchestrator.prepareEffect(actor, { bindingId: binding.id, action: 'requestMilestoneBilling', targetExternalId: 'invoice-request', targetResourceType: 'invoice', payload, correlationId: 'c', approval });
  repo.putBinding({ ...binding, enabled: false });
  await assert.rejects(orchestrator.dispatch(actor, intent.id), (e: unknown) => e instanceof GoliathError && e.code === 'INTEGRATION_DISABLED');
  repo.putBinding(binding);
  now = new Date('2026-09-09T14:00:00Z');
  await assert.rejects(orchestrator.dispatch(actor, intent.id), (e: unknown) => e instanceof GoliathError && e.code === 'APPROVAL_REQUIRED');
});

test('B14 manual-review mode holds authoritative facts without changing projection', () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding, mapping } = mappedBinding('qa', 'qa-provider', { id: 'b-review', authorityMode: 'manual-review', allowedInboundFields: ['testRunId'], allowedOutboundActions: [] });
  const reviewMapping = { ...mapping, id: 'm-review', bindingId: binding.id, external: { ...mapping.external, resourceType: 'testRun', externalId: 'tr-1' }, localEntityType: 'milestone', localEntityId: 'ms-1' };
  repo.putBinding(binding); repo.putMapping(reviewMapping);
  const orchestrator = new IntegrationOrchestrator(repo, { 'qa-provider': new ContractTestAdapter('qa-provider', ['qa']) }, clock);
  const result = orchestrator.ingest(actor, { eventId: 'evt-review', bindingId: binding.id, source: reviewMapping.external, sourceVersion: '1', sourceEffectiveAt: '2026-09-09T00:00:00Z', observedAt: '2026-09-09T00:00:01Z', schemaVersion: '1', fields: { testRunId: 'tr-1' }, payloadDigest: digest({ testRunId: 'tr-1' }), correlationId: 'corr-review' });
  assert.equal(result.applied, false);
  assert.equal(repo.getProjection('p-1', 'milestone', 'ms-1'), undefined);
  assert.ok(repo.listAudit().some((x) => x.action === 'integration.observation.held'));
  assert.equal(orchestrator.ingest(actor, { eventId: 'evt-review', bindingId: binding.id, source: reviewMapping.external, sourceVersion: '1', sourceEffectiveAt: '2026-09-09T00:00:00Z', observedAt: '2026-09-09T00:00:01Z', schemaVersion: '1', fields: { testRunId: 'tr-1' }, payloadDigest: digest({ testRunId: 'tr-1' }), correlationId: 'corr-review' }).duplicate, true);
});

test('B14 rejects sensitive source payload even when a binding was mistakenly broadened', () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding, mapping } = mappedBinding('contract', 'clm', { id: 'b-contract-sensitive', allowedInboundFields: ['contractId', 'confidentialTerms'], allowedOutboundActions: [], classification: 'restricted' });
  const sensitiveMapping = { ...mapping, bindingId: binding.id, external: { ...mapping.external, resourceType: 'contract', externalId: 'c-1' }, localEntityType: 'contractLink', localEntityId: 'c-local' };
  repo.putBinding(binding); repo.putMapping(sensitiveMapping);
  const orchestrator = new IntegrationOrchestrator(repo, { clm: new ContractTestAdapter('clm', ['contract']) }, clock);
  assert.throws(() => orchestrator.ingest(actor, { eventId: 'evt-sensitive', bindingId: binding.id, source: sensitiveMapping.external, sourceVersion: '1', sourceEffectiveAt: '2026-09-09T00:00:00Z', observedAt: '2026-09-09T00:00:01Z', schemaVersion: '1', fields: { contractId: 'c-1', confidentialTerms: 'do-not-import' }, payloadDigest: digest('x'), correlationId: 'corr-sensitive' }), (e: unknown) => e instanceof GoliathError && e.code === 'FIELD_AUTHORITY_DENIED');
});

test('B14 rejects a cross-project external mapping before projection is mutated', () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding, mapping } = mappedBinding('crm', 'crm-provider', { id: 'b-cross', allowedInboundFields: ['accountId'], allowedOutboundActions: [] });
  repo.putBinding(binding); repo.putMapping({ ...mapping, id: 'm-cross', organisationId: 'org-1', projectId: 'p-2', bindingId: binding.id, external: { ...mapping.external, resourceType: 'account', externalId: 'acc-1' }, localEntityType: 'customerHandover', localEntityId: 'h-1' });
  const orchestrator = new IntegrationOrchestrator(repo, { 'crm-provider': new ContractTestAdapter('crm-provider', ['crm']) }, clock);
  assert.throws(() => orchestrator.ingest(actor, { eventId: 'evt-cross', bindingId: binding.id, source: { provider: 'crm-provider', environment: 'sandbox', accountId: 'acct', resourceType: 'account', externalId: 'acc-1' }, sourceVersion: '1', sourceEffectiveAt: '2026-09-09T00:00:00Z', observedAt: '2026-09-09T00:00:01Z', schemaVersion: '1', fields: { accountId: 'acc-1' }, payloadDigest: digest('x'), correlationId: 'corr-cross' }), (e: unknown) => e instanceof GoliathError && e.code === 'ACCESS_DENIED');
});

test('B14 server-side guard denial matrix blocks scope, permission, disabled binding, provider and field/action violations', () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding, mapping } = mappedBinding('crm', 'crm-provider', { allowedInboundFields: ['accountId'], allowedOutboundActions: ['publishDeliverySummary'] });
  repo.putBinding(binding); repo.putMapping(mapping);
  const orchestrator = new IntegrationOrchestrator(repo, { 'crm-provider': new ContractTestAdapter('crm-provider', ['crm']) }, clock);
  const observation = { eventId: 'evt-guard', bindingId: binding.id, source: mapping.external, sourceVersion: '1', sourceEffectiveAt: '2026-09-09T10:00:00Z', observedAt: '2026-09-09T10:00:01Z', schemaVersion: '1', fields: { accountId: 'a1' }, payloadDigest: digest({ accountId: 'a1' }), correlationId: 'c' };
  assert.throws(() => orchestrator.ingest({ ...actor, projectIds: [] }, observation), (e: unknown) => e instanceof GoliathError && e.code === 'ACCESS_DENIED');
  assert.throws(() => orchestrator.ingest({ ...actor, permissions: [] }, observation), (e: unknown) => e instanceof GoliathError && e.code === 'ACCESS_DENIED');
  repo.putBinding({ ...binding, enabled: false });
  assert.throws(() => orchestrator.ingest(actor, observation), (e: unknown) => e instanceof GoliathError && e.code === 'INTEGRATION_DISABLED');
  repo.putBinding(binding);
  assert.throws(() => orchestrator.ingest(actor, { ...observation, source: { ...mapping.external, provider: 'wrong' } }), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
  assert.throws(() => orchestrator.ingest(actor, { ...observation, fields: { opportunityId: 'o1' }, payloadDigest: digest({ opportunityId: 'o1' }) }), (e: unknown) => e instanceof GoliathError && e.code === 'FIELD_AUTHORITY_DENIED');
  assert.throws(() => orchestrator.prepareEffect(actor, { bindingId: binding.id, action: 'publishChangeImpact', targetExternalId: 'ext-1', targetResourceType: 'crm', payload: {}, correlationId: 'c' }), (e: unknown) => e instanceof GoliathError && e.code === 'ACTION_NOT_ALLOWED');
});

test('B14 external mapping identity includes provider account and resource type', () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding, mapping } = mappedBinding('crm', 'crm-provider', { allowedInboundFields: ['accountId'], allowedOutboundActions: [] });
  repo.putBinding(binding);
  repo.putMapping({ ...mapping, id: 'm-account', external: { ...mapping.external, accountId: 'acct-a', resourceType: 'account', externalId: 'same' }, localEntityId: 'account-local' });
  repo.putMapping({ ...mapping, id: 'm-opportunity', external: { ...mapping.external, accountId: 'acct-b', resourceType: 'opportunity', externalId: 'same' }, localEntityId: 'opp-local' });
  const orchestrator = new IntegrationOrchestrator(repo, { 'crm-provider': new ContractTestAdapter('crm-provider', ['crm']) }, clock);
  const source = { ...mapping.external, accountId: 'acct-b', resourceType: 'opportunity', externalId: 'same' };
  assert.equal(orchestrator.ingest(actor, { eventId: 'evt-map-key', bindingId: binding.id, source, sourceVersion: '1', sourceEffectiveAt: '2026-09-09T10:00:00Z', observedAt: '2026-09-09T10:00:01Z', schemaVersion: '1', fields: { accountId: 'a1' }, payloadDigest: digest({ accountId: 'a1' }), correlationId: 'c' }).applied, true);
  assert.equal(repo.getProjection('p-1', 'activity', 'opp-local')?.values.accountId, 'a1');
});

test('B14 local apply failure releases the event claim so the same provider event can recover safely', () => {
  class FailingOnceRepo extends InMemoryIntegrationRepository {
    failOnce = true;
    override putProjection(record: ProjectionRecord): void {
      if (this.failOnce) { this.failOnce = false; throw new Error('simulated local persistence failure'); }
      super.putProjection(record);
    }
  }
  const repo = new FailingOnceRepo();
  const { binding, mapping } = mappedBinding('crm', 'crm-provider', { allowedInboundFields: ['accountId'], allowedOutboundActions: [] });
  repo.putBinding(binding); repo.putMapping(mapping);
  const orchestrator = new IntegrationOrchestrator(repo, { 'crm-provider': new ContractTestAdapter('crm-provider', ['crm']) }, clock);
  const observation = { eventId: 'evt-local-fail', bindingId: binding.id, source: mapping.external, sourceVersion: '1', sourceEffectiveAt: '2026-09-09T10:00:00Z', observedAt: '2026-09-09T10:00:01Z', schemaVersion: '1', fields: { accountId: 'a1' }, payloadDigest: digest({ accountId: 'a1' }), correlationId: 'c' };
  assert.throws(() => orchestrator.ingest(actor, observation), /simulated local persistence failure/);
  assert.equal(orchestrator.ingest(actor, observation).applied, true);
});

test('B14 dispatch fails closed on tampered immutable intent and mismatched provider receipt', async () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding } = mappedBinding('qa', 'qa-provider', { allowedOutboundActions: ['createDefect'] });
  repo.putBinding(binding);
  const good = new ContractTestAdapter('qa-provider', ['qa']);
  const orchestrator = new IntegrationOrchestrator(repo, { 'qa-provider': good }, clock);
  const intent = orchestrator.prepareEffect(actor, { bindingId: binding.id, action: 'createDefect', targetExternalId: 't-1', targetResourceType: 'defect', payload: { title: 'x' }, correlationId: 'c' });
  repo.putIntent({ ...intent, exactPayload: { title: 'tampered' } });
  await assert.rejects(orchestrator.dispatch(actor, intent.id), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');

  const repo2 = new InMemoryIntegrationRepository(); repo2.putBinding(binding);
  const badAdapter: ProviderAdapter = {
    provider: 'qa-provider', domains: ['qa'],
    async dispatch(i) { return { receiptId: 'bad', intentId: `${i.id}-other`, provider: 'qa-provider', providerReference: 'r', acceptedAt: FIXED_NOW, result: 'accepted' }; },
    async readBack(i) { return { intentId: i.id, reconciledAt: FIXED_NOW, result: 'confirmed' }; },
  };
  const orchestrator2 = new IntegrationOrchestrator(repo2, { 'qa-provider': badAdapter }, clock);
  const intent2 = orchestrator2.prepareEffect(actor, { bindingId: binding.id, action: 'createDefect', targetExternalId: 't-1', targetResourceType: 'defect', payload: { title: 'x' }, correlationId: 'c' });
  await assert.rejects(orchestrator2.dispatch(actor, intent2.id), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
});

test('B14 manual-investigation reconciliation remains unknown and cannot be blindly redispatched', async () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding } = mappedBinding('itsm', 'itsm-provider', { allowedOutboundActions: ['requestIncident'] });
  repo.putBinding(binding);
  const adapter = new ContractTestAdapter('itsm-provider', ['itsm'], { dispatch: 'unknown', readBack: 'manual-investigation' });
  const orchestrator = new IntegrationOrchestrator(repo, { 'itsm-provider': adapter }, clock);
  const intent = orchestrator.prepareEffect(actor, { bindingId: binding.id, action: 'requestIncident', targetExternalId: 'svc', targetResourceType: 'service', payload: {}, correlationId: 'c' });
  await orchestrator.dispatch(actor, intent.id);
  await orchestrator.reconcile(actor, intent.id);
  assert.equal(repo.getIntent(intent.id)?.state, 'unknown');
  await assert.rejects(orchestrator.dispatch(actor, intent.id), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
});

test('B14 required approval cannot be omitted, incomplete, future-dated or detached from live binding', async () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding } = mappedBinding('procurement', 'erp');
  repo.putBinding(binding);
  const orchestrator = new IntegrationOrchestrator(repo, { erp: new ContractTestAdapter('erp', ['procurement']) }, clock);
  const payload = { amount: 10 };
  assert.throws(() => orchestrator.prepareEffect(actor, { bindingId: binding.id, action: 'requestChange', targetExternalId: 'po1', targetResourceType: 'po', payload, correlationId: 'c' }), (e: unknown) => e instanceof GoliathError && e.code === 'APPROVAL_REQUIRED');
  assert.throws(() => orchestrator.prepareEffect(actor, { bindingId: binding.id, action: 'requestChange', targetExternalId: 'po1', targetResourceType: 'po', payload, correlationId: 'c', approval: approvalFor(binding, 'requestChange', 'po1', payload, { approvalId: '' }) }), (e: unknown) => e instanceof GoliathError && e.code === 'APPROVAL_REQUIRED');
  assert.throws(() => orchestrator.prepareEffect(actor, { bindingId: binding.id, action: 'requestChange', targetExternalId: 'po1', targetResourceType: 'po', payload, correlationId: 'c', approval: approvalFor(binding, 'requestChange', 'po1', payload, { approvedAt: '2026-09-09T13:00:00Z', expiresAt: '2026-09-10T13:00:00Z' }) }), (e: unknown) => e instanceof GoliathError && e.code === 'APPROVAL_REQUIRED');

  const lowRepo = new InMemoryIntegrationRepository();
  const { binding: qaBinding } = mappedBinding('qa', 'qa-provider', { allowedOutboundActions: ['createDefect'] });
  lowRepo.putBinding(qaBinding);
  const low = new IntegrationOrchestrator(lowRepo, { 'qa-provider': new ContractTestAdapter('qa-provider', ['qa']) }, clock);
  const intent = low.prepareEffect(actor, { bindingId: qaBinding.id, action: 'createDefect', targetExternalId: 'd', targetResourceType: 'defect', payload: {}, correlationId: 'c' });
  lowRepo.putBinding({ ...qaBinding, provider: 'other-provider' });
  await assert.rejects(low.dispatch(actor, intent.id), (e: unknown) => e instanceof GoliathError && e.code === 'ACCESS_DENIED');
});

test('B14 prepared intents cannot be reconciled before a provider dispatch exists', async () => {
  const repo = new InMemoryIntegrationRepository();
  const { binding } = mappedBinding('qa', 'qa-provider', { allowedOutboundActions: ['createDefect'] });
  repo.putBinding(binding);
  const orchestrator = new IntegrationOrchestrator(repo, { 'qa-provider': new ContractTestAdapter('qa-provider', ['qa']) }, clock);
  const intent = orchestrator.prepareEffect(actor, { bindingId: binding.id, action: 'createDefect', targetExternalId: 'd', targetResourceType: 'defect', payload: {}, correlationId: 'c' });
  await assert.rejects(orchestrator.reconcile(actor, intent.id), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
});
