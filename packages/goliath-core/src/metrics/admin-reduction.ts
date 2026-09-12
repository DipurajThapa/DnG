export interface AdminEffortSample {
  period: string;
  statusCollectionMinutes: number;
  reconciliationMinutes: number;
  chasingMinutes: number;
  reportingMinutes: number;
  duplicateGovernanceMinutes: number;
  decisionPreparationMinutes: number;
}

export interface AdminReductionResult {
  baselineMinutes: number;
  currentMinutes: number;
  reductionMinutes: number;
  reductionPercent: number | null;
}

function total(sample: AdminEffortSample): number {
  return sample.statusCollectionMinutes + sample.reconciliationMinutes + sample.chasingMinutes + sample.reportingMinutes + sample.duplicateGovernanceMinutes + sample.decisionPreparationMinutes;
}

export function calculateAdminReduction(baseline: AdminEffortSample, current: AdminEffortSample): AdminReductionResult {
  const baselineMinutes = total(baseline); const currentMinutes = total(current);
  const reductionMinutes = baselineMinutes - currentMinutes;
  return { baselineMinutes, currentMinutes, reductionMinutes, reductionPercent: baselineMinutes > 0 ? reductionMinutes / baselineMinutes * 100 : null };
}
