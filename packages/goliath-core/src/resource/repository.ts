import type { SyncSqlDatabase } from '../persistence/sync-database.js';
import { GoliathError } from '../core/errors.js';
import type { CapacityPeriodRecord, ResourceAllocationRecord, ResourceDemandRecord, ResourceRecord, ResourceWorklogRecord } from './types.js';

function bool(value: unknown): boolean { return Number(value) === 1; }
function optional<T>(value: T | null | undefined): T | undefined { return value === null || value === undefined ? undefined : value; }
function parseArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try { const x = JSON.parse(value) as unknown; return Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []; }
  catch { return []; }
}

export class SqlResourceRepository {
  constructor(public readonly db: SyncSqlDatabase) {}

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  insertResource(r: ResourceRecord): void {
    this.db.prepare(`INSERT INTO rc_resources(id,user_id,display_name,organisation_id,org_unit_id,active,skills_json,weekly_contract_hours,created_at,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(r.id, r.userId ?? null, r.displayName, r.organisationId, r.orgUnitId, r.active ? 1 : 0, JSON.stringify(r.skills), r.weeklyContractHours, r.createdAt, r.revision);
  }
  getResource(id: string): ResourceRecord | undefined {
    const r = this.db.prepare('SELECT * FROM rc_resources WHERE id=?').get(id);
    return r ? this.mapResource(r) : undefined;
  }
  listResourcesByOrgUnits(orgUnitIds: readonly string[]): readonly ResourceRecord[] {
    if (orgUnitIds.length === 0) return [];
    const placeholders = orgUnitIds.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM rc_resources WHERE active=1 AND org_unit_id IN (${placeholders}) ORDER BY display_name`).all(...orgUnitIds).map((r) => this.mapResource(r));
  }
  listResourcesByOrganisation(organisationId: string): readonly ResourceRecord[] {
    return this.db.prepare('SELECT * FROM rc_resources WHERE organisation_id=? AND active=1 ORDER BY display_name').all(organisationId).map((r) => this.mapResource(r));
  }

  upsertCapacity(r: CapacityPeriodRecord): void {
    this.db.prepare(`INSERT INTO rc_capacity_periods(id,resource_id,period_start,period_end,gross_hours,unavailable_hours,source_ref,revision)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(resource_id,period_start,period_end) DO UPDATE SET gross_hours=excluded.gross_hours, unavailable_hours=excluded.unavailable_hours,
      source_ref=excluded.source_ref, revision=rc_capacity_periods.revision+1`).run(r.id, r.resourceId, r.periodStart, r.periodEnd, r.grossHours, r.unavailableHours, r.sourceRef ?? null, r.revision);
  }
  listCapacity(resourceId: string): readonly CapacityPeriodRecord[] {
    return this.db.prepare('SELECT * FROM rc_capacity_periods WHERE resource_id=? ORDER BY period_start').all(resourceId).map((r) => ({
      id:String(r.id), resourceId:String(r.resource_id), periodStart:String(r.period_start), periodEnd:String(r.period_end), grossHours:Number(r.gross_hours), unavailableHours:Number(r.unavailable_hours),
      ...(optional(r.source_ref)?{sourceRef:String(r.source_ref)}:{}), revision:Number(r.revision),
    }));
  }
  getCapacityPeriod(resourceId: string, periodStart: string, periodEnd: string): CapacityPeriodRecord | undefined {
    return this.listCapacity(resourceId).find((p)=>p.periodStart===periodStart && p.periodEnd===periodEnd);
  }

