import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import {
  EntitlementContractError,
  canonicalize,
  evaluateOrganisationAdmission,
  hashEntitlementEnvelope,
  signEntitlement,
  verifyEntitlement
} from '../src/index.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const trustedKeys = new Map([['david-2026-09', publicKey]]);
const base = {
  version: 1,
  grantId: 'grant-001',
  issuer: 'https://david.example.test',
  audience: 'goliath',
  organisationId: 'david-org-001',
  customerAccountId: 'customer-001',
  planCode: 'team',
  projectLimit: 5,
  status: 'active',
  revision: 1,
  issuedAt: '2026-09-12T12:00:00.000Z',
  notBefore: '2026-09-12T12:00:00.000Z',
  expiresAt: '2026-10-12T12:00:00.000Z',
  nonce: 'nonce-001'
};

function verify(envelope, options = {}) {
  return verifyEntitlement(envelope, {
    trustedKeys,
    expectedIssuer: base.issuer,
    expectedAudience: base.audience,
    now: '2026-09-13T12:00:00.000Z',
    clockSkewSeconds: 0,
    ...options
  });
}

function expectCode(code, action) {
  assert.throws(action, (error) => error instanceof EntitlementContractError && error.code === code);
}

test('signs and verifies a canonical Ed25519 entitlement', () => {
  const envelope = signEntitlement(base, { privateKey, keyId: 'david-2026-09' });
  const result = verify(envelope, { expectedOrganisationId: base.organisationId });
  assert.equal(result.claims.planCode, 'team');
  assert.equal(result.admission.accessMode, 'enabled');
  assert.equal(result.admission.projectProvisioningAllowed, true);
  assert.equal(result.admission.projectAuthorityGranted, false);
  assert.equal(result.admission.individualMembershipGranted, false);
  assert.match(hashEntitlementEnvelope(envelope), /^[0-9a-f]{64}$/);
});

test('canonicalization is independent of object insertion order', () => {
  const reversed = Object.fromEntries(Object.entries(base).reverse());
  assert.equal(canonicalize(base), canonicalize(reversed));
  assert.equal(
    signEntitlement(base, { privateKey, keyId: 'david-2026-09' }).payload,
    signEntitlement(reversed, { privateKey, keyId: 'david-2026-09' }).payload
  );
});

test('rejects payload tampering', () => {
  const envelope = signEntitlement(base, { privateKey, keyId: 'david-2026-09' });
  const tampered = { ...envelope, payload: Buffer.from(canonicalize({ ...base, projectLimit: 999 }), 'utf8').toString('base64url') };
  expectCode('INVALID_SIGNATURE', () => verify(tampered));
});

test('rejects unknown keys, issuer mismatch, audience mismatch and organisation mismatch', () => {
  const envelope = signEntitlement(base, { privateKey, keyId: 'david-2026-09' });
  expectCode('UNKNOWN_SIGNING_KEY', () => verify(envelope, { trustedKeys: new Map() }));
  expectCode('ISSUER_MISMATCH', () => verify(envelope, { expectedIssuer: 'https://attacker.test' }));
  expectCode('AUDIENCE_MISMATCH', () => verify(envelope, { expectedAudience: 'other-service' }));
  expectCode('ORGANISATION_MISMATCH', () => verify(envelope, { expectedOrganisationId: 'other-org' }));
});

test('enforces not-before and expiry boundaries', () => {
  const future = signEntitlement({ ...base, grantId: 'future', nonce: 'future', issuedAt: '2026-09-20T12:00:00.000Z', notBefore: '2026-09-20T12:00:00.000Z' }, { privateKey, keyId: 'david-2026-09' });
  const expired = signEntitlement({ ...base, grantId: 'expired', nonce: 'expired', expiresAt: '2026-09-12T13:00:00.000Z' }, { privateKey, keyId: 'david-2026-09' });
  expectCode('ENTITLEMENT_NOT_YET_VALID', () => verify(future));
  expectCode('ENTITLEMENT_EXPIRED', () => verify(expired));
  expectCode('INVALID_CLAIMS', () => signEntitlement({ ...base, issuedAt: '2026-09-12' }, { privateKey, keyId: 'david-2026-09' }));
});

test('detects replay by grant id or nonce without mutating replay stores', () => {
  const envelope = signEntitlement(base, { privateKey, keyId: 'david-2026-09' });
  expectCode('ENTITLEMENT_REPLAYED', () => verify(envelope, { consumedGrantIds: new Set([base.grantId]) }));
  expectCode('ENTITLEMENT_REPLAYED', () => verify(envelope, { consumedNonces: new Set([base.nonce]) }));
  const unused = new Set();
  verify(envelope, { consumedGrantIds: unused });
  assert.equal(unused.size, 0);
});

test('maps lifecycle state to organisation admission without granting project authority', () => {
  const expected = {
    active: ['enabled', true],
    grace: ['grace', false],
    restricted: ['restricted', false],
    revoked: ['denied', false]
  };
  for (const [status, [accessMode, provisioning]] of Object.entries(expected)) {
    const decision = evaluateOrganisationAdmission({ ...base, status });
    assert.equal(decision.accessMode, accessMode);
    assert.equal(decision.projectProvisioningAllowed, provisioning);
    assert.equal(decision.projectAuthorityGranted, false);
  }
});

test('forbids role, permission and individual membership fields in the commercial contract', () => {
  for (const forbidden of [
    { role: 'enterprise-admin' },
    { permissions: ['project.write'] },
    { userId: 'user-001' },
    { teamId: 'team-001' }
  ]) {
    expectCode('AUTHORITY_FIELD_FORBIDDEN', () => signEntitlement({ ...base, ...forbidden }, { privateKey, keyId: 'david-2026-09' }));
  }
});
