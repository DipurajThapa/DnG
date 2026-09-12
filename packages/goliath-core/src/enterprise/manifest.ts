import { GoliathError } from '../core/errors.js';

export interface EnterpriseEnvironmentManifest {
  manifestVersion: 1;
  installationId: string;
  organisationId: string;
  environment: 'production' | 'staging' | 'test' | 'dr';
  fqdn: string;
  dataRegion: string;
  oidcIssuer: string;
  oidcAudience: string;
  releaseDigest: string;
  releaseSignatureKeyId: string;
  schemaVersion: string;
  databaseEngine: 'postgresql' | 'sqlite';
  storageNamespace: string;
  secretReferences: readonly string[];
  backupDestination: string;
  restoreRunbookRef: string;
  monitoringDestination: string;
  supportOwner: string;
  allowedEmailDomains: readonly string[];
  privateNetwork: boolean;
}

export interface ManifestValidationResult { valid: boolean; errors: readonly string[]; }

function validHostname(value: string): boolean {
  return value.length <= 253
    && value.includes('.')
    && !value.includes('://')
    && value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function validDomain(value: string): boolean {
  return validHostname(value) && !value.includes('@');
}

export function validateEnvironmentManifest(manifest: EnterpriseEnvironmentManifest): ManifestValidationResult {
  const errors: string[] = [];
  if (!manifest.installationId.trim()) errors.push('installationId is required');
  if (!manifest.organisationId.trim()) errors.push('organisationId is required');
  if (!manifest.dataRegion.trim()) errors.push('dataRegion is required');
  if (!/^https:\/\//.test(manifest.oidcIssuer)) errors.push('oidcIssuer must be HTTPS');
  if (!manifest.oidcAudience.trim()) errors.push('oidcAudience is required');
  if (!/^[a-f0-9]{64}$/i.test(manifest.releaseDigest)) errors.push('releaseDigest must be SHA-256 hex');
  if (!manifest.releaseSignatureKeyId.trim()) errors.push('releaseSignatureKeyId is required');
  if (!manifest.schemaVersion.trim()) errors.push('schemaVersion is required');
  if (!validHostname(manifest.fqdn)) errors.push('fqdn must be a qualified hostname without a scheme');
  if (!manifest.storageNamespace.trim()) errors.push('storageNamespace is required');
  if (manifest.secretReferences.some((r) => !/^secret:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/.test(r))) errors.push('secretReferences must be opaque secret:// references');
  if (new Set(manifest.secretReferences).size !== manifest.secretReferences.length) errors.push('secretReferences must not contain duplicates');
  if (manifest.allowedEmailDomains.length === 0) errors.push('At least one approved email domain is required');
  if (manifest.allowedEmailDomains.some((d) => !validDomain(d))) errors.push('allowedEmailDomains contains an invalid domain');
  if (new Set(manifest.allowedEmailDomains.map((d) => d.toLowerCase())).size !== manifest.allowedEmailDomains.length) errors.push('allowedEmailDomains must not contain duplicates');
  if (!manifest.backupDestination.trim() || !manifest.restoreRunbookRef.trim()) errors.push('backup and restore configuration is required');
  if (!manifest.monitoringDestination.trim()) errors.push('monitoringDestination is required');
  if (!manifest.supportOwner.trim()) errors.push('supportOwner is required');
  return { valid: errors.length === 0, errors };
}

export function requireValidManifest(manifest: EnterpriseEnvironmentManifest): void {
  const validation = validateEnvironmentManifest(manifest);
  if (!validation.valid) throw new GoliathError('INVALID_INPUT', validation.errors.join('; '));
}
