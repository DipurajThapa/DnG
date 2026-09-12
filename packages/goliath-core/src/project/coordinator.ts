import { randomUUID } from 'node:crypto';
import { digest } from '../core/hash.js';
import { DeterministicFallbackAi, type AiReasoningProvider } from '../ai/assistant.js';
import { AutonomousProjectManager, type AutonomousControlPolicy, type EvidenceResolver } from '../control/autonomy.js';
import type { AutonomousCycleResult, ProjectOrientation, ProjectSignal } from '../control/types.js';
import { generateProjection, type GovernedProjection } from '../reporting/projection.js';
import type { WorkActionRecord } from './types.js';
import { SqlProjectRepository } from './sqlite-repository.js';
import { ProjectControlService } from './service.js';
import { detectProjectSignals } from './signal-detector.js';
import { calculateTraceabilitySnapshot, type TraceabilitySnapshot } from '../trace/metrics.js';
import type { ProjectSignalProvider } from './resource-signal-provider.js';

export interface ControlCycleOutcome {
  projectId: string;
  signals: readonly ProjectSignal[];
  cycle: AutonomousCycleResult;
  createdWorkActions: readonly WorkActionRecord[];
  projections: readonly GovernedProjection[];
  traceability: TraceabilitySnapshot;
  persistedProjectionCount: number;
}

export const DEFAULT_AUTONOMY_POLICY: AutonomousControlPolicy = {
  aiEnabled: true,
  autoPrepareDecisionBriefs: true,
  autoCreateInternalActions: true,
  autoRequestEvidence: true,
  suppressNoMaterialChange: true,
  allowedAutoActionConsequences: ['low', 'medium', 'high'],
};

export class RepositoryEvidenceResolver implements EvidenceResolver {
  async getPermittedEvidence(item: { sourceRefs: readonly string[] }): Promise<readonly { ref: string; summary: string }[]> {
    return item.sourceRefs.map((ref) => ({ ref, summary: `Governed evidence reference ${ref}` }));
  }
}

export class ProjectControlCoordinator {
  private readonly manager: AutonomousProjectManager;
  private readonly service: ProjectControlService;

  constructor(
    private readonly repo: SqlProjectRepository,
    ai: AiReasoningProvider = new DeterministicFallbackAi(),
    evidence: EvidenceResolver = new RepositoryEvidenceResolver(),
    private readonly now: () => Date = () => new Date(),
    private readonly signalProviders: readonly ProjectSignalProvider[] = [],
  ) {
    this.manager = new AutonomousProjectManager(repo, ai, evidence, now);
    this.service = new ProjectControlService(repo, now);
  }