  insertAllocation(r: ResourceAllocationRecord): void {
    this.db.prepare(`INSERT INTO rc_allocations(id,resource_id,project_id,activity_id,team_id,period_start,period_end,hours,status,created_by,created_at,reason,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.id, r.resourceId, r.projectId, r.activityId ?? null, r.teamId ?? null, r.periodStart, r.periodEnd, r.hours, r.status, r.createdBy, r.createdAt, r.reason ?? null, r.revision);
  }
  getAllocation(id: string): ResourceAllocationRecord | undefined {
    const r=this.db.prepare('SELECT * FROM rc_allocations WHERE id=?').get(id);
    return r ? this.mapAllocation(r) : undefined;
  }
  updateAllocation(r: ResourceAllocationRecord): void {
    const result=this.db.prepare(`UPDATE rc_allocations SET period_start=?,period_end=?,hours=?,status=?,reason=?,revision=? WHERE id=? AND revision=?`).run(
      r.periodStart,r.periodEnd,r.hours,r.status,r.reason??null,r.revision,r.id,r.revision-1,
    );
    if (Number(result.changes)!==1) throw new GoliathError('STALE_REVISION','Resource allocation changed concurrently.');
  }
  listAllocationsForResource(resourceId: string): readonly ResourceAllocationRecord[] {
    return this.db.prepare('SELECT * FROM rc_allocations WHERE resource_id=? ORDER BY period_start,id').all(resourceId).map((r) => this.mapAllocation(r));
  }
  listAllocationsForProject(projectId: string): readonly ResourceAllocationRecord[] {
    return this.db.prepare('SELECT * FROM rc_allocations WHERE project_id=? ORDER BY period_start,id').all(projectId).map((r) => this.mapAllocation(r));
  }

  insertDemand(r: ResourceDemandRecord): void {
    this.db.prepare(`INSERT INTO rc_demands(id,project_id,team_id,org_unit_id,skill,period_start,period_end,required_hours,state,requested_by,created_at,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.id, r.projectId, r.teamId ?? null, r.orgUnitId ?? null, r.skill ?? null, r.periodStart, r.periodEnd, r.requiredHours, r.state, r.requestedBy, r.createdAt, r.revision);
  }
  listDemandsForProject(projectId: string): readonly ResourceDemandRecord[] {
    return this.db.prepare('SELECT * FROM rc_demands WHERE project_id=? ORDER BY period_start,id').all(projectId).map((r) => this.mapDemand(r));
  }
  listDemandsForOrgUnits(orgUnitIds: readonly string[]): readonly ResourceDemandRecord[] {
    if (orgUnitIds.length === 0) return [];
    const placeholders = orgUnitIds.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM rc_demands WHERE state IN ('open','partially-filled') AND org_unit_id IN (${placeholders}) ORDER BY period_start,id`).all(...orgUnitIds).map((r) => this.mapDemand(r));
  }
  updateDemand(r: ResourceDemandRecord): void {
    const result=this.db.prepare('UPDATE rc_demands SET state=?,revision=? WHERE id=? AND revision=?').run(r.state,r.revision,r.id,r.revision-1);
    if (Number(result.changes)!==1) throw new GoliathError('STALE_REVISION','Resource demand changed concurrently.');
  }


  upsertWorklog(r: ResourceWorklogRecord): ResourceWorklogRecord {
    const current=this.getWorklogBySource(r.sourceSystem,r.sourceRef);
    if(current){
      if(current.resourceId!==r.resourceId||current.projectId!==r.projectId||current.activityId!==r.activityId) throw new GoliathError('FIELD_AUTHORITY_DENIED','Authoritative worklog cannot be retargeted.');
      if(current.sourceRevision===r.sourceRevision){
        if(current.workDate!==r.workDate||current.hours!==r.hours||current.billable!==r.billable) throw new GoliathError('STALE_REVISION','Same worklog source revision has conflicting content.');
        return current;
      }
      const next={...current,workDate:r.workDate,hours:r.hours,billable:r.billable,sourceRevision:r.sourceRevision,revision:current.revision+1};
      this.db.prepare('UPDATE rc_worklogs SET work_date=?,hours=?,billable=?,source_revision=?,revision=? WHERE id=?').run(next.workDate,next.hours,next.billable?1:0,next.sourceRevision,next.revision,next.id);
      return next;
    }
    this.db.prepare(`INSERT INTO rc_worklogs(id,resource_id,project_id,activity_id,work_date,hours,billable,source_system,source_ref,source_revision,created_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.id,r.resourceId,r.projectId,r.activityId??null,r.workDate,r.hours,r.billable?1:0,r.sourceSystem,r.sourceRef,r.sourceRevision,r.createdAt,r.revision);
    return r;
  }
  getWorklogBySource(sourceSystem:string,sourceRef:string):ResourceWorklogRecord|undefined{
    const r=this.db.prepare('SELECT * FROM rc_worklogs WHERE source_system=? AND source_ref=?').get(sourceSystem,sourceRef);
    return r?this.mapWorklog(r):undefined;
  }
  listWorklogsForProject(projectId:string):readonly ResourceWorklogRecord[]{return this.db.prepare('SELECT * FROM rc_worklogs WHERE project_id=? ORDER BY work_date,id').all(projectId).map((r)=>this.mapWorklog(r));}
  private mapWorklog(r:any):ResourceWorklogRecord{return {id:String(r.id),resourceId:String(r.resource_id),projectId:String(r.project_id),...(optional(r.activity_id)?{activityId:String(r.activity_id)}:{}),workDate:String(r.work_date),hours:Number(r.hours),billable:bool(r.billable),sourceSystem:String(r.source_system),sourceRef:String(r.source_ref),sourceRevision:String(r.source_revision),createdAt:String(r.created_at),revision:Number(r.revision)};}

  projectOrganisation(projectId: string): string | undefined {
    const r = this.db.prepare('SELECT organisation_id FROM pc_projects WHERE id=?').get(projectId);
    return r ? String(r.organisation_id) : undefined;
  }

  private mapResource(r: any): ResourceRecord {
    return { id:String(r.id), ...(optional(r.user_id)?{userId:String(r.user_id)}:{}), displayName:String(r.display_name), organisationId:String(r.organisation_id), orgUnitId:String(r.org_unit_id), active:bool(r.active), skills:parseArray(r.skills_json), weeklyContractHours:Number(r.weekly_contract_hours), createdAt:String(r.created_at), revision:Number(r.revision) };
  }
  private mapAllocation(r: any): ResourceAllocationRecord {
    return { id:String(r.id), resourceId:String(r.resource_id), projectId:String(r.project_id), ...(optional(r.activity_id)?{activityId:String(r.activity_id)}:{}), ...(optional(r.team_id)?{teamId:String(r.team_id)}:{}),
      periodStart:String(r.period_start), periodEnd:String(r.period_end), hours:Number(r.hours), status:r.status as ResourceAllocationRecord['status'], createdBy:String(r.created_by), createdAt:String(r.created_at), ...(optional(r.reason)?{reason:String(r.reason)}:{}), revision:Number(r.revision) };
  }
  private mapDemand(r: any): ResourceDemandRecord {
    return { id:String(r.id), projectId:String(r.project_id), ...(optional(r.team_id)?{teamId:String(r.team_id)}:{}), ...(optional(r.org_unit_id)?{orgUnitId:String(r.org_unit_id)}:{}), ...(optional(r.skill)?{skill:String(r.skill)}:{}),
      periodStart:String(r.period_start), periodEnd:String(r.period_end), requiredHours:Number(r.required_hours), state:r.state as ResourceDemandRecord['state'], requestedBy:String(r.requested_by), createdAt:String(r.created_at), revision:Number(r.revision) };
  }
}

/** Backward-compatible local/test name. The implementation is SQL-port based. */
export class SqliteResourceRepository extends SqlResourceRepository {}
