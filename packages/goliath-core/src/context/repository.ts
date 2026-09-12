import type { SyncSqlDatabase } from '../persistence/sync-database.js';
import { digest } from '../core/hash.js';
import { GoliathError } from '../core/errors.js';
import type {
  ContextAuditEvent,
  OrganisationRecord,
  OrganisationUnitRecord,
  PortfolioRecord,
  ProgramRecord,
  ProjectContextRecord,
  ResponsibilityAssignment,
  ResponsibilityScopeType,
} from './types.js';

function bool(value: unknown): boolean { return Number(value) === 1; }
function optional<T>(value: T | null | undefined): T | undefined { return value === null || value === undefined ? undefined : value; }
function parseArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []; }
  catch { return []; }
}
function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
}

function eventPayload(event: Omit<ContextAuditEvent, 'eventHash' | 'previousHash'>, previousHash: string | undefined): Record<string, unknown> {
  return {
    id: event.id, actorId: event.actorId, eventType: event.eventType, assignmentId: event.assignmentId ?? null,
    scopeType: event.scopeType, scopeId: event.scopeId, result: event.result, reason: event.reason,
    occurredAt: event.occurredAt, correlationId: event.correlationId, metadata: event.metadata,
    previousHash: previousHash ?? null,
  };
}

export class SqlContextRepository {
  constructor(public readonly db: SyncSqlDatabase) {}

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  insertOrganisation(record: OrganisationRecord): void {
    this.db.prepare('INSERT INTO ec_organisations(id,code,name,active,created_at,revision) VALUES(?,?,?,?,?,?)')
      .run(record.id, record.code, record.name, record.active ? 1 : 0, record.createdAt, record.revision);
  }
  getOrganisation(id: string): OrganisationRecord | undefined {
    const r = this.db.prepare('SELECT * FROM ec_organisations WHERE id=?').get(id);
    return r ? { id:String(r.id), code:String(r.code), name:String(r.name), active:bool(r.active), createdAt:String(r.created_at), revision:Number(r.revision) } : undefined;
  }

  insertPortfolio(record: PortfolioRecord): void {
    this.db.prepare('INSERT INTO ec_portfolios(id,organisation_id,code,name,active,created_at,revision) VALUES(?,?,?,?,?,?,?)')
      .run(record.id, record.organisationId, record.code, record.name, record.active ? 1 : 0, record.createdAt, record.revision);
  }
  getPortfolio(id: string): PortfolioRecord | undefined {
    const r = this.db.prepare('SELECT * FROM ec_portfolios WHERE id=?').get(id);
    return r ? { id:String(r.id), organisationId:String(r.organisation_id), code:String(r.code), name:String(r.name), active:bool(r.active), createdAt:String(r.created_at), revision:Number(r.revision) } : undefined;
  }
  listPortfolios(organisationId: string): readonly PortfolioRecord[] {
    return this.db.prepare('SELECT * FROM ec_portfolios WHERE organisation_id=? AND active=1 ORDER BY name').all(organisationId).map((r) => ({
      id:String(r.id), organisationId:String(r.organisation_id), code:String(r.code), name:String(r.name), active:bool(r.active), createdAt:String(r.created_at), revision:Number(r.revision),
    }));
  }

  insertProgram(record: ProgramRecord): void {
    this.db.prepare('INSERT INTO ec_programs(id,portfolio_id,code,name,active,created_at,revision) VALUES(?,?,?,?,?,?,?)')
      .run(record.id, record.portfolioId, record.code, record.name, record.active ? 1 : 0, record.createdAt, record.revision);
  }
  getProgram(id: string): ProgramRecord | undefined {
    const r = this.db.prepare('SELECT * FROM ec_programs WHERE id=?').get(id);
    return r ? { id:String(r.id), portfolioId:String(r.portfolio_id), code:String(r.code), name:String(r.name), active:bool(r.active), createdAt:String(r.created_at), revision:Number(r.revision) } : undefined;
  }
  listPrograms(portfolioId: string): readonly ProgramRecord[] {
    return this.db.prepare('SELECT * FROM ec_programs WHERE portfolio_id=? AND active=1 ORDER BY name').all(portfolioId).map((r) => ({
      id:String(r.id), portfolioId:String(r.portfolio_id), code:String(r.code), name:String(r.name), active:bool(r.active), createdAt:String(r.created_at), revision:Number(r.revision),
    }));
  }

