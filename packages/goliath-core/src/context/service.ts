import { randomUUID } from 'node:crypto';
import { GoliathError } from '../core/errors.js';
import { SqlContextRepository } from './repository.js';
import type {
  ActingContext,
  OrganisationRecord,
  OrganisationUnitRecord,
  PortfolioRecord,
  ProgramRecord,
  ProjectContextRecord,
  ResponsibilityAssignment,
  ResponsibilityPermission,
  ResponsibilityRole,
  ResponsibilityScopeType,
  UserDirectoryEntry,
} from './types.js';

const ROLE_SCOPES: Readonly<Record<ResponsibilityRole, readonly ResponsibilityScopeType[]>> = {
  sponsor: ['project'],
  'portfolio-manager': ['portfolio'],
  'program-manager': ['program'],
  'project-director': ['program', 'project'],
  'project-manager': ['project'],
  pmo: ['organisation', 'portfolio', 'program', 'project'],
  'resource-manager': ['organisation', 'org-unit'],
  'delivery-lead': ['project'],
  'agile-delivery-lead': ['project'],
  'team-member': ['project'],
  'enterprise-admin': ['organisation'],
};

const ROLE_PERMISSIONS: Readonly<Record<ResponsibilityRole, readonly ResponsibilityPermission[]>> = {
  sponsor: ['project:view-summary','money:view-summary','decision:approve'],
  'portfolio-manager': ['portfolio:view','program:view','project:view-summary','resource:view-summary','money:view-summary','decision:prepare'],
  'program-manager': ['program:view','project:view-full','resource:view-summary','money:view-project','decision:prepare'],
  'project-director': ['project:view-full','project:manage','project:assign','resource:view-summary','money:view-commercial','decision:prepare','decision:approve'],
  'project-manager': ['project:view-full','project:manage','project:assign','resource:view-summary','money:view-project','decision:prepare'],
  pmo: ['organisation:view','portfolio:view','program:view','project:view-full','governance:view','governance:manage'],
  'resource-manager': ['organisation:view','resource:view-functional','resource:allocate'],
  'delivery-lead': ['project:view-full','team:coordinate','team:assign','handoff:respond','resource:view-summary','decision:prepare'],
  'agile-delivery-lead': ['project:view-full','team:coordinate','handoff:respond','resource:view-summary'],
  'team-member': ['project:view-summary','work:update-own','handoff:respond'],
  'enterprise-admin': ['organisation:view','context:admin'],
};

function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
function isCurrent(assignment: ResponsibilityAssignment, nowIso: string): boolean {
  return assignment.active && assignment.effectiveFrom <= nowIso && (assignment.effectiveTo === undefined || assignment.effectiveTo >= nowIso);
}

export class EnterpriseContextService {
  constructor(
    public readonly repo: SqlContextRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: () => string = () => randomUUID(),
  ) {}

  createOrganisation(input: Omit<OrganisationRecord, 'createdAt' | 'revision'>, actorId: string): OrganisationRecord {
    const record: OrganisationRecord = { ...input, createdAt: this.now().toISOString(), revision: 1 };
    this.repo.transaction(() => {
      this.repo.insertOrganisation(record);
      this.audit(actorId, 'hierarchy.organisation-created', 'organisation', record.id, 'recorded', 'Organisation created.', { code: record.code });
    });
    return record;
  }

  createPortfolio(input: Omit<PortfolioRecord, 'createdAt' | 'revision'>, actorId: string): PortfolioRecord {
    if (!this.repo.getOrganisation(input.organisationId)?.active) throw new GoliathError('ACTION_NOT_ALLOWED', 'Active organisation is required.');
    const record: PortfolioRecord = { ...input, createdAt: this.now().toISOString(), revision: 1 };
    this.repo.transaction(() => {
      this.repo.insertPortfolio(record);
      this.audit(actorId, 'hierarchy.portfolio-created', 'portfolio', record.id, 'recorded', 'Portfolio created.', { organisationId: record.organisationId });
    });
    return record;
  }

