import { randomUUID } from 'node:crypto';
import { digest } from '../core/hash.js';
import type { AiReasoningProvider } from '../ai/assistant.js';
import { sanitizeAiAssessment } from '../ai/assistant.js';
import type { ControlRepository } from './repository.js';
import { AttentionEngine } from './attention.js';
import type { AttentionItem, AutonomousAction, AutonomousCycleResult, ProjectSignal } from './types.js';

export interface AutonomousControlPolicy {
  aiEnabled: boolean;
  autoPrepareDecisionBriefs: boolean;
  autoCreateInternalActions: boolean;
  autoRequestEvidence: boolean;
  suppressNoMaterialChange: boolean;
  allowedAutoActionConsequences: readonly ('low' | 'medium' | 'high' | 'critical')[];
}

export interface EvidenceResolver {
  getPermittedEvidence(item: AttentionItem): Promise<readonly { ref: string; summary: string }[]>;
}

function prepareAction(item: AttentionItem, policy: AutonomousControlPolicy): AutonomousAction {
  const common = { actionId: randomUUID(), attentionItemId: item.id, projectId: item.projectId };
  if ((item.confidence === 'low' || item.confidence === 'unknown') && policy.autoRequestEvidence) {
    return { ...common, type: 'request-evidence', rationale: 'Evidence is insufficient for a reliable conclusion.', requiresHumanAuthority: false, ...(item.ownerId ? { targetOwnerId: item.ownerId } : {}) };
  }
  if ((item.nextAction === 'decide' || item.nextAction === 'approve') && policy.autoPrepareDecisionBriefs) {
    return { ...common, type: 'prepare-decision-brief', rationale: 'Prepare the decision context without changing project authority.', requiresHumanAuthority: true, ...(item.decisionOwnerId ? { targetOwnerId: item.decisionOwnerId } : {}) };
  }
  if (item.nextAction === 'resolve' && policy.autoCreateInternalActions && policy.allowedAutoActionConsequences.includes(item.consequence)) {
    return { ...common, type: 'create-internal-action', rationale: 'Create a traceable internal corrective action from the detected exception.', requiresHumanAuthority: false, ...(item.ownerId ? { targetOwnerId: item.ownerId } : {}) };
  }
  return { ...common, type: 'no-op', rationale: 'No safe autonomous action is permitted; keep the item visible to its accountable owner.', requiresHumanAuthority: item.nextAction === 'approve' || item.nextAction === 'decide' };
}

export class AutonomousProjectManager {
  private readonly attention: AttentionEngine;
  constructor(
    private readonly repo: ControlRepository,
    private readonly ai: AiReasoningProvider,
    private readonly evidence: EvidenceResolver,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.attention = new AttentionEngine(repo, now);
  }

  async run(projectId: string, signals: readonly ProjectSignal[], policy: AutonomousControlPolicy): Promise<AutonomousCycleResult> {
    const reconciliation = this.attention.reconcile(projectId, signals);
    const active = reconciliation.active;
    const materialSignals = signals.filter((x) => x.projectId === projectId && x.material).length;
    const noMaterialChange = materialSignals === 0 && active.length === 0;
    const actions: AutonomousAction[] = [];
    let aiAssessments = 0;

    for (const item of active) {
      if (policy.aiEnabled) {
        const basisHash = digest({ attentionId:item.id, revision:item.revision, consequence:item.consequence, confidence:item.confidence, nextAction:item.nextAction,
          situation:item.situation, impact:item.impact, sourceSignalIds:item.sourceSignalIds, sourceRefs:item.sourceRefs });
        const existingAssessment = this.repo.getAiAssessment(item.id);
        if (existingAssessment?.basisHash !== basisHash) {
          try {
            const permittedEvidence = await this.evidence.getPermittedEvidence(item);
            const raw = await this.ai.assess({ attention: item, permittedEvidence, allowedDecisionTypes: ['decide', 'approve', 'confirm', 'correct'] });
            const assessment = { ...sanitizeAiAssessment(raw, item), basisHash };
            this.repo.putAiAssessment(item.id, assessment);
            this.repo.putAttention({ ...item, aiAssessment: assessment, revision: item.revision });
            aiAssessments += 1;
          } catch {
            // AI is non-authoritative. Its failure must not stop deterministic control.
          }
        }
      }
      actions.push(prepareAction(this.repo.getAttention(item.id) ?? item, policy));
    }

    const result: AutonomousCycleResult = {
      cycleId: randomUUID(), projectId, observedSignals: signals.filter((x) => x.projectId === projectId).length,
      materialSignals, attentionCreated: reconciliation.created, attentionUpdated: reconciliation.updated,
      autoResolved: reconciliation.resolved, preparedActions: actions.filter((a) => a.type !== 'no-op'), aiAssessments,
      suppressedAsNoMaterialChange: policy.suppressNoMaterialChange && noMaterialChange,
      completedAt: this.now().toISOString(),
    };
    this.repo.putCycle(result);
    return result;
  }
}
