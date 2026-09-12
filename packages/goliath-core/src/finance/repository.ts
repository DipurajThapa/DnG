import type { SyncSqlDatabase } from '../persistence/sync-database.js';
import type { FinanceEntryRecord, FinanceForecastInput } from './types.js';

function optional<T>(value: T | null | undefined): T | undefined { return value === null || value === undefined ? undefined : value; }
function parseArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try { const x = JSON.parse(value) as unknown; return Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []; }
  catch { return []; }
}

export class SqlFinanceRepository {
  constructor(public readonly db: SyncSqlDatabase) {}

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  getEntryBySource(sourceSystem: string, sourceRef: string): FinanceEntryRecord | undefined {
    const r = this.db.prepare('SELECT * FROM fin_entries WHERE source_system=? AND source_ref=?').get(sourceSystem, sourceRef);
    return r ? this.mapEntry(r) : undefined;
  }
  insertEntry(r: FinanceEntryRecord): void {
    this.db.prepare(`INSERT INTO fin_entries(id,project_id,entry_type,amount,currency,source_system,source_ref,source_revision,occurred_at,classification,description,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.id,r.projectId,r.entryType,r.amount,r.currency,r.sourceSystem,r.sourceRef,r.sourceRevision,r.occurredAt,r.classification,r.description??null,r.revision);
  }
  updateEntry(r: FinanceEntryRecord): void {
    const result = this.db.prepare(`UPDATE fin_entries SET project_id=?,entry_type=?,amount=?,currency=?,source_revision=?,occurred_at=?,classification=?,description=?,revision=?
      WHERE source_system=? AND source_ref=? AND revision=?`).run(r.projectId,r.entryType,r.amount,r.currency,r.sourceRevision,r.occurredAt,r.classification,r.description??null,r.revision,r.sourceSystem,r.sourceRef,r.revision-1);
    if (Number(result.changes) !== 1) throw new Error('Finance entry changed concurrently.');
  }
  listEntries(projectId: string): readonly FinanceEntryRecord[] {
    return this.db.prepare('SELECT * FROM fin_entries WHERE project_id=? ORDER BY occurred_at,id').all(projectId).map((r)=>this.mapEntry(r));
  }

  getForecast(projectId: string): FinanceForecastInput | undefined {
    const r = this.db.prepare('SELECT * FROM fin_forecast_inputs WHERE project_id=?').get(projectId);
    return r ? this.mapForecast(r) : undefined;
  }
  upsertForecast(r: FinanceForecastInput): void {
    this.db.prepare(`INSERT INTO fin_forecast_inputs(project_id,etc_amount,contingency_amount,projected_revenue,benefit_forecast,currency,as_of,source_refs_json,updated_by,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET etc_amount=excluded.etc_amount,contingency_amount=excluded.contingency_amount,projected_revenue=excluded.projected_revenue,
      benefit_forecast=excluded.benefit_forecast,currency=excluded.currency,as_of=excluded.as_of,source_refs_json=excluded.source_refs_json,updated_by=excluded.updated_by,
      revision=fin_forecast_inputs.revision+1`).run(r.projectId,r.etcAmount,r.contingencyAmount,r.projectedRevenue??null,r.benefitForecast??null,r.currency,r.asOf,JSON.stringify(r.sourceRefs),r.updatedBy,r.revision);
  }

  private mapEntry(r: any): FinanceEntryRecord {
    return { id:String(r.id), projectId:String(r.project_id), entryType:r.entry_type as FinanceEntryRecord['entryType'], amount:Number(r.amount), currency:String(r.currency), sourceSystem:String(r.source_system), sourceRef:String(r.source_ref), sourceRevision:String(r.source_revision), occurredAt:String(r.occurred_at), classification:r.classification as FinanceEntryRecord['classification'], ...(optional(r.description)?{description:String(r.description)}:{}), revision:Number(r.revision) };
  }
  private mapForecast(r: any): FinanceForecastInput {
    return { projectId:String(r.project_id), etcAmount:Number(r.etc_amount), contingencyAmount:Number(r.contingency_amount), ...(optional(r.projected_revenue)?{projectedRevenue:Number(r.projected_revenue)}:{}), ...(optional(r.benefit_forecast)?{benefitForecast:Number(r.benefit_forecast)}:{}), currency:String(r.currency), asOf:String(r.as_of), sourceRefs:parseArray(r.source_refs_json), updatedBy:String(r.updated_by), revision:Number(r.revision) };
  }
}

/** Backward-compatible local/test name. The implementation is SQL-port based. */
export class SqliteFinanceRepository extends SqlFinanceRepository {}
