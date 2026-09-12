import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAutomationAllowed,
  assessLogisticsAndAssetReadiness,
  backtestForecast,
  calculateFpaScenario,
  GoliathError,
  monteCarloDuration,
  optimisePortfolioResources,
} from '../src/index.js';

test('B16 resource optimisation respects priority, skills, project eligibility and capacity', () => {
  const result = optimisePortfolioResources(
    [
      { resourceId: 'r1', skill: 'backend', availableHours: 40, costPerHour: 100, projectIdsAllowed: ['p1', 'p2'] },
      { resourceId: 'r2', skill: 'backend', availableHours: 40, costPerHour: 80, projectIdsAllowed: ['p1'] },
    ],
    [
      { demandId: 'd1', projectId: 'p1', skill: 'backend', requiredHours: 50, priority: 10 },
      { demandId: 'd2', projectId: 'p2', skill: 'backend', requiredHours: 40, priority: 5 },
    ],
  );
  assert.equal(result[0]?.filledHours, 50);
  assert.equal(result[1]?.filledHours, 30);
  assert.equal(result[1]?.unmetHours, 10);
});

test('B16 portfolio optimiser preserves scarce-resource feasibility instead of greedily starving another project', () => {
  const result = optimisePortfolioResources(
    [
      { resourceId: 'flex-cheap', skill: 'backend', availableHours: 40, costPerHour: 50, projectIdsAllowed: ['p1', 'p2'] },
      { resourceId: 'p1-only', skill: 'backend', availableHours: 40, costPerHour: 100, projectIdsAllowed: ['p1'] },
    ],
    [
      { demandId: 'high', projectId: 'p1', skill: 'backend', requiredHours: 40, priority: 10 },
      { demandId: 'lower', projectId: 'p2', skill: 'backend', requiredHours: 40, priority: 5 },
    ],
  );
  assert.equal(result[0]?.filledHours, 40);
  assert.equal(result[1]?.filledHours, 40);
  assert.equal(result[1]?.unmetHours, 0);
  assert.equal(result[0]?.assignments[0]?.resourceId, 'p1-only');
  assert.equal(result[1]?.assignments[0]?.resourceId, 'flex-cheap');
});

test('B16 optimiser minimizes cost after priority/feasibility objectives are satisfied', () => {
  const result = optimisePortfolioResources(
    [
      { resourceId: 'cheap', skill: 'qa', availableHours: 20, costPerHour: 10, projectIdsAllowed: ['p1'] },
      { resourceId: 'expensive', skill: 'qa', availableHours: 20, costPerHour: 100, projectIdsAllowed: ['p1'] },
    ],
    [{ demandId: 'd', projectId: 'p1', skill: 'qa', requiredHours: 10, priority: 1 }],
  );
  assert.equal(result[0]?.assignments.length, 1);
  assert.equal(result[0]?.assignments[0]?.resourceId, 'cheap');
});

test('B16 FP&A avoids double-counting commitments by using non-overlapping ETC floor', () => {
  const result = calculateFpaScenario({
    scenarioId: 'base', budget: 1000, actuals: [{ id: 'a1', amount: 400, currency: 'USD', period: '2026-09' }],
    commitments: [{ id: 'po1', openAmount: 300, currency: 'USD', period: '2026-10' }], remainingWorkEstimate: 250, contingency: 50, currency: 'USD',
  });
  assert.equal(result.etc, 350);
  assert.equal(result.eac, 750);
  assert.equal(result.budgetHeadroom, 250);
});

test('B16 finance preserves reversal lineage and nets signed correction entries', () => {
  const result = calculateFpaScenario({
    scenarioId: 'reversal', budget: 1000,
    actuals: [
      { id: 'a1', amount: 500, currency: 'USD', period: '2026-09' },
      { id: 'r1', amount: -200, currency: 'USD', period: '2026-09', reversalOf: 'a1' },
    ],
    commitments: [], remainingWorkEstimate: 100, contingency: 0, currency: 'USD',
  });
  assert.equal(result.actualCost, 300);
  assert.equal(result.eac, 400);
});

test('B16 FP&A marks currency-incomplete scenarios partial instead of silently converting', () => {
  const result = calculateFpaScenario({ scenarioId: 'fx-missing', budget: 1000, actuals: [{ id: 'a1', amount: 100, currency: 'EUR', period: '2026-09' }], commitments: [], remainingWorkEstimate: 100, contingency: 0, currency: 'USD' });
  assert.equal(result.status, 'partial');
});

