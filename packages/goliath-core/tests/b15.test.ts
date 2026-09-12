import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertUpgradeAllowed,
  GoliathError,
  EnterpriseIdentityRegistry,
  RecoveryCoordinator,
  validateEnvironmentManifest,
  verifyReleaseDigestSignature,
  type EnterpriseEnvironmentManifest,
  type FleetInstallationState,
  type SignedRelease,
} from '../src/index.js';

const manifest: EnterpriseEnvironmentManifest = {
  manifestVersion: 1,
  installationId: 'inst-1', organisationId: 'org-1', environment: 'production', fqdn: 'goliath.client.example', dataRegion: 'eu-west',
  oidcIssuer: 'https://idp.client.example', oidcAudience: 'goliath-prod', releaseDigest: 'a'.repeat(64), releaseSignatureKeyId: 'kid-1',
  schemaVersion: '20260909', databaseEngine: 'postgresql', storageNamespace: 'goliath-org-1-prod', secretReferences: ['secret://oidc/client', 'secret://db/app'],
  backupDestination: 'backup://vault/org-1/prod', restoreRunbookRef: 'runbook://restore/1', monitoringDestination: 'monitor://tenant/org-1',
  supportOwner: 'ops-team', allowedEmailDomains: ['client.example'], privateNetwork: true,
};

test('B15 validates production manifest and refuses embedded secret values', () => {
  assert.equal(validateEnvironmentManifest(manifest).valid, true);
  assert.equal(validateEnvironmentManifest({ ...manifest, secretReferences: ['plain-password'] }).valid, false);
});

test('B15 joiner provisions a new identity and only verified identities can receive sessions', () => {
  const ids = new EnterpriseIdentityRegistry();
  const created = ids.apply({ id: 'join-1', type: 'joiner', issuer: 'https://idp', subject: 'sub-new', organisationId: 'org-1', occurredAt: '2026-09-09T00:00:00Z', nextEmail: 'new@client.example', nextEmailVerified: true, nextProjectGrants: { 'p-1': ['project.view'] } });
  assert.equal(created.membershipVersion, 1);
  ids.issueSession('s-new', 'https://idp', 'sub-new');
  assert.equal(ids.canAccess('s-new', 'org-1', 'p-1', 'project.view'), true);

  ids.apply({ id: 'join-2', type: 'joiner', issuer: 'https://idp', subject: 'sub-unverified', organisationId: 'org-1', occurredAt: '2026-09-09T00:00:00Z', nextEmail: 'unverified@client.example', nextProjectGrants: { 'p-1': ['project.view'] } });
  assert.throws(() => ids.issueSession('s-unverified', 'https://idp', 'sub-unverified'), (e: unknown) => e instanceof GoliathError && e.code === 'ACCESS_DENIED');
});

test('B15 mover email change clears verification and revokes existing sessions', () => {
  const ids = new EnterpriseIdentityRegistry();
  ids.upsert({ issuer: 'https://idp', subject: 'sub-1', email: 'old@client.example', emailVerified: true, organisationId: 'org-1', active: true, membershipVersion: 1, projectGrants: { 'p-1': ['project.view'] } });
  ids.issueSession('s-1', 'https://idp', 'sub-1');
  const moved = ids.apply({ id: 'move-1', type: 'mover', issuer: 'https://idp', subject: 'sub-1', organisationId: 'org-1', occurredAt: '2026-09-09T01:00:00Z', nextEmail: 'new@client.example' });
  assert.equal(moved.emailVerified, false);
  assert.equal(ids.canAccess('s-1', 'org-1', 'p-1', 'project.view'), false);
  assert.throws(() => ids.issueSession('s-2', 'https://idp', 'sub-1'), (e: unknown) => e instanceof GoliathError && e.code === 'ACCESS_DENIED');
});

test('B15 identity leaver revokes sessions and project access without deleting identity history', () => {
  const ids = new EnterpriseIdentityRegistry();
  ids.upsert({ issuer: 'https://idp', subject: 'sub-1', email: 'user@client.example', emailVerified: true, organisationId: 'org-1', active: true, membershipVersion: 1, projectGrants: { 'p-1': ['project.view'] } });
  ids.issueSession('s-1', 'https://idp', 'sub-1');
  ids.apply({ id: 'e-1', type: 'leaver', issuer: 'https://idp', subject: 'sub-1', organisationId: 'org-1', occurredAt: '2026-09-09T02:00:00Z' });
  assert.equal(ids.canAccess('s-1', 'org-1', 'p-1', 'project.view'), false);
  assert.equal(ids.get('https://idp', 'sub-1')?.active, false);
});

