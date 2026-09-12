export type ResponsibilityRole =
  | 'sponsor'
  | 'portfolio-manager'
  | 'program-manager'
  | 'project-director'
  | 'project-manager'
  | 'pmo'
  | 'resource-manager'
  | 'delivery-lead'
  | 'agile-delivery-lead'
  | 'team-member'
  | 'enterprise-admin';

export type ResponsibilityScopeType = 'organisation' | 'portfolio' | 'program' | 'project' | 'org-unit';

export type ResponsibilityPermission =
  | 'organisation:view'
  | 'portfolio:view'
  | 'program:view'
  | 'project:view-summary'
  | 'project:view-full'
  | 'project:manage'
  | 'project:assign'
  | 'team:coordinate'
  | 'team:assign'
  | 'work:update-own'
  | 'handoff:respond'
  | 'resource:view-summary'
  | 'resource:view-functional'
  | 'resource:allocate'
  | 'money:view-summary'
  | 'money:view-project'
  | 'money:view-commercial'
  | 'decision:prepare'
  | 'decision:approve'
  | 'governance:view'
  | 'governance:manage'
  | 'context:admin';

export interface OrganisationRecord {
  id: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  revision: number;
}

export interface PortfolioRecord {
  id: string;
  organisationId: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  revision: number;
}

export interface ProgramRecord {
  id: string;
  portfolioId: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  revision: number;
}

export interface OrganisationUnitRecord {
  id: string;
  organisationId: string;
  parentUnitId?: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  revision: number;
}

export interface ProjectContextRecord {
  projectId: string;
  organisationId: string;
  portfolioId?: string;
  programId?: string;
  boundAt: string;
  boundBy: string;
  revision: number;
}

export interface ResponsibilityAssignment {
  id: string;
  userId: string;
  displayName: string;
  role: ResponsibilityRole;
  scopeType: ResponsibilityScopeType;
  scopeId: string;
  teamId?: string;
  active: boolean;
  permissions: readonly ResponsibilityPermission[];
  effectiveFrom: string;
  effectiveTo?: string;
  grantedBy: string;
  grantedAt: string;
  revokedBy?: string;
  revokedAt?: string;
  revocationReason?: string;
  revision: number;
}

export interface UserDirectoryResponsibility {
  assignmentId: string;
  role: ResponsibilityRole;
  scopeType: ResponsibilityScopeType;
  scopeId: string;
  scopeLabel: string;
  teamId?: string;
  active: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface UserDirectoryEntry {
  userId: string;
  displayName: string;
  active: boolean;
  responsibilities: readonly UserDirectoryResponsibility[];
  projectIds: readonly string[];
  teamIds: readonly string[];
}

export interface ContextAuditEvent {
  id: string;
  actorId: string;
  eventType: string;
  assignmentId?: string;
  scopeType: ResponsibilityScopeType;
  scopeId: string;
  result: 'allowed' | 'denied' | 'recorded';
  reason: string;
  occurredAt: string;
  correlationId: string;
  metadata: Readonly<Record<string, unknown>>;
  previousHash?: string;
  eventHash: string;
}

export interface ActingContext {
  assignmentId: string;
  userId: string;
  displayName: string;
  role: ResponsibilityRole;
  scopeType: ResponsibilityScopeType;
  scopeId: string;
  scopeLabel: string;
  teamId?: string;
  permissions: readonly ResponsibilityPermission[];
  accessibleOrganisationIds: readonly string[];
  accessiblePortfolioIds: readonly string[];
  accessibleProgramIds: readonly string[];
  accessibleProjectIds: readonly string[];
  functionalOrgUnitIds: readonly string[];
}
