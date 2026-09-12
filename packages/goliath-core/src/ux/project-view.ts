import type { AttentionItem, ProjectOrientation } from '../control/types.js';
import { attentionPriority } from '../control/attention.js';

export interface ProjectOverviewViewModel {
  projectId: string;
  title: string;
  lifecycle: ProjectOrientation['lifecycle'];
  interventionSummary: string;
  critical: readonly AttentionItem[];
  next: readonly AttentionItem[];
  orientation: {
    deliveryForecast: string;
    budgetForecast: string;
    evidence: string;
    sources: string;
  };
  hideRoutineTaskCounts: boolean;
}

function dateDelta(base?: string, forecast?: string): string {
  if (!base || !forecast) return 'Forecast not available';
  const b = Date.parse(base); const f = Date.parse(forecast);
  if (!Number.isFinite(b) || !Number.isFinite(f)) return 'Forecast not available';
  const days = Math.round((f - b) / 86_400_000);
  if (days === 0) return 'On baseline date';
  return `${days > 0 ? '+' : ''}${days} day${Math.abs(days) === 1 ? '' : 's'} vs baseline`;
}

export function buildProjectOverview(orientation: ProjectOrientation, attention: readonly AttentionItem[], now = new Date()): ProjectOverviewViewModel {
  const active = attention.filter((x) => x.state === 'open' || x.state === 'waiting').sort((a, b) => attentionPriority(b, now) - attentionPriority(a, now));
  const critical = active.filter((x) => x.consequence === 'critical');
  const next = active.filter((x) => x.consequence !== 'critical').slice(0, 6);
  const budgetForecast = orientation.budget !== undefined && orientation.eac !== undefined
    ? `${orientation.eac > orientation.budget ? '+' : ''}${((orientation.eac - orientation.budget) / Math.max(Math.abs(orientation.budget), 1) * 100).toFixed(1)}% vs budget`
    : 'Budget forecast not available';
  return {
    projectId: orientation.projectId, title: orientation.projectName, lifecycle: orientation.lifecycle,
    interventionSummary: active.length === 0 ? 'No intervention required.' : `${active.length} item${active.length === 1 ? ' requires' : 's require'} attention.`,
    critical, next,
    orientation: { deliveryForecast: dateDelta(orientation.baselineFinish, orientation.forecastFinish), budgetForecast, evidence: `${orientation.evidenceConfidence} confidence`, sources: orientation.sourceHealthSummary },
    hideRoutineTaskCounts: true,
  };
}