test('B15 lifecycle events are idempotent and stale events cannot overwrite newer identity state', () => {
  const ids = new EnterpriseIdentityRegistry();
  const event = { id: 'join-1', type: 'joiner' as const, issuer: 'https://idp', subject: 'sub-1', organisationId: 'org-1', occurredAt: '2026-09-09T03:00:00Z', nextEmail: 'user@client.example', nextEmailVerified: true, nextProjectGrants: { 'p-1': ['project.view'] } };
  assert.equal(ids.apply(event).membershipVersion, 1);
  assert.equal(ids.apply(event).membershipVersion, 1);
  ids.apply({ id: 'move-new', type: 'mover', issuer: 'https://idp', subject: 'sub-1', organisationId: 'org-1', occurredAt: '2026-09-09T04:00:00Z', nextProjectGrants: { 'p-2': ['project.view'] } });
  assert.throws(() => ids.apply({ id: 'move-old', type: 'mover', issuer: 'https://idp', subject: 'sub-1', organisationId: 'org-1', occurredAt: '2026-09-09T03:30:00Z', nextProjectGrants: { 'p-1': ['project.admin'] } }), (e: unknown) => e instanceof GoliathError && e.code === 'STALE_REVISION');
});

test('B15 cross-organisation access remains isolated', () => {
  const ids = new EnterpriseIdentityRegistry();
  ids.upsert({ issuer: 'https://idp', subject: 'sub-1', email: 'user@client.example', emailVerified: true, organisationId: 'org-1', active: true, membershipVersion: 1, projectGrants: { 'p-1': ['project.view'] } });
  ids.issueSession('s-1', 'https://idp', 'sub-1');
  assert.equal(ids.canAccess('s-1', 'org-2', 'p-1', 'project.view'), false);
  assert.throws(() => ids.apply({ id: 'cross', type: 'mover', issuer: 'https://idp', subject: 'sub-1', organisationId: 'org-2', occurredAt: '2026-09-09T05:00:00Z' }), (e: unknown) => e instanceof GoliathError && e.code === 'ACCESS_DENIED');
});

function checkpoint() {
  return { checkpointId: 'cp-1', installationId: 'inst-1', createdAt: '2026-09-09T00:00:00Z', releaseDigest: 'a'.repeat(64), schemaVersion: '20260909', databaseBackupRef: 'db://1', fileBackupRef: 'files://1', encrypted: true, projectContentExportedToVendor: false };
}
function evidence(overrides: Record<string, unknown> = {}) {
  return { checkpointId: 'cp-1', installationId: 'inst-1', releaseDigest: 'a'.repeat(64), schemaVersion: '20260909', restoredAt: '2026-09-09T01:00:00Z', dbFileReferencesValid: true, externalEffectsReplayDisabled: true, oldSessionsRevoked: true, externalStateReconciled: true, isolationVerified: true, ...overrides };
}

test('B15 restore -> reconcile -> validate -> failover requires complete evidence for exact checkpoint', () => {
  const recovery = new RecoveryCoordinator('inst-1');
  recovery.beginRestore(checkpoint());
  recovery.reconcile();
  recovery.validate(evidence());
  recovery.failOver();
  assert.equal(recovery.state, 'failed-over');
});

test('B15 recovery rejects evidence from another checkpoint, release, schema or installation', () => {
  for (const bad of [
    { checkpointId: 'cp-other' },
    { releaseDigest: 'b'.repeat(64) },
    { schemaVersion: '20260908' },
    { installationId: 'inst-other' },
  ]) {
    const recovery = new RecoveryCoordinator('inst-1');
    recovery.beginRestore(checkpoint()); recovery.reconcile();
    assert.throws(() => recovery.validate(evidence(bad)), (e: unknown) => e instanceof GoliathError && e.code === 'RECOVERY_BLOCKED');
  }
});

