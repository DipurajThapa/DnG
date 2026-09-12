import { GoliathError } from '../core/errors.js';

export interface MoneyLine {
  id: string;
  amount: number;
  currency: string;
  period: string;
  reversalOf?: string;
}

export interface CommitmentLine { id: string; openAmount: number; currency: string; period: string; }
export interface FpaScenarioInput {
  scenarioId: string;
  budget: number;
  actuals: readonly MoneyLine[];
  commitments: readonly CommitmentLine[];
  remainingWorkEstimate: number;
  contingency: number;
  currency: string;
}

export interface FpaScenarioResult {
  scenarioId: string;
  actualCost: number;
  openCommitments: number;
  etc: number;
  eac: number;
  budgetHeadroom: number;
  status: 'within-budget' | 'over-budget' | 'partial';
  explanation: string;
}

function validateScenario(input: FpaScenarioInput): void {
  if (!input.scenarioId.trim() || !input.currency.trim()) throw new GoliathError('INVALID_INPUT', 'Scenario ID and reporting currency are required.');
  if (![input.budget, input.remainingWorkEstimate, input.contingency].every(Number.isFinite)) throw new GoliathError('INVALID_INPUT', 'Budget/estimate/contingency must be finite numbers.');
  if (input.remainingWorkEstimate < 0 || input.contingency < 0) throw new GoliathError('INVALID_INPUT', 'Remaining work estimate and contingency cannot be negative.');
  const ids = new Set<string>();
  for (const line of input.actuals) {
    if (!line.id.trim() || ids.has(line.id) || !Number.isFinite(line.amount) || !line.currency.trim() || !line.period.trim()) throw new GoliathError('INVALID_INPUT', 'Actual lines require unique IDs, finite amounts, currency and period.');
    if (line.reversalOf === line.id) throw new GoliathError('INVALID_INPUT', `Actual ${line.id} cannot reverse itself.`);
    ids.add(line.id);
  }
  for (const line of input.commitments) {
    if (!line.id.trim() || ids.has(line.id) || !Number.isFinite(line.openAmount) || line.openAmount < 0 || !line.currency.trim() || !line.period.trim()) throw new GoliathError('INVALID_INPUT', 'Commitment lines require unique IDs, non-negative finite open amounts, currency and period.');
    ids.add(line.id);
  }
}

export function calculateFpaScenario(input: FpaScenarioInput): FpaScenarioResult {
  validateScenario(input);
  const currencyMismatch = input.actuals.some((x) => x.currency !== input.currency) || input.commitments.some((x) => x.currency !== input.currency);
  // Ledger corrections/reversals are retained as linked entries and net naturally through signed amounts.
  // `reversalOf` provides lineage; it is not a reason to delete either side of the accounting history.
  const actualCost = input.actuals.reduce((sum, x) => sum + x.amount, 0);
  const openCommitments = input.commitments.reduce((sum, x) => sum + x.openAmount, 0);
  const etc = Math.max(input.remainingWorkEstimate, openCommitments) + input.contingency;
  const eac = actualCost + etc;
  const headroom = input.budget - eac;
  return {
    scenarioId: input.scenarioId,
    actualCost,
    openCommitments,
    etc,
    eac,
    budgetHeadroom: headroom,
    status: currencyMismatch ? 'partial' : headroom >= 0 ? 'within-budget' : 'over-budget',
    explanation: currencyMismatch
      ? 'Scenario is partial because currency normalization is incomplete.'
      : `EAC = actual ${actualCost} + non-overlapping ETC ${etc}; headroom ${headroom}.`,
  };
}
