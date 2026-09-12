import { GoliathError } from '../core/errors.js';

export interface ResourceSupply {
  resourceId: string;
  skill: string;
  availableHours: number;
  costPerHour: number;
  projectIdsAllowed: readonly string[];
}

export interface ResourceDemand {
  demandId: string;
  projectId: string;
  skill: string;
  requiredHours: number;
  priority: number;
}

export interface AllocationRecommendation {
  demandId: string;
  projectId: string;
  assignments: readonly { resourceId: string; hours: number; estimatedCost: number }[];
  filledHours: number;
  unmetHours: number;
  explanation: string;
}

interface FlowEdge {
  to: number;
  rev: number;
  cap: number;
  originalCap: number;
  cost: number[];
  resourceId?: string;
  demandId?: string;
}

const EPS = 1e-9;

function zeroVector(length: number): number[] { return Array.from({ length }, () => 0); }
function addVector(a: readonly number[], b: readonly number[]): number[] { return a.map((x, i) => x + (b[i] ?? 0)); }
function negateVector(a: readonly number[]): number[] { return a.map((x) => -x); }
function compareVector(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (Math.abs(diff) > EPS) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function addEdge(graph: FlowEdge[][], from: number, to: number, cap: number, cost: number[], metadata?: { resourceId?: string; demandId?: string }): FlowEdge {
  const forward: FlowEdge = {
    to,
    rev: graph[to]?.length ?? 0,
    cap,
    originalCap: cap,
    cost,
    ...(metadata?.resourceId ? { resourceId: metadata.resourceId } : {}),
    ...(metadata?.demandId ? { demandId: metadata.demandId } : {}),
  };
  const reverse: FlowEdge = { to: from, rev: graph[from]?.length ?? 0, cap: 0, originalCap: 0, cost: negateVector(cost) };
  graph[from]?.push(forward);
  graph[to]?.push(reverse);
  return forward;
}

function validateInputs(supply: readonly ResourceSupply[], demand: readonly ResourceDemand[]): void {
  const resourceIds = new Set<string>();
  for (const s of supply) {
    if (!s.resourceId.trim() || resourceIds.has(s.resourceId)) throw new GoliathError('INVALID_INPUT', 'Resource IDs must be non-empty and unique.');
    resourceIds.add(s.resourceId);
    if (!s.skill.trim() || !Number.isFinite(s.availableHours) || s.availableHours < 0 || !Number.isFinite(s.costPerHour) || s.costPerHour < 0) {
      throw new GoliathError('INVALID_INPUT', `Resource ${s.resourceId} has invalid skill/capacity/cost.`);
    }
  }
  const demandIds = new Set<string>();
  for (const d of demand) {
    if (!d.demandId.trim() || demandIds.has(d.demandId)) throw new GoliathError('INVALID_INPUT', 'Demand IDs must be non-empty and unique.');
    demandIds.add(d.demandId);
    if (!d.projectId.trim() || !d.skill.trim() || !Number.isFinite(d.requiredHours) || d.requiredHours < 0 || !Number.isFinite(d.priority)) {
      throw new GoliathError('INVALID_INPUT', `Demand ${d.demandId} has invalid project/skill/hours/priority.`);
    }
  }
}

/**
 * Solves a transportation/min-cost-flow problem with a lexicographic objective:
 * 1) minimise unmet hours at the highest priority;
 * 2) then minimise unmet hours at each lower priority;
 * 3) then minimise assignment cost.
 *
 * Unmet capacity is modelled as an explicit virtual edge for every demand.  Its
 * vector cost is charged in the priority dimension, so a cheaper flexible
 * resource cannot starve a demand that only a scarce resource can serve.
 */
export function optimisePortfolioResources(supply: readonly ResourceSupply[], demand: readonly ResourceDemand[]): readonly AllocationRecommendation[] {
  validateInputs(supply, demand);
  const orderedDemand = [...demand].sort((a, b) => b.priority - a.priority || a.demandId.localeCompare(b.demandId));
  if (orderedDemand.length === 0) return [];

  const priorities = [...new Set(orderedDemand.map((d) => d.priority))].sort((a, b) => b - a);
  const priorityIndex = new Map(priorities.map((p, i) => [p, i]));
  const vectorLength = priorities.length + 1; // final dimension is financial cost

  const source = 0;
  const resourceOffset = 1;
  const demandOffset = resourceOffset + supply.length;
  const sink = demandOffset + orderedDemand.length;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const assignmentEdges: FlowEdge[] = [];

  supply.forEach((s, i) => {
    addEdge(graph, source, resourceOffset + i, s.availableHours, zeroVector(vectorLength));
  });

  orderedDemand.forEach((d, j) => {
    const demandNode = demandOffset + j;
    const penalty = zeroVector(vectorLength);
    const rank = priorityIndex.get(d.priority);
    if (rank === undefined) throw new GoliathError('INVALID_INPUT', 'Demand priority could not be ranked.');
    penalty[rank] = 1;
    // Virtual unmet flow makes the network always feasible while the vector
    // objective minimises that flow before considering assignment cost.
    addEdge(graph, source, demandNode, d.requiredHours, penalty, { demandId: d.demandId });
    addEdge(graph, demandNode, sink, d.requiredHours, zeroVector(vectorLength));

    supply.forEach((s, i) => {
      if (s.skill !== d.skill || !s.projectIdsAllowed.includes(d.projectId) || s.availableHours <= EPS) return;
      const cost = zeroVector(vectorLength);
      cost[vectorLength - 1] = s.costPerHour;
      assignmentEdges.push(addEdge(graph, resourceOffset + i, demandNode, Math.min(s.availableHours, d.requiredHours), cost, { resourceId: s.resourceId, demandId: d.demandId }));
    });
  });

  const targetFlow = orderedDemand.reduce((sum, d) => sum + d.requiredHours, 0);
  let sent = 0;
  while (sent + EPS < targetFlow) {
    const dist: Array<number[] | undefined> = Array.from({ length: graph.length }, () => undefined);
    const previousNode = Array.from({ length: graph.length }, () => -1);
    const previousEdge = Array.from({ length: graph.length }, () => -1);
    dist[source] = zeroVector(vectorLength);

    // Bellman-Ford is used instead of scalar Dijkstra because residual reverse
    // edges can have negative vector cost and may be needed to reassign scarce
    // capacity from an earlier augmenting path.
    for (let pass = 0; pass < graph.length - 1; pass += 1) {
      let changed = false;
      for (let u = 0; u < graph.length; u += 1) {
        const base = dist[u];
        if (!base) continue;
        const edges = graph[u] ?? [];
        for (let ei = 0; ei < edges.length; ei += 1) {
          const edge = edges[ei];
          if (!edge || edge.cap <= EPS) continue;
          const candidate = addVector(base, edge.cost);
          const current = dist[edge.to];
          if (!current || compareVector(candidate, current) < 0) {
            dist[edge.to] = candidate;
            previousNode[edge.to] = u;
            previousEdge[edge.to] = ei;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }

    if (!dist[sink]) throw new GoliathError('INVALID_INPUT', 'Portfolio allocation network became infeasible unexpectedly.');
    let augment = targetFlow - sent;
    for (let v = sink; v !== source;) {
      const u = previousNode[v] ?? -1;
      const ei = previousEdge[v] ?? -1;
      if (u < 0 || ei < 0) throw new GoliathError('INVALID_INPUT', 'Allocation path reconstruction failed.');
      const edge = graph[u]?.[ei];
      if (!edge) throw new GoliathError('INVALID_INPUT', 'Allocation path edge is missing.');
      augment = Math.min(augment, edge.cap);
      v = u;
    }
    if (augment <= EPS) throw new GoliathError('INVALID_INPUT', 'Allocation solver made no progress.');

    for (let v = sink; v !== source;) {
      const u = previousNode[v] ?? -1;
      const ei = previousEdge[v] ?? -1;
      if (u < 0 || ei < 0) throw new GoliathError('INVALID_INPUT', 'Allocation path reconstruction failed.');
      const edge = graph[u]?.[ei];
      if (!edge) throw new GoliathError('INVALID_INPUT', 'Allocation path edge is missing.');
      edge.cap -= augment;
      const reverse = graph[v]?.[edge.rev];
      if (!reverse) throw new GoliathError('INVALID_INPUT', 'Allocation reverse edge is missing.');
      reverse.cap += augment;
      v = u;
    }
    sent += augment;
  }

  const byDemand = new Map<string, { resourceId: string; hours: number; estimatedCost: number }[]>();
  for (const edge of assignmentEdges) {
    const flow = Math.max(0, edge.originalCap - edge.cap);
    if (flow <= EPS || !edge.resourceId || !edge.demandId) continue;
    const resource = supply.find((s) => s.resourceId === edge.resourceId);
    if (!resource) continue;
    const list = byDemand.get(edge.demandId) ?? [];
    list.push({ resourceId: edge.resourceId, hours: flow, estimatedCost: flow * resource.costPerHour });
    byDemand.set(edge.demandId, list);
  }

  return orderedDemand.map((d) => {
    const assignments = (byDemand.get(d.demandId) ?? []).sort((a, b) => a.resourceId.localeCompare(b.resourceId));
    const filledHours = assignments.reduce((sum, a) => sum + a.hours, 0);
    const unmetHours = Math.max(0, d.requiredHours - filledHours);
    const estimatedCost = assignments.reduce((sum, a) => sum + a.estimatedCost, 0);
    return {
      demandId: d.demandId,
      projectId: d.projectId,
      assignments,
      filledHours,
      unmetHours,
      explanation: unmetHours > EPS
        ? `Lexicographic portfolio optimisation filled ${filledHours}/${d.requiredHours} hours at priority ${d.priority}; ${unmetHours} hours remain infeasible after protecting higher-priority demand. Estimated cost ${estimatedCost}.`
        : `Lexicographic portfolio optimisation filled all ${d.requiredHours} hours at priority ${d.priority} while preserving scarce-resource feasibility; estimated cost ${estimatedCost}.`,
    };
  });
}
