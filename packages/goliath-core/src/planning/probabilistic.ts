import { GoliathError } from '../core/errors.js';

export interface ActivityDependency { activityId: string; lag?: number; }
export interface DurationDistribution {
  activityId: string;
  optimistic: number;
  mostLikely: number;
  pessimistic: number;
  /**
   * When any activity declares predecessors, the forecast uses a dependency
   * network/critical-path calculation.  Explicit [] means the activity can
   * start at project time zero.  If no activity declares predecessors, the
   * legacy serial-chain interpretation is retained for compatibility.
   */
  predecessors?: readonly ActivityDependency[];
}

export interface CompleteForecastPercentiles {
  status: 'complete';
  p50: number;
  p80: number;
  p95: number;
  samples: number;
  seed: number;
  model: 'serial' | 'dependency-network';
}

export interface PartialForecastPercentiles {
  status: 'partial';
  p50: null;
  p80: null;
  p95: null;
  samples: 0;
  seed: number;
  model: 'unavailable';
  reason: string;
}

export type ForecastPercentiles = CompleteForecastPercentiles | PartialForecastPercentiles;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function triangular(rng: () => number, min: number, mode: number, max: number): number {
  if (!(min <= mode && mode <= max) || min < 0 || ![min, mode, max].every(Number.isFinite)) {
    throw new GoliathError('INVALID_INPUT', 'Invalid triangular duration distribution.');
  }
  if (max === min) return min;
  const u = rng();
  const c = (mode - min) / (max - min);
  return u < c ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  const value = sorted[index];
  if (value === undefined) throw new GoliathError('INVALID_INPUT', 'Forecast percentile cannot be calculated from an empty sample.');
  return value;
}

function dependencyOrder(distributions: readonly DurationDistribution[]): readonly DurationDistribution[] {
  const byId = new Map<string, DurationDistribution>();
  for (const d of distributions) {
    if (!d.activityId.trim() || byId.has(d.activityId)) throw new GoliathError('INVALID_INPUT', 'Forecast activity IDs must be non-empty and unique.');
    byId.set(d.activityId, d);
  }
  const indegree = new Map<string, number>([...byId.keys()].map((id) => [id, 0]));
  const successors = new Map<string, string[]>();
  for (const d of distributions) {
    for (const predecessor of d.predecessors ?? []) {
      if (!byId.has(predecessor.activityId)) throw new GoliathError('INVALID_INPUT', `Forecast predecessor ${predecessor.activityId} is missing.`);
      if (!Number.isFinite(predecessor.lag ?? 0)) throw new GoliathError('INVALID_INPUT', `Forecast lag for ${d.activityId} is invalid.`);
      indegree.set(d.activityId, (indegree.get(d.activityId) ?? 0) + 1);
      const list = successors.get(predecessor.activityId) ?? [];
      list.push(d.activityId);
      successors.set(predecessor.activityId, list);
    }
  }
  const ready = [...indegree.entries()].filter(([, n]) => n === 0).map(([id]) => id).sort();
  const order: DurationDistribution[] = [];
  while (ready.length > 0) {
    const id = ready.shift();
    if (!id) break;
    const item = byId.get(id);
    if (!item) continue;
    order.push(item);
    for (const successor of successors.get(id) ?? []) {
      const next = (indegree.get(successor) ?? 0) - 1;
      indegree.set(successor, next);
      if (next === 0) {
        ready.push(successor);
        ready.sort();
      }
    }
  }
  if (order.length !== distributions.length) throw new GoliathError('INVALID_INPUT', 'Forecast dependency network contains a cycle.');
  return order;
}

export function monteCarloDuration(distributions: readonly DurationDistribution[], samples = 5000, seed = 20260909): ForecastPercentiles {
  if (!Number.isInteger(samples) || samples < 100) throw new GoliathError('INVALID_INPUT', 'At least 100 integer samples are required.');
  if (distributions.length === 0) {
    return { status: 'partial', p50: null, p80: null, p95: null, samples: 0, seed, model: 'unavailable', reason: 'No activity duration inputs are available.' };
  }

  // Validate distributions once before simulation, not after partial samples have
  // already been generated.
  for (const d of distributions) triangular(() => 0.5, d.optimistic, d.mostLikely, d.pessimistic);
  const networkMode = distributions.some((d) => d.predecessors !== undefined);
  const order = networkMode ? dependencyOrder(distributions) : distributions;
  const rng = mulberry32(seed);
  const totals: number[] = [];

  for (let i = 0; i < samples; i += 1) {
    if (!networkMode) {
      totals.push(order.reduce((sum, d) => sum + triangular(rng, d.optimistic, d.mostLikely, d.pessimistic), 0));
      continue;
    }

    const finishes = new Map<string, number>();
    let projectFinish = 0;
    for (const d of order) {
      let start = 0;
      for (const predecessor of d.predecessors ?? []) {
        const predecessorFinish = finishes.get(predecessor.activityId);
        if (predecessorFinish === undefined) throw new GoliathError('INVALID_INPUT', `Forecast predecessor ${predecessor.activityId} has no calculated finish.`);
        start = Math.max(start, predecessorFinish + (predecessor.lag ?? 0));
      }
      const finish = start + triangular(rng, d.optimistic, d.mostLikely, d.pessimistic);
      finishes.set(d.activityId, finish);
      projectFinish = Math.max(projectFinish, finish);
    }
    totals.push(projectFinish);
  }

  totals.sort((a, b) => a - b);
  return {
    status: 'complete',
    p50: percentile(totals, 0.5),
    p80: percentile(totals, 0.8),
    p95: percentile(totals, 0.95),
    samples,
    seed,
    model: networkMode ? 'dependency-network' : 'serial',
  };
}

export interface BacktestObservation { predictedP80: number; actual: number; }
export interface BacktestResult { coverageAtP80: number; meanAbsoluteError: number; observations: number; calibrated: boolean; }

export function backtestForecast(observations: readonly BacktestObservation[], minimumObservations = 20): BacktestResult {
  if (!Number.isInteger(minimumObservations) || minimumObservations < 1) throw new GoliathError('INVALID_INPUT', 'minimumObservations must be a positive integer.');
  if (observations.some((o) => !Number.isFinite(o.predictedP80) || !Number.isFinite(o.actual) || o.predictedP80 < 0 || o.actual < 0)) {
    throw new GoliathError('INVALID_INPUT', 'Backtest observations must contain finite non-negative durations.');
  }
  if (observations.length === 0) return { coverageAtP80: 0, meanAbsoluteError: 0, observations: 0, calibrated: false };
  const coverage = observations.filter((o) => o.actual <= o.predictedP80).length / observations.length;
  const mae = observations.reduce((sum, o) => sum + Math.abs(o.predictedP80 - o.actual), 0) / observations.length;
  return {
    coverageAtP80: coverage,
    meanAbsoluteError: mae,
    observations: observations.length,
    calibrated: observations.length >= minimumObservations && coverage >= 0.7 && coverage <= 0.9,
  };
}
