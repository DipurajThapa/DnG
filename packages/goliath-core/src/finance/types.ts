export type FinanceEntryType = 'actual' | 'commitment' | 'accrual' | 'credit' | 'revenue' | 'benefit';
export type FinanceClassification = 'internal' | 'confidential' | 'restricted';

export interface FinanceEntryRecord {
  id: string;
  projectId: string;
  entryType: FinanceEntryType;
  amount: number;
  currency: string;
  sourceSystem: string;
  sourceRef: string;
  sourceRevision: string;
  occurredAt: string;
  classification: FinanceClassification;
  description?: string;
  revision: number;
}

export interface FinanceForecastInput {
  projectId: string;
  etcAmount: number;
  contingencyAmount: number;
  projectedRevenue?: number;
  benefitForecast?: number;
  currency: string;
  asOf: string;
  sourceRefs: readonly string[];
  updatedBy: string;
  revision: number;
}

export interface FinanceProjection {
  projectId: string;
  visibility: 'summary' | 'project' | 'commercial';
  currency?: string;
  budget?: number;
  actualCost?: number;
  commitments?: number;
  accruals?: number;
  etc?: number;
  contingency?: number;
  eac?: number;
  variance?: number;
  projectedRevenue?: number;
  margin?: number;
  benefits?: number;
  sourceRefs: readonly string[];
  asOf?: string;
  completeness: 'complete' | 'partial' | 'unknown';
  notes: readonly string[];
}