test('B16 probabilistic forecast is seeded/reproducible and percentile ordered', () => {
  const input = [
    { activityId: 'a', optimistic: 5, mostLikely: 7, pessimistic: 12 },
    { activityId: 'b', optimistic: 3, mostLikely: 4, pessimistic: 8 },
  ];
  const x = monteCarloDuration(input, 1000, 42);
  const y = monteCarloDuration(input, 1000, 42);
  assert.deepEqual(x, y);
  assert.equal(x.status, 'complete');
  if (x.status !== 'complete') throw new Error('Expected complete forecast');
  assert.ok(x.p50 <= x.p80 && x.p80 <= x.p95);
});

test('B16 missing schedule inputs return partial/unknown instead of false zero precision', () => {
  const result = monteCarloDuration([], 1000, 42);
  assert.equal(result.status, 'partial');
  assert.equal(result.p50, null);
  assert.equal(result.p80, null);
  assert.equal(result.p95, null);
  assert.equal(result.samples, 0);
});

test('B16 dependency-network Monte Carlo uses critical-path semantics rather than serial summation', () => {
  const result = monteCarloDuration([
    { activityId: 'a', optimistic: 10, mostLikely: 10, pessimistic: 10, predecessors: [] },
    { activityId: 'b', optimistic: 10, mostLikely: 10, pessimistic: 10, predecessors: [] },
    { activityId: 'c', optimistic: 5, mostLikely: 5, pessimistic: 5, predecessors: [{ activityId: 'a' }, { activityId: 'b' }] },
  ], 100, 1);
  assert.equal(result.status, 'complete');
  if (result.status !== 'complete') throw new Error('Expected complete forecast');
  assert.equal(result.model, 'dependency-network');
  assert.equal(result.p50, 15);
  assert.equal(result.p95, 15);
});