  createProgram(input: Omit<ProgramRecord, 'createdAt' | 'revision'>, actorId: string): ProgramRecord {
    if (!this.repo.getPortfolio(input.portfolioId)?.active) throw new GoliathError('ACTION_NOT_ALLOWED', 'Active portfolio is required.');
    const record: ProgramRecord = { ...input, createdAt: this.now().toISOString(), revision: 1 };
    this.repo.transaction(() => {
      this.repo.insertProgram(record);
      this.audit(actorId, 'hierarchy.program-created', 'program', record.id, 'recorded', 'Program created.', { portfolioId: record.portfolioId });
    });
    return record;
  }

  createOrgUnit(input: Omit<OrganisationUnitRecord, 'createdAt' | 'revision'>, actorId: string): OrganisationUnitRecord {
    if (!this.repo.getOrganisation(input.organisationId)?.active) throw new GoliathError('ACTION_NOT_ALLOWED', 'Active organisation is required.');
    if (input.parentUnitId) {
      const parent = this.repo.getOrgUnit(input.parentUnitId);
      if (!parent?.active || parent.organisationId !== input.organisationId) throw new GoliathError('ACTION_NOT_ALLOWED', 'Parent organisational unit must belong to the same organisation.');
    }
    const record: OrganisationUnitRecord = { ...input, createdAt: this.now().toISOString(), revision: 1 };
    this.repo.transaction(() => {
      this.repo.insertOrgUnit(record);
      this.audit(actorId, 'hierarchy.org-unit-created', 'org-unit', record.id, 'recorded', 'Organisational unit created.', { organisationId: record.organisationId });
    });
    return record;
  }

  bindProject(input: Omit<ProjectContextRecord, 'boundAt' | 'revision'>, actorId: string): ProjectContextRecord {
    const projectOrg = this.repo.getProjectOrganisation(input.projectId);
    if (!projectOrg) throw new GoliathError('NOT_FOUND', 'Project not found.');
    if (projectOrg !== input.organisationId) throw new GoliathError('ACTION_NOT_ALLOWED', 'Project organisation does not match the requested enterprise context.');
    if (!this.repo.getOrganisation(input.organisationId)?.active) throw new GoliathError('ACTION_NOT_ALLOWED', 'Active organisation context is required.');

    if (input.programId) {
      const program = this.repo.getProgram(input.programId);
      if (!program?.active) throw new GoliathError('ACTION_NOT_ALLOWED', 'Active program is required.');
      const portfolio = this.repo.getPortfolio(program.portfolioId);
      if (!portfolio?.active || portfolio.organisationId !== input.organisationId) throw new GoliathError('ACTION_NOT_ALLOWED', 'Program does not belong to the project organisation.');
      if (input.portfolioId && input.portfolioId !== program.portfolioId) throw new GoliathError('ACTION_NOT_ALLOWED', 'Program and portfolio do not match.');
      input = { ...input, portfolioId: program.portfolioId };
    } else if (input.portfolioId) {
      const portfolio = this.repo.getPortfolio(input.portfolioId);
      if (!portfolio?.active || portfolio.organisationId !== input.organisationId) throw new GoliathError('ACTION_NOT_ALLOWED', 'Portfolio does not belong to the project organisation.');
    }

    const record: ProjectContextRecord = { ...input, boundAt: this.now().toISOString(), revision: 1 };
    this.repo.transaction(() => {
      this.repo.insertProjectContext(record);
      this.audit(actorId, 'hierarchy.project-bound', 'project', record.projectId, 'recorded', 'Project bound to enterprise hierarchy.', { portfolioId: record.portfolioId ?? null, programId: record.programId ?? null });
    });
    return record;
  }

