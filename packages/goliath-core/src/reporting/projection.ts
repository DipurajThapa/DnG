import type { AttentionItem, ProjectOrientation } from '../control/types.js';

export type ProjectionAudience = 'pm' | 'program' | 'sponsor';

export interface GovernedProjection {
  projectId: string;
  audience: ProjectionAudience;
  generatedAt: string;
  headline: string;
  materialChange: boolean;
  decisions: readonly AttentionItem[];
  interventions: readonly AttentionItem[];
  awareness: readonly AttentionItem[];
  orientation: ProjectOrientation;
  sourceRefs: readonly string[];
}

export function generateProjection(
  orientation: ProjectOrientation,
  attention: readonly AttentionItem[],
  audience: ProjectionAudience,
  generatedAt: string = new Date().toISOString(),
): GovernedProjection {
  const open = attention.filter((item) => item.state === 'open' || item.state === 'waiting');
  const decisions = open.filter((item) => item.nextAction === 'decide' || item.nextAction === 'approve');
  const interventions = open.filter((item) => ['resolve', 'assign', 'correct', 'accept', 'return'].includes(item.nextAction));
  const awareness = open.filter((item) => item.nextAction === 'confirm' || item.nextAction === 'none');
  const materialChange = open.some((item) => item.consequence === 'critical' || item.consequence === 'high');
  const headline = open.length === 0
    ? 'No material project intervention is currently required.'
    : `${open.length} item${open.length === 1 ? ' requires' : 's require'} attention; ${decisions.length} require decision or approval.`;
  const sourceRefs = [...new Set(open.flatMap((item) => item.sourceRefs))];
  return { projectId: orientation.projectId, audience, generatedAt, headline, materialChange, decisions, interventions, awareness, orientation, sourceRefs };
}
