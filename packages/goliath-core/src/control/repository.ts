import type { AiAssessment, AttentionItem, AutonomousCycleResult } from './types.js';

export interface ControlRepository {
  getAttentionByRoot(projectId: string, rootCauseKey: string): AttentionItem | undefined;
  getAttention(id: string): AttentionItem | undefined;
  putAttention(item: AttentionItem): void;
  listAttention(projectId: string): readonly AttentionItem[];
  putCycle(result: AutonomousCycleResult): void;
  listCycles(projectId: string): readonly AutonomousCycleResult[];
  putAiAssessment(attentionItemId: string, assessment: AiAssessment): void;
  getAiAssessment(attentionItemId: string): AiAssessment | undefined;
}

export class InMemoryControlRepository implements ControlRepository {
  readonly attention = new Map<string, AttentionItem>();
  readonly cycles = new Map<string, AutonomousCycleResult[]>();
  readonly ai = new Map<string, AiAssessment>();

  getAttentionByRoot(projectId: string, rootCauseKey: string): AttentionItem | undefined {
    return [...this.attention.values()].find((item) => item.projectId === projectId && item.rootCauseKey === rootCauseKey);
  }
  getAttention(id: string): AttentionItem | undefined { return this.attention.get(id); }
  putAttention(item: AttentionItem): void { this.attention.set(item.id, item); }
  listAttention(projectId: string): readonly AttentionItem[] { return [...this.attention.values()].filter((item) => item.projectId === projectId); }
  putCycle(result: AutonomousCycleResult): void {
    const current = this.cycles.get(result.projectId) ?? [];
    this.cycles.set(result.projectId, [...current, result]);
  }
  listCycles(projectId: string): readonly AutonomousCycleResult[] { return this.cycles.get(projectId) ?? []; }
  putAiAssessment(attentionItemId: string, assessment: AiAssessment): void { this.ai.set(attentionItemId, assessment); }
  getAiAssessment(attentionItemId: string): AiAssessment | undefined { return this.ai.get(attentionItemId); }
}