  grantResponsibility(input: Omit<ResponsibilityAssignment, 'active' | 'grantedAt' | 'grantedBy' | 'revision' | 'revokedBy' | 'revokedAt' | 'revocationReason'>, actorId: string): ResponsibilityAssignment {
    if (!ROLE_SCOPES[input.role].includes(input.scopeType)) throw new GoliathError('ACTION_NOT_ALLOWED', `${input.role} cannot be assigned at ${input.scopeType} scope.`);
    if (!this.repo.scopeExists(input.scopeType, input.scopeId)) throw new GoliathError('NOT_FOUND', 'Responsibility scope does not exist or is inactive.');
    if ((input.role === 'delivery-lead' || input.role === 'agile-delivery-lead' || input.role === 'team-member') && !input.teamId) {
      throw new GoliathError('INVALID_INPUT', `${input.role} requires a teamId within project scope.`);
    }
    const grantedAt = this.now().toISOString();
    const record: ResponsibilityAssignment = { ...input, active: true, grantedBy: actorId, grantedAt, revision: 1 };
    this.repo.transaction(() => {
      this.repo.insertAssignment(record);
      this.audit(actorId, 'responsibility.granted', record.scopeType, record.scopeId, 'allowed', 'Contextual responsibility granted.', { assignmentId: record.id, userId: record.userId, role: record.role }, record.id);
    });
    return record;
  }

  revokeResponsibility(assignmentId: string, actorId: string, reason: string): ResponsibilityAssignment {
    if (!reason.trim()) throw new GoliathError('INVALID_INPUT', 'Revocation reason is required.');
    const current = this.repo.getAssignment(assignmentId);
    if (!current) throw new GoliathError('NOT_FOUND', 'Responsibility assignment not found.');
    if (!current.active) return current;
    return this.repo.transaction(() => {
      const revoked = this.repo.revokeAssignment(assignmentId, actorId, this.now().toISOString(), reason.trim());
      this.audit(actorId, 'responsibility.revoked', revoked.scopeType, revoked.scopeId, 'allowed', reason.trim(), { assignmentId, userId: revoked.userId, role: revoked.role }, assignmentId);
      return revoked;
    });
  }

  listActingContexts(userId: string): readonly ActingContext[] {
    const nowIso = this.now().toISOString();
    return this.repo.listAssignmentsForUser(userId).filter((a) => isCurrent(a, nowIso)).map((a) => this.resolveAssignment(a));
  }

