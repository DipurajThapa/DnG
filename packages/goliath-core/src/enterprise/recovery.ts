import { GoliathError } from '../core/errors.js';

export type RecoveryState = 'ready' | 'quiesced' | 'restoring' | 'reconciling' | 'validated' | 'failed-over';

export interface RecoveryCheckpoint {
  checkpointId: string;
  installationId: string;
  createdAt: string;
  releaseDigest: string;
  schemaVersion: string;
  databaseBackupRef: string;
  fileBackupRef: string;
  encrypted: boolean;
  projectContentExportedToVendor: boolean;
}

export interface RecoveryEvidence {
  checkpointId: string;
  installationId: string;
  releaseDigest: string;
  schemaVersion: string;
  restoredAt: string;
  dbFileReferencesValid: boolean;
  externalEffectsReplayDisabled: boolean;
  oldSessionsRevoked: boolean;
  externalStateReconciled: boolean;
  isolationVerified: boolean;
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new GoliathError('RECOVERY_BLOCKED', `${field} is not a valid recovery timestamp.`);
  return parsed;
}

export class RecoveryCoordinator {
  state: RecoveryState = 'ready';
  private activeCheckpoint: RecoveryCheckpoint | undefined;
  private validatedEvidence: RecoveryEvidence | undefined;

  constructor(public readonly installationId: string) {}

  get checkpointId(): string | undefined { return this.activeCheckpoint?.checkpointId; }

  beginRestore(checkpoint: RecoveryCheckpoint): void {
    if (!['ready', 'failed-over'].includes(this.state)) throw new GoliathError('RECOVERY_BLOCKED', `Cannot begin restore from state ${this.state}.`);
    if (checkpoint.installationId !== this.installationId) throw new GoliathError('RECOVERY_BLOCKED', 'Checkpoint belongs to another installation.');
    if (!checkpoint.encrypted || checkpoint.projectContentExportedToVendor) throw new GoliathError('RECOVERY_BLOCKED', 'Checkpoint violates recovery/data-boundary policy.');
    if (!/^[a-f0-9]{64}$/i.test(checkpoint.releaseDigest) || !checkpoint.schemaVersion.trim()) {
      throw new GoliathError('RECOVERY_BLOCKED', 'Checkpoint release/schema identity is invalid.');
    }
    timestamp(checkpoint.createdAt, 'checkpoint createdAt');
    this.activeCheckpoint = { ...checkpoint };
    this.validatedEvidence = undefined;
    this.state = 'quiesced';
    this.state = 'restoring';
  }

  reconcile(): void {
    if (this.state !== 'restoring' || !this.activeCheckpoint) throw new GoliathError('RECOVERY_BLOCKED', 'Restore must complete before reconciliation.');
    this.state = 'reconciling';
  }

  validate(evidence: RecoveryEvidence): void {
    if (this.state !== 'reconciling' || !this.activeCheckpoint) throw new GoliathError('RECOVERY_BLOCKED', 'Reconciliation must occur before validation.');
    const checkpoint = this.activeCheckpoint;
    if (
      evidence.checkpointId !== checkpoint.checkpointId
      || evidence.installationId !== checkpoint.installationId
      || evidence.releaseDigest !== checkpoint.releaseDigest
      || evidence.schemaVersion !== checkpoint.schemaVersion
    ) {
      throw new GoliathError('RECOVERY_BLOCKED', 'Recovery evidence does not match the active checkpoint/release/schema.');
    }
    if (timestamp(evidence.restoredAt, 'restoredAt') < timestamp(checkpoint.createdAt, 'checkpoint createdAt')) {
      throw new GoliathError('RECOVERY_BLOCKED', 'Restore evidence predates its checkpoint.');
    }
    const pass = evidence.dbFileReferencesValid
      && evidence.externalEffectsReplayDisabled
      && evidence.oldSessionsRevoked
      && evidence.externalStateReconciled
      && evidence.isolationVerified;
    if (!pass) throw new GoliathError('RECOVERY_BLOCKED', 'Recovery evidence is incomplete.');
    this.validatedEvidence = { ...evidence };
    this.state = 'validated';
  }

  failOver(): void {
    if (this.state !== 'validated' || !this.activeCheckpoint || !this.validatedEvidence) {
      throw new GoliathError('RECOVERY_BLOCKED', 'Failover requires validated restore evidence for the active checkpoint.');
    }
    this.state = 'failed-over';
  }
}
