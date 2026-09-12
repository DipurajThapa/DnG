import { createPublicKey, verify } from 'node:crypto';
import { GoliathError } from '../core/errors.js';

export interface SignedRelease {
  releaseId: string;
  version: string;
  digest: string;
  schemaVersion: string;
  compatibleFromSchemaVersions: readonly string[];
  signatureBase64: string;
  signingKeyId: string;
}

export interface FleetInstallationState {
  installationId: string;
  organisationId: string;
  currentReleaseId: string;
  currentSchemaVersion: string;
  maintenanceWindowApproved: boolean;
  backupCheckpointVerified: boolean;
  trustedReleaseSigningKeyIds: readonly string[];
  health: 'healthy' | 'degraded' | 'blocked';
}

export function verifyReleaseDigestSignature(release: SignedRelease, pemPublicKey: string): boolean {
  try {
    if (!/^[a-f0-9]{64}$/i.test(release.digest) || !release.signatureBase64.trim()) return false;
    const key = createPublicKey(pemPublicKey);
    return verify(null, Buffer.from(release.digest, 'utf8'), key, Buffer.from(release.signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

/**
 * Upgrade admission deliberately performs signature verification inside the
 * gate.  A caller cannot satisfy the gate by asserting a boolean that was not
 * cryptographically derived from the exact release digest.
 */
export function assertUpgradeAllowed(state: FleetInstallationState, release: SignedRelease, pemPublicKey: string): void {
  if (!state.maintenanceWindowApproved) throw new GoliathError('INVALID_INPUT', 'Maintenance window is not approved.');
  if (!state.backupCheckpointVerified) throw new GoliathError('RECOVERY_BLOCKED', 'Verified backup checkpoint is required before upgrade.');
  if (state.health !== 'healthy') throw new GoliathError('INVALID_INPUT', `Installation health ${state.health} is not eligible for upgrade.`);
  if (!release.digest.match(/^[a-f0-9]{64}$/i)) throw new GoliathError('INVALID_INPUT', 'Release digest is invalid.');
  if (!release.releaseId.trim() || !release.version.trim() || !release.schemaVersion.trim()) throw new GoliathError('INVALID_INPUT', 'Release identity is incomplete.');
  if (!state.trustedReleaseSigningKeyIds.includes(release.signingKeyId)) throw new GoliathError('ACCESS_DENIED', 'Release signing key is not trusted by this installation.');
  if (!verifyReleaseDigestSignature(release, pemPublicKey)) throw new GoliathError('ACCESS_DENIED', 'Release signature verification failed.');
  if (!release.compatibleFromSchemaVersions.includes(state.currentSchemaVersion)) {
    throw new GoliathError('INVALID_INPUT', `Release schema ${release.schemaVersion} is not compatible with current schema ${state.currentSchemaVersion}.`);
  }
}
