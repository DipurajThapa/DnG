import { createHash, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

const CLAIM_KEYS = new Set([
  'version',
  'grantId',
  'issuer',
  'audience',
  'organisationId',
  'customerAccountId',
  'planCode',
  'projectLimit',
  'status',
  'revision',
  'issuedAt',
  'notBefore',
  'expiresAt',
  'nonce'
]);
const HEADER_KEYS = new Set(['alg', 'kid', 'typ', 'version']);
const ENVELOPE_KEYS = new Set(['protected', 'payload', 'signature']);
const LIFECYCLE_STATES = new Set(['active', 'grace', 'restricted', 'revoked']);

export class EntitlementContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EntitlementContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new EntitlementContractError(code, message);
}

function assertPlainObject(value, code, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(code, `${label} must be a plain object.`);
  }
}

function assertExactKeys(value, allowed, code, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code, `${label} contains unsupported field "${key}".`);
  }
}

function assertString(value, code, label, maxLength = 256) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    fail(code, `${label} must be a non-empty string no longer than ${maxLength} characters.`);
  }
}

function parseInstant(value, code, label) {
  assertString(value, code, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    fail(code, `${label} must be a UTC ISO-8601 instant ending in Z.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code, `${label} must be an ISO-8601 instant.`);
  return parsed;
}

export function canonicalize(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('NON_CANONICAL_VALUE', 'Canonical JSON cannot contain a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  assertPlainObject(value, 'NON_CANONICAL_VALUE', 'Canonical JSON value');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function encode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value, code, label) {
  assertString(value, code, label, 32768);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail(code, `${label} is not valid base64url.`);
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    fail(code, `${label} is not valid base64url.`);
  }
}

function parseJson(value, code, label) {
  try {
    return JSON.parse(value);
  } catch {
    fail(code, `${label} is not valid JSON.`);
  }
}

export function validateEntitlementClaims(claims) {
  assertPlainObject(claims, 'INVALID_CLAIMS', 'Entitlement claims');
  assertExactKeys(claims, CLAIM_KEYS, 'AUTHORITY_FIELD_FORBIDDEN', 'Entitlement claims');
  if (claims.version !== 1) fail('UNSUPPORTED_VERSION', 'Entitlement claims version must be 1.');
  for (const key of ['grantId', 'issuer', 'audience', 'organisationId', 'customerAccountId', 'planCode', 'nonce']) {
    assertString(claims[key], 'INVALID_CLAIMS', key);
  }
  if (!Number.isSafeInteger(claims.projectLimit) || claims.projectLimit < 0 || claims.projectLimit > 100000) {
    fail('INVALID_CLAIMS', 'projectLimit must be a safe integer between 0 and 100000.');
  }
  if (!Number.isSafeInteger(claims.revision) || claims.revision < 1) {
    fail('INVALID_CLAIMS', 'revision must be a positive safe integer.');
  }
  if (!LIFECYCLE_STATES.has(claims.status)) fail('INVALID_LIFECYCLE_STATE', 'Unsupported entitlement lifecycle state.');
  const issuedAt = parseInstant(claims.issuedAt, 'INVALID_CLAIMS', 'issuedAt');
  const notBefore = parseInstant(claims.notBefore, 'INVALID_CLAIMS', 'notBefore');
  const expiresAt = parseInstant(claims.expiresAt, 'INVALID_CLAIMS', 'expiresAt');
  if (notBefore < issuedAt) fail('INVALID_CLAIMS', 'notBefore cannot precede issuedAt.');
  if (expiresAt <= notBefore) fail('INVALID_CLAIMS', 'expiresAt must be later than notBefore.');
  return { ...claims };
}

function validateHeader(header) {
  assertPlainObject(header, 'INVALID_HEADER', 'Protected header');
  assertExactKeys(header, HEADER_KEYS, 'INVALID_HEADER', 'Protected header');
  if (header.alg !== 'EdDSA' || header.typ !== 'dng-entitlement+jws' || header.version !== 1) {
    fail('INVALID_HEADER', 'Protected header must use the DnG EdDSA entitlement profile version 1.');
  }
  assertString(header.kid, 'INVALID_HEADER', 'kid');
  return header;
}

export function signEntitlement(claims, { privateKey, keyId } = {}) {
  const validated = validateEntitlementClaims(claims);
  if (!privateKey) fail('SIGNING_KEY_REQUIRED', 'An Ed25519 private key is required.');
  assertString(keyId, 'INVALID_HEADER', 'keyId');
  const header = { alg: 'EdDSA', kid: keyId, typ: 'dng-entitlement+jws', version: 1 };
  const protectedPart = encode(canonicalize(header));
  const payload = encode(canonicalize(validated));
  const signingInput = `${protectedPart}.${payload}`;
  let signature;
  try {
    signature = cryptoSign(null, Buffer.from(signingInput, 'utf8'), privateKey).toString('base64url');
  } catch {
    fail('SIGNING_FAILED', 'The entitlement could not be signed with the supplied key.');
  }
  return { protected: protectedPart, payload, signature };
}

export function hashEntitlementEnvelope(envelope) {
  assertPlainObject(envelope, 'INVALID_ENVELOPE', 'Entitlement envelope');
  assertExactKeys(envelope, ENVELOPE_KEYS, 'INVALID_ENVELOPE', 'Entitlement envelope');
  for (const key of ENVELOPE_KEYS) {
    assertString(envelope[key], 'INVALID_ENVELOPE', key, 32768);
    if (!/^[A-Za-z0-9_-]+$/.test(envelope[key])) fail('INVALID_ENVELOPE', `${key} is not valid base64url.`);
  }
  return createHash('sha256').update(canonicalize(envelope), 'utf8').digest('hex');
}

function resolveTrustedKey(trustedKeys, keyId) {
  if (trustedKeys instanceof Map) return trustedKeys.get(keyId);
  if (trustedKeys && typeof trustedKeys === 'object') return trustedKeys[keyId];
  return undefined;
}

function nowMillis(now) {
  if (now === undefined) return Date.now();
  const value = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(value)) fail('INVALID_VERIFICATION_OPTIONS', 'now must be a valid date or epoch millisecond value.');
  return value;
}

export function evaluateOrganisationAdmission(claims) {
  const validated = validateEntitlementClaims(claims);
  const decisions = {
    active: { accessMode: 'enabled', projectProvisioningAllowed: true, reason: 'Active organisation entitlement.' },
    grace: { accessMode: 'grace', projectProvisioningAllowed: false, reason: 'Existing service may continue during grace; new projects are blocked.' },
    restricted: { accessMode: 'restricted', projectProvisioningAllowed: false, reason: 'Organisation service is restricted pending resolution.' },
    revoked: { accessMode: 'denied', projectProvisioningAllowed: false, reason: 'Organisation entitlement has been revoked.' }
  };
  return {
    ...decisions[validated.status],
    organisationId: validated.organisationId,
    projectLimit: validated.projectLimit,
    projectAuthorityGranted: false,
    individualMembershipGranted: false
  };
}

export function verifyEntitlement(envelope, {
  trustedKeys,
  expectedIssuer,
  expectedAudience,
  expectedOrganisationId,
  consumedGrantIds,
  consumedNonces,
  now,
  clockSkewSeconds = 30
} = {}) {
  assertPlainObject(envelope, 'INVALID_ENVELOPE', 'Entitlement envelope');
  assertExactKeys(envelope, ENVELOPE_KEYS, 'INVALID_ENVELOPE', 'Entitlement envelope');
  assertString(envelope.signature, 'INVALID_ENVELOPE', 'signature', 32768);
  if (!/^[A-Za-z0-9_-]+$/.test(envelope.signature)) fail('INVALID_ENVELOPE', 'signature is not valid base64url.');
  const headerText = decode(envelope.protected, 'INVALID_ENVELOPE', 'protected');
  const payloadText = decode(envelope.payload, 'INVALID_ENVELOPE', 'payload');
  const header = validateHeader(parseJson(headerText, 'INVALID_HEADER', 'Protected header'));
  const publicKey = resolveTrustedKey(trustedKeys, header.kid);
  if (!publicKey) fail('UNKNOWN_SIGNING_KEY', `No trusted public key is registered for "${header.kid}".`);
  const signingInput = `${envelope.protected}.${envelope.payload}`;
  let validSignature = false;
  try {
    validSignature = cryptoVerify(null, Buffer.from(signingInput, 'utf8'), publicKey, Buffer.from(envelope.signature, 'base64url'));
  } catch {
    validSignature = false;
  }
  if (!validSignature) fail('INVALID_SIGNATURE', 'The entitlement signature is invalid.');

  const parsedClaims = parseJson(payloadText, 'INVALID_CLAIMS', 'Entitlement payload');
  if (canonicalize(parsedClaims) !== payloadText) fail('NON_CANONICAL_PAYLOAD', 'Entitlement payload must use canonical JSON.');
  const claims = validateEntitlementClaims(parsedClaims);
  assertString(expectedIssuer, 'INVALID_VERIFICATION_OPTIONS', 'expectedIssuer');
  assertString(expectedAudience, 'INVALID_VERIFICATION_OPTIONS', 'expectedAudience');
  if (claims.issuer !== expectedIssuer) fail('ISSUER_MISMATCH', 'Entitlement issuer is not trusted for this verifier.');
  if (claims.audience !== expectedAudience) fail('AUDIENCE_MISMATCH', 'Entitlement audience does not match this service.');
  if (expectedOrganisationId !== undefined && claims.organisationId !== expectedOrganisationId) {
    fail('ORGANISATION_MISMATCH', 'Entitlement organisation does not match the requested organisation.');
  }
  if (!Number.isFinite(clockSkewSeconds) || clockSkewSeconds < 0 || clockSkewSeconds > 300) {
    fail('INVALID_VERIFICATION_OPTIONS', 'clockSkewSeconds must be between 0 and 300.');
  }
  const current = nowMillis(now);
  const skew = clockSkewSeconds * 1000;
  if (Date.parse(claims.issuedAt) > current + skew || Date.parse(claims.notBefore) > current + skew) {
    fail('ENTITLEMENT_NOT_YET_VALID', 'Entitlement is not yet valid.');
  }
  if (Date.parse(claims.expiresAt) <= current - skew) fail('ENTITLEMENT_EXPIRED', 'Entitlement has expired.');
  if (consumedGrantIds?.has(claims.grantId)) fail('ENTITLEMENT_REPLAYED', 'Entitlement grantId was already consumed.');
  if (consumedNonces?.has(claims.nonce)) fail('ENTITLEMENT_REPLAYED', 'Entitlement nonce was already consumed.');
  return { header: { ...header }, claims, admission: evaluateOrganisationAdmission(claims) };
}
