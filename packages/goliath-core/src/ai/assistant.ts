import { randomUUID } from 'node:crypto';
import type { AiAssessment, AttentionItem, EvidenceConfidence } from '../control/types.js';

export interface AiReasoningRequest {
  attention: AttentionItem;
  permittedEvidence: readonly { ref: string; summary: string }[];
  allowedDecisionTypes: readonly string[];
}

export interface AiReasoningProvider {
  readonly label: string;
  assess(request: AiReasoningRequest): Promise<AiAssessment>;
}

export class DeterministicFallbackAi implements AiReasoningProvider {
  readonly label = 'deterministic-fallback';
  async assess(request: AiReasoningRequest): Promise<AiAssessment> {
    const item = request.attention;
    const lowEvidence = item.confidence === 'low' || item.confidence === 'unknown' || request.permittedEvidence.length === 0;
    const option = {
      optionId: 'default-response',
      label: lowEvidence ? 'Verify before committing' : `Proceed with ${item.nextAction}`,
      expectedEffect: lowEvidence ? 'Obtain the missing authoritative evidence without changing formal project state.' : 'Address the identified project exception through the current accountable owner.',
      risks: lowEvidence ? ['Acting before verification could create a false project conclusion.'] : [],
      evidenceLimits: lowEvidence ? ['Evidence is insufficient for a stronger recommendation.'] : [],
    };
    return {
      assessmentId: randomUUID(), generatedAt: new Date().toISOString(), modelLabel: this.label,
      summary: `${item.situation} Impact: ${item.impact}`,
      options: [option],
      ...(lowEvidence ? {} : { recommendedOptionId: option.optionId }),
      missingInformation: lowEvidence ? ['Additional authoritative evidence or confirmation is required.'] : [],
      confidence: lowEvidence ? 'low' : item.confidence,
      sourceRefs: item.sourceRefs,
      abstained: lowEvidence,
    };
  }
}

export function sanitizeAiAssessment(assessment: AiAssessment, attention: AttentionItem): AiAssessment {
  // AI can interpret only evidence references already permitted into the item.
  const allowed = new Set(attention.sourceRefs);
  const sourceRefs = assessment.sourceRefs.filter((ref) => allowed.has(ref));
  const confidence: EvidenceConfidence = sourceRefs.length === 0 && attention.sourceRefs.length > 0 ? 'low' : assessment.confidence;
  const abstained = assessment.abstained || (attention.sourceRefs.length > 0 && sourceRefs.length === 0);
  const base = { ...assessment, sourceRefs, confidence, abstained };
  if (abstained) {
    const { recommendedOptionId: _ignored, ...withoutRecommendation } = base;
    return withoutRecommendation;
  }
  return base;
}