test('B16 dependency-network forecast rejects cycles and missing predecessor references', () => {
  assert.throws(() => monteCarloDuration([
    { activityId: 'a', optimistic: 1, mostLikely: 1, pessimistic: 1, predecessors: [{ activityId: 'b' }] },
    { activityId: 'b', optimistic: 1, mostLikely: 1, pessimistic: 1, predecessors: [{ activityId: 'a' }] },
  ], 100), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
  assert.throws(() => monteCarloDuration([{ activityId: 'a', optimistic: 1, mostLikely: 1, pessimistic: 1, predecessors: [{ activityId: 'missing' }] }], 100), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
});

test('B16 backtest calibrates only with sufficient observed history', () => {
  const small = backtestForecast(Array.from({ length: 5 }, (_, i) => ({ predictedP80: 10, actual: i + 1 })));
  assert.equal(small.calibrated, false);
  const enough = backtestForecast(Array.from({ length: 20 }, (_, i) => ({ predictedP80: 10, actual: i < 16 ? 8 : 12 })));
  assert.equal(enough.coverageAtP80, 0.8);
  assert.equal(enough.calibrated, true);
});

test('B16 governed automation blocks material commitments until evidence, calibration and approval exist', () => {
  const backtest = backtestForecast(Array.from({ length: 20 }, (_, i) => ({ predictedP80: 10, actual: i < 16 ? 8 : 12 })));
  assert.throws(() => assertAutomationAllowed({ posture: 'execute-approved', historicalCoverageComplete: false, observedRoi: true, businessApprovalId: 'ap-1', approvedCommitmentClasses: ['financial-commitment'], killSwitch: false }, 'financial-commitment', backtest), (e: unknown) => e instanceof GoliathError && e.code === 'AUTOMATION_BLOCKED');
  assert.doesNotThrow(() => assertAutomationAllowed({ posture: 'execute-approved', historicalCoverageComplete: true, observedRoi: true, businessApprovalId: 'ap-1', approvedCommitmentClasses: ['financial-commitment'], killSwitch: false }, 'financial-commitment', backtest));
});

test('B16 logistics/assets produce explicit readiness reasons instead of false precision', () => {
  const result = assessLogisticsAndAssetReadiness(
    [{ shipmentId: 's1', projectId: 'p1', poLineId: 'po1', activityId: 'a1', eta: '2026-10-01', siteReady: false, quantityExpected: 10, quantityReceived: 6 }],
    [{ assetId: 'asset1', projectId: 'p1', activityId: 'a1', status: 'expired' }],
    { asOf: '2026-09-09T00:00:00Z' },
  );
  assert.equal(result.ready, false);
  assert.equal(result.reasons.length, 3);
});

test('B16 asset effective dates and shipment timing are checked against activity need dates', () => {
  const result = assessLogisticsAndAssetReadiness(
    [{ shipmentId: 's1', projectId: 'p1', poLineId: 'po1', activityId: 'a1', eta: '2026-09-20T00:00:00Z', siteReady: true, quantityExpected: 10, quantityReceived: 0 }],
    [
      { assetId: 'expired-by-date', projectId: 'p1', activityId: 'a1', status: 'available', expiresAt: '2026-09-14T00:00:00Z' },
      { assetId: 'not-yet-available', projectId: 'p1', activityId: 'a1', status: 'reserved', availableFrom: '2026-09-16T00:00:00Z' },
    ],
    { asOf: '2026-09-09T00:00:00Z', activityNeedDates: { a1: '2026-09-15T00:00:00Z' } },
  );
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((x) => x.includes('ETA is after')));
  assert.ok(result.reasons.some((x) => x.includes('expires before')));
  assert.ok(result.reasons.some((x) => x.includes('not available by')));
});

test('B16 invalid planning inputs are rejected rather than normalized into misleading outputs', () => {
  assert.throws(() => optimisePortfolioResources([{ resourceId: 'r', skill: 'x', availableHours: -1, costPerHour: 1, projectIdsAllowed: ['p'] }], []), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
  assert.throws(() => calculateFpaScenario({ scenarioId: 'bad', budget: 1, actuals: [], commitments: [], remainingWorkEstimate: -1, contingency: 0, currency: 'USD' }), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
  assert.throws(() => monteCarloDuration([{ activityId: 'a', optimistic: 5, mostLikely: 2, pessimistic: 6 }], 100), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
  assert.throws(() => backtestForecast([{ predictedP80: -1, actual: 1 }]), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
});

test('B16 invalid logistics/asset timestamps become explicit readiness failures', () => {
  const result = assessLogisticsAndAssetReadiness(
    [{ shipmentId: 's', projectId: 'p', poLineId: 'po', activityId: 'a', eta: 'not-a-date', siteReady: true, quantityExpected: 1, quantityReceived: 1 }],
    [{ assetId: 'asset', projectId: 'p', activityId: 'a', status: 'available', availableFrom: 'not-a-date', expiresAt: 'also-bad' }],
    { asOf: '2026-09-09T00:00:00Z', activityNeedDates: { a: 'bad-need' } },
  );
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((x) => x.includes('invalid ETA')));
  assert.ok(result.reasons.some((x) => x.includes('invalid availableFrom')));
  assert.ok(result.reasons.some((x) => x.includes('invalid expiresAt')));
  assert.ok(result.reasons.some((x) => x.includes('invalid need date')));
});

test('B16 automation kill switch, posture and class gates fail closed', () => {
  const calibrated = backtestForecast(Array.from({ length: 20 }, (_, i) => ({ predictedP80: 10, actual: i < 16 ? 8 : 12 })));
  assert.throws(() => assertAutomationAllowed({ posture: 'execute-approved', historicalCoverageComplete: true, observedRoi: true, businessApprovalId: 'ap', approvedCommitmentClasses: ['task-action'], killSwitch: true }, 'task-action', calibrated), (e: unknown) => e instanceof GoliathError && e.code === 'AUTOMATION_BLOCKED');
  assert.throws(() => assertAutomationAllowed({ posture: 'prepare', historicalCoverageComplete: true, observedRoi: true, businessApprovalId: 'ap', approvedCommitmentClasses: ['task-action'], killSwitch: false }, 'task-action', calibrated), (e: unknown) => e instanceof GoliathError && e.code === 'AUTOMATION_BLOCKED');
  assert.throws(() => assertAutomationAllowed({ posture: 'execute-approved', historicalCoverageComplete: true, observedRoi: true, businessApprovalId: 'ap', approvedCommitmentClasses: ['informational'], killSwitch: false }, 'task-action', calibrated), (e: unknown) => e instanceof GoliathError && e.code === 'AUTOMATION_BLOCKED');
});

test('B16 optimizer and logistics reject duplicate/negative structural data', () => {
  assert.throws(() => optimisePortfolioResources([
    { resourceId: 'r', skill: 'x', availableHours: 1, costPerHour: 1, projectIdsAllowed: ['p'] },
    { resourceId: 'r', skill: 'x', availableHours: 1, costPerHour: 1, projectIdsAllowed: ['p'] },
  ], []), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
  const readiness = assessLogisticsAndAssetReadiness([{ shipmentId: 's', projectId: 'p', poLineId: 'po', activityId: 'a', eta: '2026-09-10', siteReady: true, quantityExpected: -1, quantityReceived: 0 }], [], { asOf: '2026-09-09' });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.reasons.some((x) => x.includes('invalid quantity')));
});

test('B16 invalid demand definitions fail closed', () => {
  assert.throws(() => optimisePortfolioResources([], [{ demandId: 'd', projectId: 'p', skill: 'x', requiredHours: -1, priority: 1 }]), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
  assert.throws(() => optimisePortfolioResources([], [
    { demandId: 'd', projectId: 'p', skill: 'x', requiredHours: 1, priority: 1 },
    { demandId: 'd', projectId: 'p', skill: 'x', requiredHours: 1, priority: 1 },
  ]), (e: unknown) => e instanceof GoliathError && e.code === 'INVALID_INPUT');
});
