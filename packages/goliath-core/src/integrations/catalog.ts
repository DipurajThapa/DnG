import { GoliathError } from '../core/errors.js';
import type { OperationalDomain } from '../core/types.js';

export interface DomainContract {
  domain: OperationalDomain;
  inboundFields: readonly string[];
  outboundActions: readonly string[];
  requiredOutboundApproval: readonly string[];
  sensitiveFields: readonly string[];
  decisionImpact: string;
}

export const B14_DOMAIN_CONTRACTS: Readonly<Record<string, DomainContract>> = {
  crm: {
    domain: 'crm',
    inboundFields: ['accountId', 'opportunityId', 'orderId', 'handoverState', 'committedDate', 'commercialCommitment'],
    outboundActions: ['publishDeliverySummary', 'publishChangeImpact'],
    requiredOutboundApproval: ['publishChangeImpact'],
    sensitiveFields: ['contactPrivateNotes'],
    decisionImpact: 'Commercial commitments become governed delivery inputs without duplicating CRM ownership.',
  },
  recruitment: {
    domain: 'recruitment',
    inboundFields: ['requisitionId', 'stage', 'targetStartDate', 'confirmedStartDate', 'roleCode'],
    outboundActions: ['requestStaffingRequisition'],
    requiredOutboundApproval: ['requestStaffingRequisition'],
    sensitiveFields: ['cv', 'interviewNotes', 'candidateCompensation'],
    decisionImpact: 'Hiring progress affects project capacity/readiness while candidate-private content stays outside GOLIATH.',
  },
  procurement: {
    domain: 'procurement',
    inboundFields: ['requisitionId', 'poId', 'poLineId', 'status', 'currency', 'committedAmount', 'receivedAmount'],
    outboundActions: ['requestRequisition', 'requestChange', 'requestCancel'],
    requiredOutboundApproval: ['requestRequisition', 'requestChange', 'requestCancel'],
    sensitiveFields: ['bankDetails'],
    decisionImpact: 'PO commitments and receipts feed cost/readiness without allowing PMs to create financial commitments directly.',
  },
  contract: {
    domain: 'contract',
    inboundFields: ['contractId', 'version', 'status', 'effectiveFrom', 'effectiveTo', 'obligationId', 'obligationDueDate'],
    outboundActions: ['requestVariation', 'requestRenewal'],
    requiredOutboundApproval: ['requestVariation', 'requestRenewal'],
    sensitiveFields: ['confidentialTerms'],
    decisionImpact: 'Contract expiry and obligations are linked to delivery decisions with restricted commercial visibility.',
  },
  billing: {
    domain: 'billing',
    inboundFields: ['invoiceId', 'creditId', 'paymentId', 'status', 'currency', 'amount', 'servicePeriod'],
    outboundActions: ['requestMilestoneBilling'],
    requiredOutboundApproval: ['requestMilestoneBilling'],
    sensitiveFields: ['paymentInstrument'],
    decisionImpact: 'Accepted milestones can request billing while invoice/payment/revenue remain finance-owned facts.',
  },
  cicd: {
    domain: 'cicd',
    inboundFields: ['repositoryId', 'commitSha', 'buildId', 'artifactDigest', 'environment', 'deploymentId', 'deploymentState'],
    outboundActions: ['requestRelease'],
    requiredOutboundApproval: ['requestRelease'],
    sensitiveFields: ['secret', 'token'],
    decisionImpact: 'Immutable build/deployment evidence informs release readiness without equating pipeline success with acceptance.',
  },
  qa: {
    domain: 'qa',
    inboundFields: ['testRunId', 'buildId', 'environment', 'coverage', 'passed', 'failed', 'defectId', 'defectState'],
    outboundActions: ['requestTestRun', 'createDefect'],
    requiredOutboundApproval: [],
    sensitiveFields: [],
    decisionImpact: 'Test outcomes and defects link to acceptance criteria and release readiness.',
  },
  documents: {
    domain: 'documents',
    inboundFields: ['documentId', 'version', 'hash', 'classification', 'signatureState', 'signedArtifactId'],
    outboundActions: ['requestDocumentCreation', 'requestReview'],
    requiredOutboundApproval: ['requestDocumentCreation'],
    sensitiveFields: ['documentBody'],
    decisionImpact: 'Exact version/hash and signature metadata become evidence while the DMS retains content/version authority.',
  },
  itsm: {
    domain: 'itsm',
    inboundFields: ['ticketId', 'serviceId', 'environment', 'type', 'severity', 'state', 'startedAt', 'resolvedAt'],
    outboundActions: ['requestIncident', 'requestServiceChange'],
    requiredOutboundApproval: ['requestServiceChange'],
    sensitiveFields: ['restrictedDiagnostic'],
    decisionImpact: 'One service incident/change can affect multiple project items without creating duplicate tickets.',
  },
};

export function getDomainContract(domain: OperationalDomain): DomainContract {
  const contract = B14_DOMAIN_CONTRACTS[domain];
  if (!contract) throw new GoliathError('NOT_FOUND', `No B14 operational contract registered for ${domain}.`);
  return contract;
}
