export interface ReadinessInput {
  projectId: string;
  pmAssigned: boolean;
  baselineAccepted: boolean;
  executableWorkReady: boolean;
  materialCommitmentsDefined: boolean;
  requiredTeamLeadsAssigned: boolean;
  legitimateEvidenceSourceAvailable: boolean;
}

export interface ReadinessGap { code: string; message: string; ownerType: 'pm' | 'organisation-admin' | 'team-lead'; action: string; }
export interface ReadinessResult { ready: boolean; gaps: readonly ReadinessGap[]; }

export function evaluateMinimumReadiness(input: ReadinessInput): ReadinessResult {
  const gaps: ReadinessGap[] = [];
  if (!input.pmAssigned) gaps.push({ code: 'PM_MISSING', message: 'A Project Manager is required.', ownerType: 'organisation-admin', action: 'Assign Project Manager' });
  if (!input.baselineAccepted) gaps.push({ code: 'BASELINE_MISSING', message: 'The initial governed baseline has not been accepted.', ownerType: 'pm', action: 'Review baseline' });
  if (!input.executableWorkReady) gaps.push({ code: 'NO_EXECUTABLE_WORK', message: 'No work is currently ready to start.', ownerType: 'pm', action: 'Resolve first start dependency' });
  if (!input.materialCommitmentsDefined) gaps.push({ code: 'COMMITMENTS_MISSING', message: 'Material project outcomes are not yet defined.', ownerType: 'pm', action: 'Confirm material outcomes' });
  if (!input.requiredTeamLeadsAssigned) gaps.push({ code: 'LEAD_MISSING', message: 'A required delivery team has no accountable lead.', ownerType: 'pm', action: 'Assign team lead' });
  if (!input.legitimateEvidenceSourceAvailable) gaps.push({ code: 'SOURCE_MISSING', message: 'No legitimate evidence source is available yet.', ownerType: 'organisation-admin', action: 'Connect or register one source' });
  return { ready: gaps.length === 0, gaps };
}
