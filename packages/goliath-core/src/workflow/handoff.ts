import { GoliathError } from '../core/errors.js';

export type HandoffState = 'ready' | 'accepted' | 'returned';
export interface HandoffInput {
  handoffId: string;
  projectId: string;
  deliverableVersion: string;
  senderId: string;
  receiverId: string;
  requiredChecksPassed: number;
  requiredChecksTotal: number;
  blockingConditions: readonly string[];
  nonBlockingConditions: readonly string[];
  state: HandoffState;
  attempt: number;
}

export interface HandoffDecision { state: 'accepted' | 'returned'; reason?: string; }

export function decideHandoff(input: HandoffInput, actorId: string, decision: HandoffDecision): HandoffInput {
  if (actorId !== input.receiverId) throw new GoliathError('ACCESS_DENIED', 'Only the named receiving owner can accept or return this handoff.');
  if (input.state !== 'ready') throw new GoliathError('INVALID_INPUT', 'Only a ready handoff can be accepted or returned.');
  if (decision.state === 'accepted') {
    if (input.requiredChecksPassed !== input.requiredChecksTotal || input.blockingConditions.length > 0) {
      throw new GoliathError('APPROVAL_REQUIRED', 'Required handoff checks are not satisfied.');
    }
    return { ...input, state: 'accepted' };
  }
  if (!decision.reason?.trim()) throw new GoliathError('INVALID_INPUT', 'A returned handoff needs a short corrective reason.');
  return { ...input, state: 'returned', attempt: input.attempt + 1 };
}