  async run(projectId: string, policy: AutonomousControlPolicy = DEFAULT_AUTONOMY_POLICY): Promise<ControlCycleOutcome> {
    this.service.refreshDerivedProjectState(projectId);
    const detected = detectProjectSignals(this.repo, projectId, this.now());
    const supplemental = this.signalProviders.flatMap((provider) => provider.getSignals(projectId, this.now()));
    const signals = [...new Map([...detected, ...supplemental].map((signal) => [signal.signalId, signal])).values()];
    const cycle = await this.manager.run(projectId, signals, policy);
    const createdWorkActions: WorkActionRecord[] = [];

    for (const action of cycle.preparedActions) {
      const item = this.repo.getAttention(action.attentionItemId);
      if (!item) continue;
      if (action.type === 'prepare-decision-brief' && action.targetOwnerId) {
        this.service.createPendingDecision(projectId, item.id, action.targetOwnerId, item.sourceRefs);
        continue;
      }
      if (action.type !== 'create-internal-action' && action.type !== 'request-evidence') continue;
      const type: WorkActionRecord['type'] = action.type === 'request-evidence' ? 'evidence-request' : 'corrective';
      if (this.repo.findOpenWorkAction(projectId, item.id, type)) continue;
      const project = this.repo.getProject(projectId);
      if (!project) continue;
      const ownerId = action.targetOwnerId ?? item.ownerId ?? project.pmId;
      const record: WorkActionRecord = {
        id: randomUUID(), projectId, attentionItemId: item.id, type,
        title: action.type === 'request-evidence' ? `Provide evidence: ${item.title}` : `Resolve: ${item.title}`,
        ownerId, ...(item.dueAt ? { dueAt: item.dueAt } : {}), state: 'open', createdBy: 'system:autonomy',
        createdAt: this.now().toISOString(), sourceRefs: item.sourceRefs, revision: 1,
      };
      this.service.createWorkAction(record);
      createdWorkActions.push(record);
    }

    for (const action of this.repo.listWorkActions(projectId).filter((record) => record.state === 'open' && record.attentionItemId)) {
      const item = this.repo.getAttention(action.attentionItemId!);
      if (item?.state === 'resolved') this.service.completeWorkActionFromResolvedAttention(projectId, action.id, item.id);
    }
    for (const decision of this.repo.listDecisions(projectId).filter((record) => record.state === 'pending')) {
      const item = this.repo.getAttention(decision.attentionItemId);
      if (item?.state === 'resolved') this.service.supersedePendingDecision(projectId, decision.attentionItemId);
    }

    const orientation = this.buildOrientation(projectId);
    const attention = this.repo.listAttention(projectId);
    const projections = (['pm', 'program', 'sponsor'] as const).map((audience) => generateProjection(orientation, attention, audience, this.now().toISOString()));
    let persistedProjectionCount = 0;
    for (const projection of projections) if (this.persistProjection(projection)) persistedProjectionCount += 1;

    const traceability = calculateTraceabilitySnapshot(this.repo, projectId);
    return { projectId, signals, cycle, createdWorkActions, projections, traceability, persistedProjectionCount };
  }

  private buildOrientation(projectId: string): ProjectOrientation {
    const project = this.repo.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found.`);
    const active = this.repo.listAttention(projectId).filter((item) => item.state === 'open' || item.state === 'waiting');
    return {
      projectId,
      projectName: project.name,
      lifecycle: project.lifecycle,
      ...(project.baselineVersion ? { baselineVersion: project.baselineVersion } : {}),
      ...(project.forecastFinish ? { forecastFinish: project.forecastFinish } : {}),
      ...(project.baselineFinish ? { baselineFinish: project.baselineFinish } : {}),
      ...(project.budget !== undefined ? { budget: project.budget } : {}),
      ...(project.eac !== undefined ? { eac: project.eac } : {}),
      ...(project.currency ? { currency: project.currency } : {}),
      openAttentionCount: active.length,
      criticalAttentionCount: active.filter((item) => item.consequence === 'critical').length,
      evidenceConfidence: project.evidenceConfidence,
      sourceHealthSummary: project.sourceHealthSummary,
    };
  }

  private persistProjection(projection: GovernedProjection): boolean {
    const projectionJson = JSON.stringify(projection);
    const { generatedAt: _generatedAt, ...content } = projection;
    const projectionHash = digest(content);
    const previous = this.repo.listProjections(projection.projectId).filter((item) => item.audience === projection.audience).at(-1);
    if (previous?.projectionHash === projectionHash) return false;
    const id = randomUUID();
    this.repo.transaction(() => {
      this.repo.insertProjection({ id, projectId: projection.projectId, audience: projection.audience, generatedAt: projection.generatedAt,
        headline: projection.headline, projectionHash, projectionJson, sourceRefs: projection.sourceRefs });
      this.repo.appendEvent({ id: randomUUID(), projectId: projection.projectId, actorId: 'system:reporting', eventType: 'projection.generated',
        entityType: 'projection', entityId: id, result: 'recorded', reason: `Governed ${projection.audience} projection generated from current project state.`,
        occurredAt: projection.generatedAt, correlationId: `projection:${id}`, sourceRefs: projection.sourceRefs,
        metadata: { audience: projection.audience, projectionHash, materialChange: projection.materialChange } });
    });
    return true;
  }
}
