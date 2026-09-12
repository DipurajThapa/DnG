import { GoliathError } from '../core/errors.js';
import type { BacktestResult } from './probabilistic.js';

export type AutomationPosture = 'observe' | 'recommend' | 'prepare' | 'execute-approved';
export type CommitmentClass = 'informational' | 'task-action' | 'external-write' | 'financial-commitment' | 'baseline-change';

export interface AutomationPolicy {
  posture: AutomationPosture;
  historicalCoverageComplete: boolean;
  observedRoi: boolean;
  businessApprovalId?: string;
  approvedCommitmentClasses: readonly CommitmentClass[];
  killSwitch: boolean;
}

export function assertAutomationAllowed(
  policy: AutomationPolicy,
  commitmentClass: CommitmentClass,
  backtest?: BacktestResult,
): void {
  if (policy.killSwitch) throw new GoliathError('AUTOMATION_BLOCKED', 'Automation kill switch is active.');
  if (policy.posture !== 'execute-approved') throw new GoliathError('AUTOMATION_BLOCKED', `Posture ${policy.posture} does not allow execution.`);
  if (!policy.approvedCommitmentClasses.includes(commitmentClass)) throw new GoliathError('AUTOMATION_BLOCKED', 'Commitment class is not approved for automation.');
  if (commitmentClass === 'financial-commitment' || commitmentClass === 'baseline-change') {
    if (!policy.businessApprovalId) throw new GoliathError('AUTOMATION_BLOCKED', 'Explicit business approval is required for material commitments.');
    if (!policy.historicalCoverageComplete || !policy.observedRoi) throw new GoliathError('AUTOMATION_BLOCKED', 'Reliable historical coverage and observed ROI are required.');
    if (!backtest?.calibrated) throw new GoliathError('AUTOMATION_BLOCKED', 'Forecast backtest is not calibrated.');
  }
}