test('B15 signed release verification is mandatory inside fleet upgrade gate', async () => {
  const crypto = await import('node:crypto');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { publicKey: wrongPublicKey } = crypto.generateKeyPairSync('ed25519');
  const releaseDigest = 'b'.repeat(64);
  const signatureBase64 = crypto.sign(null, Buffer.from(releaseDigest, 'utf8'), privateKey).toString('base64');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const wrongPem = wrongPublicKey.export({ type: 'spki', format: 'pem' }).toString();
  const release: SignedRelease = { releaseId: 'rel-2', version: '2.0.0', digest: releaseDigest, schemaVersion: '20260909', compatibleFromSchemaVersions: ['20260908'], signatureBase64, signingKeyId: 'kid-1' };
  const state: FleetInstallationState = { installationId: 'inst-1', organisationId: 'org-1', currentReleaseId: 'rel-1', currentSchemaVersion: '20260908', maintenanceWindowApproved: true, backupCheckpointVerified: true, trustedReleaseSigningKeyIds: ['kid-1'], health: 'healthy' };
  assert.equal(verifyReleaseDigestSignature(release, pem), true);
  assert.doesNotThrow(() => assertUpgradeAllowed(state, release, pem));
  assert.throws(() => assertUpgradeAllowed(state, release, wrongPem), (e: unknown) => e instanceof GoliathError && e.code === 'ACCESS_DENIED');
  assert.throws(() => assertUpgradeAllowed({ ...state, trustedReleaseSigningKeyIds: ['kid-other'] }, release, pem), (e: unknown) => e instanceof GoliathError && e.code === 'ACCESS_DENIED');
  assert.throws(() => assertUpgradeAllowed({ ...state, currentSchemaVersion: '20260101' }, release, pem), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
  assert.throws(() => assertUpgradeAllowed({ ...state, health: 'degraded' }, release, pem), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
  assert.throws(() => assertUpgradeAllowed({ ...state, backupCheckpointVerified: false }, release, pem), (e: unknown) => e instanceof GoliathError && e.code === 'RECOVERY_BLOCKED');
});

test('B15 manifest validation covers required operational fields and requireValidManifest rejects invalid configuration', async () => {
  const { requireValidManifest } = await import('../src/index.js');
  const invalid = { ...manifest, fqdn: 'https://bad-host', dataRegion: '', monitoringDestination: '', supportOwner: '', allowedEmailDomains: ['bad domain'], secretReferences: ['secret://same', 'secret://same'] };
  const result = validateEnvironmentManifest(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 5);
  assert.throws(() => requireValidManifest(invalid), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
});

test('B15 joiner adoption/reactivation preserves history while changed email must be explicitly reverified', () => {
  const ids = new EnterpriseIdentityRegistry();
  ids.upsert({ issuer: 'https://idp', subject: 'sub-1', email: 'old@client.example', emailVerified: true, organisationId: 'org-1', active: false, membershipVersion: 3, projectGrants: {} });
  const adopted = ids.apply({ id: 'join-adopt', type: 'joiner', issuer: 'https://idp', subject: 'sub-1', organisationId: 'org-1', occurredAt: '2026-09-09T06:00:00Z', nextEmail: 'new@client.example', nextEmailVerified: true, nextProjectGrants: { 'p-1': ['project.view'] } });
  assert.equal(adopted.membershipVersion, 4);
  assert.equal(adopted.emailVerified, true);
  const reactivated = ids.apply({ id: 'reactivate', type: 'reactivate', issuer: 'https://idp', subject: 'sub-1', organisationId: 'org-1', occurredAt: '2026-09-09T07:00:00Z' });
  assert.equal(reactivated.active, true);
});

test('B15 recovery refuses unsafe checkpoints, incomplete evidence and invalid transition order', () => {
  const recovery = new RecoveryCoordinator('inst-1');
  assert.throws(() => recovery.reconcile(), (e: unknown) => e instanceof GoliathError && e.code === 'RECOVERY_BLOCKED');
  assert.throws(() => recovery.beginRestore({ ...checkpoint(), encrypted: false }), (e: unknown) => e instanceof GoliathError && e.code === 'RECOVERY_BLOCKED');
  recovery.beginRestore(checkpoint());
  assert.throws(() => recovery.beginRestore(checkpoint()), (e: unknown) => e instanceof GoliathError && e.code === 'RECOVERY_BLOCKED');
  recovery.reconcile();
  assert.throws(() => recovery.validate(evidence({ isolationVerified: false })), (e: unknown) => e instanceof GoliathError && e.code === 'RECOVERY_BLOCKED');
  assert.throws(() => recovery.failOver(), (e: unknown) => e instanceof GoliathError && e.code === 'RECOVERY_BLOCKED');
});

test('B15 release verifier safely rejects malformed signature/key material', () => {
  const release: SignedRelease = { releaseId: 'r', version: '1', digest: 'a'.repeat(64), schemaVersion: '2', compatibleFromSchemaVersions: ['1'], signatureBase64: 'not-a-valid-signature', signingKeyId: 'kid' };
  assert.equal(verifyReleaseDigestSignature(release, 'not a pem'), false);
});

test('B15 recovery validates checkpoint identity and restoration chronology', () => {
  const recoveryBadDigest = new RecoveryCoordinator('inst-1');
  assert.throws(() => recoveryBadDigest.beginRestore({ ...checkpoint(), releaseDigest: 'bad' }), (e: unknown) => e instanceof GoliathError && e.code === 'RECOVERY_BLOCKED');
  const recovery = new RecoveryCoordinator('inst-1');
  recovery.beginRestore(checkpoint()); recovery.reconcile();
  assert.throws(() => recovery.validate(evidence({ restoredAt: '2026-09-08T23:59:59Z' })), (e: unknown) => e instanceof GoliathError && e.code === 'RECOVERY_BLOCKED');
});