  insertOrgUnit(record: OrganisationUnitRecord): void {
    this.db.prepare('INSERT INTO ec_org_units(id,organisation_id,parent_unit_id,code,name,active,created_at,revision) VALUES(?,?,?,?,?,?,?,?)')
      .run(record.id, record.organisationId, record.parentUnitId ?? null, record.code, record.name, record.active ? 1 : 0, record.createdAt, record.revision);
  }
  getOrgUnit(id: string): OrganisationUnitRecord | undefined {
    const r = this.db.prepare('SELECT * FROM ec_org_units WHERE id=?').get(id);
    return r ? { id:String(r.id), organisationId:String(r.organisation_id), ...(optional(r.parent_unit_id)?{parentUnitId:String(r.parent_unit_id)}:{}), code:String(r.code), name:String(r.name), active:bool(r.active), createdAt:String(r.created_at), revision:Number(r.revision) } : undefined;
  }
  listChildOrgUnits(parentUnitId: string): readonly OrganisationUnitRecord[] {
    return this.db.prepare('SELECT * FROM ec_org_units WHERE parent_unit_id=? AND active=1 ORDER BY name').all(parentUnitId).map((r) => ({
      id:String(r.id), organisationId:String(r.organisation_id), ...(optional(r.parent_unit_id)?{parentUnitId:String(r.parent_unit_id)}:{}), code:String(r.code), name:String(r.name), active:bool(r.active), createdAt:String(r.created_at), revision:Number(r.revision),
    }));
  }

  insertProjectContext(record: ProjectContextRecord): void {
    this.db.prepare('INSERT INTO ec_project_context(project_id,organisation_id,portfolio_id,program_id,bound_at,bound_by,revision) VALUES(?,?,?,?,?,?,?)')
      .run(record.projectId, record.organisationId, record.portfolioId ?? null, record.programId ?? null, record.boundAt, record.boundBy, record.revision);
  }
  getProjectContext(projectId: string): ProjectContextRecord | undefined {
    const r = this.db.prepare('SELECT * FROM ec_project_context WHERE project_id=?').get(projectId);
    return r ? { projectId:String(r.project_id), organisationId:String(r.organisation_id), ...(optional(r.portfolio_id)?{portfolioId:String(r.portfolio_id)}:{}), ...(optional(r.program_id)?{programId:String(r.program_id)}:{}), boundAt:String(r.bound_at), boundBy:String(r.bound_by), revision:Number(r.revision) } : undefined;
  }
  listProjectContextsByOrganisation(organisationId: string): readonly ProjectContextRecord[] { return this.mapProjectContexts(this.db.prepare('SELECT * FROM ec_project_context WHERE organisation_id=? ORDER BY project_id').all(organisationId)); }
  listProjectContextsByPortfolio(portfolioId: string): readonly ProjectContextRecord[] { return this.mapProjectContexts(this.db.prepare('SELECT * FROM ec_project_context WHERE portfolio_id=? ORDER BY project_id').all(portfolioId)); }
  listProjectContextsByProgram(programId: string): readonly ProjectContextRecord[] { return this.mapProjectContexts(this.db.prepare('SELECT * FROM ec_project_context WHERE program_id=? ORDER BY project_id').all(programId)); }

  getProjectOrganisation(projectId: string): string | undefined {
    const r = this.db.prepare('SELECT organisation_id FROM pc_projects WHERE id=?').get(projectId);
    return r ? String(r.organisation_id) : undefined;
  }

