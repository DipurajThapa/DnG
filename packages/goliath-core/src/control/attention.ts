import { randomUUID } from 'node:crypto';
import type { ControlRepository } from './repository.js';
import type { AttentionAction, AttentionItem, ConsequenceLevel, EvidenceConfidence, ProjectSignal } from './types.js';

const consequenceWeight: Readonly<Record<ConsequenceLevel, number>> = { critical: 400, high: 300, medium: 200, low: 100 };
const confidenceRank: Readonly<Record<EvidenceConfidence, number>> = { high: 4, medium: 3, low: 2, unknown: 1 };

function dueUrgency(dueAt: string | undefined, now: Date): number {
  if (!dueAt) return 0;
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return 0;
  const hours = (due - now.getTime()) / 3_600_000;
  if (hours <= 0) return 90;
  if (hours <= 24) return 70;
  if (hours <= 72) return 50;
  if (hours <= 168) return 25;
  return 0;
}

export function attentionPriority(item: Pick<AttentionItem, 'consequence' | 'confidence' | 'dueAt'>, now: Date = new Date()): number {
  // Confidence deliberately does not lower consequence. Low-confidence critical
  // items become verify-urgently rather than appearing low priority.
  const verificationUrgency = item.confidence === 'low' || item.confidence === 'unknown' ? 15 : 0;
  return consequenceWeight[item.consequence] + dueUrgency(item.dueAt, now) + verificationUrgency;
}

export function defaultNextAction(signal: ProjectSignal): AttentionAction {
  if (signal.suggestedAction) return signal.suggestedAction;
  if (signal.confidence === 'low' || signal.confidence === 'unknown') return 'confirm';
  if (signal.kind === 'acceptance' || signal.kind === 'handoff') return 'accept';
  if (signal.kind === 'budget' && signal.consequence !== 'low') return 'approve';
  if (signal.kind === 'schedule' || signal.kind === 'dependency' || signal.kind === 'resource') return 'decide';
  if (signal.kind === 'evidence' || signal.kind === 'source-health') return 'correct';
  return 'resolve';
}

function strongestConsequence(signals: readonly ProjectSignal[]): ConsequenceLevel {
  return [...signals].sort((a, b) => consequenceWeight[b.consequence] - consequenceWeight[a.consequence])[0]?.consequence ?? 'low';
}

function weakestConfidence(signals: readonly ProjectSignal[]): EvidenceConfidence {
  return [...signals].sort((a, b) => confidenceRank[a.confidence] - confidenceRank[b.confidence])[0]?.confidence ?? 'unknown';
}

function union(values: readonly (readonly string[])[]): string[] { return [...new Set(values.flat())]; }

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
}

function sameMaterialAttention(existing: AttentionItem, next: AttentionItem): boolean {
  return existing.state === next.state
    && existing.title === next.title
    && existing.consequence === next.consequence
    && existing.confidence === next.confidence
    && existing.situation === next.situation
    && existing.impact === next.impact
    && existing.ownerId === next.ownerId
    && existing.decisionOwnerId === next.decisionOwnerId
    && existing.dueAt === next.dueAt
    && existing.nextAction === next.nextAction
    && sameStrings(existing.sourceSignalIds, next.sourceSignalIds)
    && sameStrings(existing.sourceRefs, next.sourceRefs);
}

export class AttentionEngine {
  constructor(private readonly repo: ControlRepository, private readonly now: () => Date = () => new Date()) {}

  reconcile(projectId: string, signals: readonly ProjectSignal[]): { created: number; updated: number; resolved: number; active: readonly AttentionItem[] } {
    const nowIso = this.now().toISOString();
    const material = signals.filter((signal) => signal.projectId === projectId && signal.material);
    const grouped = new Map<string, ProjectSignal[]>();
    for (const signal of material) grouped.set(signal.rootCauseKey, [...(grouped.get(signal.rootCauseKey) ?? []), signal]);

    let created = 0;
    let updated = 0;
    let resolved = 0;
    const seenRoots = new Set<string>();

    for (const [root, group] of grouped.entries()) {
      seenRoots.add(root);
      const existing = this.repo.getAttentionByRoot(projectId, root);
      const consequence = strongestConsequence(group);
      const confidence = weakestConfidence(group);
      const primary = [...group].sort((a, b) => consequenceWeight[b.consequence] - consequenceWeight[a.consequence])[0];
      if (!primary) continue;
      const dueAt = [...group].map((x) => x.dueAt).filter((x): x is string => Boolean(x)).sort()[0];
      const nextAction = defaultNextAction({ ...primary, confidence, consequence });
      const situation = group.length === 1 ? primary.situation : `${primary.situation} (${group.length} related signals consolidated)`;
      const impact = group.map((x) => x.impact).filter(Boolean).join(' | ');
      if (existing) {
        const { resolvedAt: _resolvedAt, ...existingActive } = existing;
        const next: AttentionItem = {
          ...existingActive,
          title: primary.title,
          state: 'open',
          consequence,
          confidence,
          situation,
          impact,
          ...(primary.ownerId ? { ownerId: primary.ownerId } : {}),
          ...(primary.decisionOwnerId ? { decisionOwnerId: primary.decisionOwnerId } : {}),
          ...(dueAt ? { dueAt } : {}),
          nextAction,
          sourceSignalIds: group.map((x) => x.signalId),
          sourceRefs: union(group.map((x) => x.sourceRefs)),
          lastSeenAt: nowIso,
          revision: existing.revision + 1,
        };
        if (!sameMaterialAttention(existing, next)) {
          this.repo.putAttention(next);
          updated += 1;
        }
      } else {
        const next: AttentionItem = {
          id: randomUUID(), organisationId: primary.organisationId, projectId, rootCauseKey: root,
          title: primary.title, state: 'open', consequence, confidence, situation, impact,
          ...(primary.ownerId ? { ownerId: primary.ownerId } : {}),
          ...(primary.decisionOwnerId ? { decisionOwnerId: primary.decisionOwnerId } : {}),
          ...(dueAt ? { dueAt } : {}),
          nextAction, sourceSignalIds: group.map((x) => x.signalId), sourceRefs: union(group.map((x) => x.sourceRefs)),
          firstSeenAt: nowIso, lastSeenAt: nowIso, revision: 1,
        };
        this.repo.putAttention(next);
        created += 1;
      }
    }

    for (const item of this.repo.listAttention(projectId)) {
      if (item.state === 'open' && !seenRoots.has(item.rootCauseKey)) {
        this.repo.putAttention({ ...item, state: 'resolved', resolvedAt: nowIso, lastSeenAt: nowIso, nextAction: 'none', revision: item.revision + 1 });
        resolved += 1;
      }
    }

    return { created, updated, resolved, active: this.ranked(projectId) };
  }

  ranked(projectId: string): readonly AttentionItem[] {
    const now = this.now();
    return this.repo.listAttention(projectId)
      .filter((item) => item.state === 'open' || item.state === 'waiting')
      .sort((a, b) => attentionPriority(b, now) - attentionPriority(a, now) || a.firstSeenAt.localeCompare(b.firstSeenAt));
  }
}
