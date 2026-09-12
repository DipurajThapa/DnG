import type { ProjectSignal } from '../control/types.js';
import { SqlResourceRepository } from '../resource/repository.js';
import type { ResourceAllocationRecord, ResourceDemandRecord, ResourceRecord } from '../resource/types.js';
import { SqlProjectRepository } from './sqlite-repository.js';

export interface ProjectSignalProvider {
  getSignals(projectId: string, now: Date): readonly ProjectSignal[];
}

function dateMs(value: string): number | undefined {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function overlapRatio(allocation: ResourceAllocationRecord, demand: ResourceDemandRecord): number {
  const a0 = dateMs(allocation.periodStart); const a1 = dateMs(allocation.periodEnd);
  const d0 = dateMs(demand.periodStart); const d1 = dateMs(demand.periodEnd);
  if (a0 === undefined || a1 === undefined || d0 === undefined || d1 === undefined || a1 < a0 || d1 < d0) return 0;
  const overlapStart = Math.max(a0, d0); const overlapEnd = Math.min(a1, d1);
  if (overlapEnd < overlapStart) return 0;
  const allocationDays = Math.floor((a1 - a0) / 86_400_000) + 1;
  const overlapDays = Math.floor((overlapEnd - overlapStart) / 86_400_000) + 1;
  return overlapDays / Math.max(1, allocationDays);
}

function resourceMatchesDemand(resource: ResourceRecord | undefined, allocation: ResourceAllocationRecord, demand: ResourceDemandRecord): boolean {
  if (!resource || !resource.active) return false;
  if (demand.teamId && allocation.teamId !== demand.teamId) return false;
  if (demand.orgUnitId && resource.orgUnitId !== demand.orgUnitId) return false;
  if (demand.skill && !resource.skills.includes(demand.skill)) return false;
  return true;
}

export class ResourceCapacitySignalProvider implements ProjectSignalProvider {
  constructor(private readonly resources: SqlResourceRepository, private readonly projects: SqlProjectRepository) {}

  getSignals(projectId: string, now: Date): readonly ProjectSignal[] {
    const project = this.projects.getProject(projectId);
    if (!project) return [];
    const allocations = this.resources.listAllocationsForProject(projectId).filter((allocation) => allocation.status === 'confirmed');
    const signals: ProjectSignal[] = [];

    for (const demand of this.resources.listDemandsForProject(projectId).filter((item) => item.state !== 'cancelled')) {
      const matched = allocations
        .filter((allocation) => resourceMatchesDemand(this.resources.getResource(allocation.resourceId), allocation, demand))
        .reduce((sum, allocation) => sum + allocation.hours * overlapRatio(allocation, demand), 0);
      const shortfall = Math.max(0, demand.requiredHours - matched);
      if (shortfall <= 0) continue;
      const ratio = shortfall / demand.requiredHours;
      const sourceRefs = [...new Set(allocations
        .filter((allocation) => overlapRatio(allocation, demand) > 0 && resourceMatchesDemand(this.resources.getResource(allocation.resourceId), allocation, demand))
        .flatMap((allocation) => this.resources.listCapacity(allocation.resourceId).map((period) => period.sourceRef).filter((ref): ref is string => Boolean(ref))))];
      signals.push({
        signalId: `resource-demand:${demand.id}:${Math.round(shortfall * 100)}`,
        organisationId: project.organisationId,
        projectId,
        kind: 'resource',
        rootCauseKey: `resource-demand:${demand.id}`,
        title: `${shortfall.toFixed(1)} hours of project demand remain unfilled`,
        observedAt: now.toISOString(),
        consequence: ratio >= 0.5 ? 'high' : 'medium',
        confidence: sourceRefs.length > 0 ? 'high' : 'medium',
        material: true,
        situation: `Confirmed allocation covers ${matched.toFixed(1)} of ${demand.requiredHours.toFixed(1)} requested hours for the demand window.`,
        impact: 'The planned work may not have sufficient confirmed capacity unless the demand is filled or the plan changes.',
        decisionOwnerId: project.pmId,
        dueAt: demand.periodStart,
        sourceRefs,
        suggestedAction: 'decide',
        metadata: { demandId: demand.id, requiredHours: demand.requiredHours, allocatedHours: matched, shortfallHours: shortfall },
      });
    }
    return signals;
  }
}
