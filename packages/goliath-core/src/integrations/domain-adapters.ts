import { randomUUID } from 'node:crypto';
import type { EffectIntent, OperationalDomain, ProviderAdapter, ProviderReceipt, ReconciliationResult } from '../core/types.js';

export interface SimulatedProviderBehavior {
  dispatch: 'accepted' | 'rejected' | 'unknown';
  readBack: 'confirmed' | 'rejected' | 'absent-safe-to-retry' | 'manual-investigation';
}

export class ContractTestAdapter implements ProviderAdapter {
  private readonly receipts = new Map<string, ProviderReceipt>();

  constructor(
    public readonly provider: string,
    public readonly domains: readonly OperationalDomain[],
    private readonly behavior: SimulatedProviderBehavior = { dispatch: 'accepted', readBack: 'confirmed' },
  ) {}

  async dispatch(intent: EffectIntent): Promise<ProviderReceipt> {
    const receipt: ProviderReceipt = {
      receiptId: randomUUID(),
      intentId: intent.id,
      provider: this.provider,
      providerReference: `${this.provider}:${intent.id}`,
      acceptedAt: new Date().toISOString(),
      result: this.behavior.dispatch,
      ...(this.behavior.dispatch === 'rejected' ? { message: 'Provider rejected request in contract test.' } : {}),
    };
    this.receipts.set(intent.id, receipt);
    return receipt;
  }

  async readBack(intent: EffectIntent): Promise<ReconciliationResult> {
    const receipt = this.receipts.get(intent.id);
    return {
      intentId: intent.id,
      reconciledAt: new Date().toISOString(),
      result: this.behavior.readBack,
      ...(receipt ? { providerReference: receipt.providerReference } : {}),
      observedState: { action: intent.action, payloadDigest: intent.payloadDigest },
    };
  }
}