  listUserDirectory(userId: string, assignmentId: string): readonly UserDirectoryEntry[] {
    const admin = this.resolveActingContext(userId, assignmentId);
    if (admin.role !== 'enterprise-admin' || !admin.permissions.includes('context:admin')) {
      throw new GoliathError('ACCESS_DENIED', 'Enterprise administrator context is required.');
    }
    const allowedOrganisations = new Set(admin.accessibleOrganisationIds);
    const nowIso = this.now().toISOString();
    const entries = new Map<string, { userId:string; displayName:string; active:boolean; responsibilities:any[]; projectIds:Set<string>; teamIds:Set<string> }>();
    const ensure = (userIdValue:string, displayName:string) => {
      let entry = entries.get(userIdValue);
      if (!entry) {
        entry = { userId:userIdValue, displayName, active:false, responsibilities:[], projectIds:new Set(), teamIds:new Set() };
        entries.set(userIdValue, entry);
      } else if ((!entry.displayName || entry.displayName===entry.userId) && displayName) entry.displayName=displayName;
      return entry;
    };

    for (const organisationId of admin.accessibleOrganisationIds) {
      for (const member of this.repo.listProjectMembersByOrganisation(organisationId)) {
        const entry=ensure(member.userId,member.displayName);
        entry.active ||= member.active;
        entry.projectIds.add(member.projectId);
        if (member.teamId) entry.teamIds.add(member.teamId);
      }
    }

    for (const assignment of this.repo.listAssignments()) {
      const organisationId=this.organisationForScope(assignment.scopeType,assignment.scopeId);
      if (!organisationId || !allowedOrganisations.has(organisationId)) continue;
      const entry=ensure(assignment.userId,assignment.displayName);
      const current=isCurrent(assignment,nowIso);
      entry.active ||= current;
      const resolved=this.resolveAssignment(assignment);
      entry.responsibilities.push({
        assignmentId:assignment.id, role:assignment.role, scopeType:assignment.scopeType, scopeId:assignment.scopeId, scopeLabel:resolved.scopeLabel,
        ...(assignment.teamId?{teamId:assignment.teamId}:{}), active:current, effectiveFrom:assignment.effectiveFrom, ...(assignment.effectiveTo?{effectiveTo:assignment.effectiveTo}:{}),
      });
    }

    return [...entries.values()].map((entry)=>({
      userId:entry.userId, displayName:entry.displayName, active:entry.active, responsibilities:entry.responsibilities,
      projectIds:[...entry.projectIds].sort(), teamIds:[...entry.teamIds].sort(),
    })).sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.userId.localeCompare(b.userId));
  }

  resolveActingContext(userId: string, assignmentId: string): ActingContext {
    const assignment = this.repo.getAssignment(assignmentId);
    if (!assignment || assignment.userId !== userId) throw new GoliathError('ACCESS_DENIED', 'Responsibility context is unavailable.');
    if (!isCurrent(assignment, this.now().toISOString())) throw new GoliathError('ACCESS_DENIED', 'Responsibility context is inactive or outside its effective period.');
    return this.resolveAssignment(assignment);
  }

  canAccessProject(context: ActingContext, projectId: string): boolean {
    return context.accessibleProjectIds.includes(projectId);
  }

  hasPermission(context: ActingContext, permission: ResponsibilityPermission): boolean {
    return context.permissions.includes(permission);
  }

  /**
   * Backend authorization gate for project-scoped queries/commands.
   * The selected acting context is evaluated on its own; holding another role elsewhere does not widen it.
   */
  authorizeProject(
    userId: string,
    assignmentId: string,
    projectId: string,
    permission: ResponsibilityPermission,
  ): ActingContext {
    const context = this.resolveActingContext(userId, assignmentId);
    if (!context.accessibleProjectIds.includes(projectId)) {
      this.audit(userId, 'context.project-access-denied', 'project', projectId, 'denied', 'Selected responsibility context does not include this project.', { assignmentId, role: context.role, requiredPermission: permission }, assignmentId);
      throw new GoliathError('ACCESS_DENIED', 'Project is outside the selected responsibility context.');
    }
    if (!context.permissions.includes(permission)) {
      this.audit(userId, 'context.project-action-denied', 'project', projectId, 'denied', 'Selected responsibility context does not permit this action.', { assignmentId, role: context.role, requiredPermission: permission }, assignmentId);
      throw new GoliathError('ACCESS_DENIED', 'Action is not permitted in the selected responsibility context.');
    }
    return context;
  }

  private resolveAssignment(assignment: ResponsibilityAssignment): ActingContext {
    const permissions = unique([...ROLE_PERMISSIONS[assignment.role], ...assignment.permissions]);
    let organisationIds: string[] = [];
    let portfolioIds: string[] = [];
    let programIds: string[] = [];
    let projectIds: string[] = [];
    let orgUnitIds: string[] = [];
    let scopeLabel = assignment.scopeId;

    switch (assignment.scopeType) {
      case 'organisation': {
        const org = this.repo.getOrganisation(assignment.scopeId)!;
        scopeLabel = org.name;
        organisationIds = [org.id];
        if (assignment.role !== 'resource-manager' && assignment.role !== 'enterprise-admin') {
          portfolioIds = this.repo.listPortfolios(org.id).map((p) => p.id);
          programIds = portfolioIds.flatMap((id) => this.repo.listPrograms(id).map((p) => p.id));
          projectIds = this.repo.listProjectContextsByOrganisation(org.id).map((p) => p.projectId);
        }
        if (assignment.role === 'resource-manager') orgUnitIds = this.descendantOrgUnitsForOrganisation(org.id);
        break;
      }
      case 'portfolio': {
        const portfolio = this.repo.getPortfolio(assignment.scopeId)!;
        const org = this.repo.getOrganisation(portfolio.organisationId)!;
        scopeLabel = portfolio.name;
        organisationIds = [org.id]; portfolioIds = [portfolio.id];
        programIds = this.repo.listPrograms(portfolio.id).map((p) => p.id);
        projectIds = this.repo.listProjectContextsByPortfolio(portfolio.id).map((p) => p.projectId);
        break;
      }
      case 'program': {
        const program = this.repo.getProgram(assignment.scopeId)!;
        const portfolio = this.repo.getPortfolio(program.portfolioId)!;
        scopeLabel = program.name;
        organisationIds = [portfolio.organisationId]; portfolioIds = [portfolio.id]; programIds = [program.id];
        projectIds = this.repo.listProjectContextsByProgram(program.id).map((p) => p.projectId);
        break;
      }
      case 'project': {
        const context = this.repo.getProjectContext(assignment.scopeId);
        const projectOrg = this.repo.getProjectOrganisation(assignment.scopeId)!;
        scopeLabel = String(this.repo.db.prepare('SELECT name FROM pc_projects WHERE id=?').get(assignment.scopeId)?.name ?? assignment.scopeId);
        organisationIds = [projectOrg]; projectIds = [assignment.scopeId];
        if (context?.portfolioId) portfolioIds = [context.portfolioId];
        if (context?.programId) programIds = [context.programId];
        break;
      }
      case 'org-unit': {
        const unit = this.repo.getOrgUnit(assignment.scopeId)!;
        scopeLabel = unit.name;
        organisationIds = [unit.organisationId]; orgUnitIds = this.descendantOrgUnits(unit.id);
        break;
      }
    }

    return {
      assignmentId: assignment.id, userId: assignment.userId, displayName: assignment.displayName, role: assignment.role,
      scopeType: assignment.scopeType, scopeId: assignment.scopeId, scopeLabel,
      ...(assignment.teamId ? { teamId: assignment.teamId } : {}), permissions,
      accessibleOrganisationIds: unique(organisationIds), accessiblePortfolioIds: unique(portfolioIds), accessibleProgramIds: unique(programIds),
      accessibleProjectIds: unique(projectIds), functionalOrgUnitIds: unique(orgUnitIds),
    };
  }

  /** Append a domain event to the same contextual audit chain used for grants/denials. */
  recordDomainEvent(
    actorId: string,
    eventType: string,
    scopeType: ResponsibilityScopeType,
    scopeId: string,
    result: 'allowed' | 'denied' | 'recorded',
    reason: string,
    metadata: Readonly<Record<string, unknown>> = {},
    assignmentId?: string,
  ): void {
    if (!this.repo.scopeExists(scopeType, scopeId)) throw new GoliathError('NOT_FOUND', 'Audit scope does not exist.');
    this.audit(actorId, eventType, scopeType, scopeId, result, reason, metadata, assignmentId);
  }

  private organisationForScope(scopeType: ResponsibilityScopeType, scopeId: string): string | undefined {
    switch (scopeType) {
      case 'organisation': return this.repo.getOrganisation(scopeId)?.id;
      case 'portfolio': return this.repo.getPortfolio(scopeId)?.organisationId;
      case 'program': { const program=this.repo.getProgram(scopeId); return program ? this.repo.getPortfolio(program.portfolioId)?.organisationId : undefined; }
      case 'project': return this.repo.getProjectOrganisation(scopeId);
      case 'org-unit': return this.repo.getOrgUnit(scopeId)?.organisationId;
    }
  }

  private descendantOrgUnitsForOrganisation(organisationId: string): string[] {
    const roots = this.repo.db.prepare('SELECT id FROM ec_org_units WHERE organisation_id=? AND parent_unit_id IS NULL AND active=1').all(organisationId).map((r) => String(r.id));
    return roots.flatMap((id) => this.descendantOrgUnits(id));
  }

  private descendantOrgUnits(rootId: string): string[] {
    const result = [rootId];
    const queue = [rootId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of this.repo.listChildOrgUnits(current)) { result.push(child.id); queue.push(child.id); }
    }
    return result;
  }

  private audit(actorId: string, eventType: string, scopeType: ResponsibilityScopeType, scopeId: string, result: 'allowed' | 'denied' | 'recorded', reason: string, metadata: Readonly<Record<string, unknown>>, assignmentId?: string): void {
    const occurredAt = this.now().toISOString();
    this.repo.appendEvent({
      id: this.idFactory(), actorId, eventType, ...(assignmentId ? { assignmentId } : {}), scopeType, scopeId, result, reason,
      occurredAt, correlationId: this.idFactory(), metadata,
    });
  }
}

export function defaultResponsibilityPermissions(role: ResponsibilityRole): readonly ResponsibilityPermission[] {
  return ROLE_PERMISSIONS[role];
}

export function allowedResponsibilityScopes(role: ResponsibilityRole): readonly ResponsibilityScopeType[] {
  return ROLE_SCOPES[role];
}