  insertAssignment(record: ResponsibilityAssignment): void {
    this.db.prepare(`INSERT INTO ec_responsibility_assignments(
      id,user_id,display_name,role,scope_type,scope_id,team_id,active,permissions_json,effective_from,effective_to,
      granted_by,granted_at,revoked_by,revoked_at,revocation_reason,revision
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      record.id, record.userId, record.displayName, record.role, record.scopeType, record.scopeId, record.teamId ?? null,
      record.active ? 1 : 0, JSON.stringify(record.permissions), record.effectiveFrom, record.effectiveTo ?? null,
      record.grantedBy, record.grantedAt, record.revokedBy ?? null, record.revokedAt ?? null, record.revocationReason ?? null, record.revision,
    );
  }
  getAssignment(id: string): ResponsibilityAssignment | undefined {
    const r = this.db.prepare('SELECT * FROM ec_responsibility_assignments WHERE id=?').get(id);
    return r ? this.mapAssignment(r) : undefined;
  }
  listAssignmentsForUser(userId: string): readonly ResponsibilityAssignment[] {
    return this.db.prepare('SELECT * FROM ec_responsibility_assignments WHERE user_id=? ORDER BY granted_at,id').all(userId).map((r) => this.mapAssignment(r));
  }
  listAssignments(): readonly ResponsibilityAssignment[] {
    return this.db.prepare('SELECT * FROM ec_responsibility_assignments ORDER BY display_name,user_id,granted_at,id').all().map((r) => this.mapAssignment(r));
  }
  listProjectMembersByOrganisation(organisationId: string): readonly { projectId:string; userId:string; displayName:string; role:string; teamId?:string; active:boolean }[] {
    return this.db.prepare(`SELECT m.project_id,m.user_id,m.display_name,m.role,m.team_id,m.active
      FROM pc_project_members m JOIN pc_projects p ON p.id=m.project_id
      WHERE p.organisation_id=? ORDER BY m.display_name,m.user_id,m.project_id`).all(organisationId).map((r) => ({
      projectId:String(r.project_id), userId:String(r.user_id), displayName:String(r.display_name), role:String(r.role),
      ...(optional(r.team_id)?{teamId:String(r.team_id)}:{}), active:bool(r.active),
    }));
  }
  revokeAssignment(id: string, actorId: string, revokedAt: string, reason: string): ResponsibilityAssignment {
    const current = this.getAssignment(id);
    if (!current) throw new GoliathError('NOT_FOUND', 'Responsibility assignment not found.');
    if (!current.active) return current;
    const result = this.db.prepare(`UPDATE ec_responsibility_assignments SET active=0,revoked_by=?,revoked_at=?,revocation_reason=?,revision=revision+1
      WHERE id=? AND active=1 AND revision=?`).run(actorId, revokedAt, reason, id, current.revision);
    if (Number(result.changes) !== 1) throw new GoliathError('STALE_REVISION', 'Responsibility assignment changed concurrently.');
    return this.getAssignment(id)!;
  }

  appendEvent(event: Omit<ContextAuditEvent, 'eventHash' | 'previousHash'>): ContextAuditEvent {
    const last = this.db.prepare('SELECT event_hash FROM ec_context_events ORDER BY rowid DESC LIMIT 1').get();
    const previousHash = last ? String(last.event_hash) : undefined;
    const eventHash = digest(eventPayload(event, previousHash));
    this.db.prepare(`INSERT INTO ec_context_events(id,actor_id,event_type,assignment_id,scope_type,scope_id,result,reason,occurred_at,correlation_id,metadata_json,previous_hash,event_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      event.id, event.actorId, event.eventType, event.assignmentId ?? null, event.scopeType, event.scopeId, event.result, event.reason,
      event.occurredAt, event.correlationId, JSON.stringify(event.metadata), previousHash ?? null, eventHash,
    );
    return { ...event, ...(previousHash ? { previousHash } : {}), eventHash };
  }
  listEvents(): readonly ContextAuditEvent[] {
    return this.db.prepare('SELECT * FROM ec_context_events ORDER BY rowid').all().map((r) => ({
      id:String(r.id), actorId:String(r.actor_id), eventType:String(r.event_type), ...(optional(r.assignment_id)?{assignmentId:String(r.assignment_id)}:{}),
      scopeType:r.scope_type as ResponsibilityScopeType, scopeId:String(r.scope_id), result:r.result as ContextAuditEvent['result'], reason:String(r.reason),
      occurredAt:String(r.occurred_at), correlationId:String(r.correlation_id), metadata:parseObject(r.metadata_json),
      ...(optional(r.previous_hash)?{previousHash:String(r.previous_hash)}:{}), eventHash:String(r.event_hash),
    }));
  }
  verifyEventChain(): boolean {
    let previousHash: string | undefined;
    for (const event of this.listEvents()) {
      if ((event.previousHash ?? undefined) !== previousHash) return false;
      const { eventHash, previousHash: _ignored, ...withoutHash } = event;
      if (digest(eventPayload(withoutHash, previousHash)) !== eventHash) return false;
      previousHash = eventHash;
    }
    return true;
  }

  scopeExists(scopeType: ResponsibilityScopeType, scopeId: string): boolean {
    switch (scopeType) {
      case 'organisation': return this.getOrganisation(scopeId)?.active === true;
      case 'portfolio': return this.getPortfolio(scopeId)?.active === true;
      case 'program': return this.getProgram(scopeId)?.active === true;
      case 'project': return this.getProjectOrganisation(scopeId) !== undefined;
      case 'org-unit': return this.getOrgUnit(scopeId)?.active === true;
    }
  }

  private mapProjectContexts(rows: readonly any[]): readonly ProjectContextRecord[] {
    return rows.map((r) => ({ projectId:String(r.project_id), organisationId:String(r.organisation_id), ...(optional(r.portfolio_id)?{portfolioId:String(r.portfolio_id)}:{}), ...(optional(r.program_id)?{programId:String(r.program_id)}:{}), boundAt:String(r.bound_at), boundBy:String(r.bound_by), revision:Number(r.revision) }));
  }
  private mapAssignment(r: any): ResponsibilityAssignment {
    return {
      id:String(r.id), userId:String(r.user_id), displayName:String(r.display_name), role:r.role as ResponsibilityAssignment['role'],
      scopeType:r.scope_type as ResponsibilityAssignment['scopeType'], scopeId:String(r.scope_id), ...(optional(r.team_id)?{teamId:String(r.team_id)}:{}),
      active:bool(r.active), permissions:parseArray(r.permissions_json) as ResponsibilityAssignment['permissions'], effectiveFrom:String(r.effective_from),
      ...(optional(r.effective_to)?{effectiveTo:String(r.effective_to)}:{}), grantedBy:String(r.granted_by), grantedAt:String(r.granted_at),
      ...(optional(r.revoked_by)?{revokedBy:String(r.revoked_by)}:{}), ...(optional(r.revoked_at)?{revokedAt:String(r.revoked_at)}:{}),
      ...(optional(r.revocation_reason)?{revocationReason:String(r.revocation_reason)}:{}), revision:Number(r.revision),
    };
  }
}

/** Backward-compatible local/test name. The implementation is SQL-port based. */
export class SqliteContextRepository extends SqlContextRepository {}
