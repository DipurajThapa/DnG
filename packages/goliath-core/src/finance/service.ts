import { randomUUID } from 'node:crypto';
import { GoliathError } from '../core/errors.js';
import { ActingContextBoundary, type ApplicationContextRequest } from '../application/context-boundary.js';
import { EnterpriseContextService } from '../context/service.js';
import { SqlProjectRepository } from '../project/sqlite-repository.js';
import { SqlFinanceRepository } from './repository.js';
import type { FinanceEntryRecord, FinanceForecastInput, FinanceProjection } from './types.js';

function round(v: number): number { return Math.round(v * 100) / 100; }

export class FinanceService {
  constructor(
    private readonly boundary: ActingContextBoundary,
    private readonly contexts: EnterpriseContextService,
    private readonly repo: SqlFinanceRepository,
    private readonly projects: SqlProjectRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getAuthoritativeEntryBySource(sourceSystem: string, sourceRef: string): FinanceEntryRecord | undefined {
    return this.repo.getEntryBySource(sourceSystem, sourceRef);
  }

  /** Integration-owned ingestion of project-relevant financial facts. */
  ingestAuthoritativeEntry(input: Omit<FinanceEntryRecord, 'id' | 'revision'> & { id?: string }, actorId = 'system:finance'): FinanceEntryRecord {
    const project = this.projects.getProject(input.projectId);
    if (!project) throw new GoliathError('NOT_FOUND', 'Project not found.');
    if (!input.sourceSystem.trim() || !input.sourceRef.trim() || !input.sourceRevision.trim()) throw new GoliathError('INVALID_INPUT', 'Finance source identity and revision are required.');
    if (!Number.isFinite(input.amount) || input.amount < 0) throw new GoliathError('INVALID_INPUT', 'Finance amount must be non-negative.');
    if (project.currency && project.currency !== input.currency) throw new GoliathError('INVALID_INPUT', 'Finance entry currency must match the project currency in this phase.');
    const current = this.repo.getEntryBySource(input.sourceSystem, input.sourceRef);
    if (current && current.projectId !== input.projectId) throw new GoliathError('FIELD_AUTHORITY_DENIED', 'A finance source record cannot be silently retargeted to another project.');
    if (current?.sourceRevision === input.sourceRevision) {
      const same = current.projectId===input.projectId && current.entryType===input.entryType && current.amount===input.amount && current.currency===input.currency && current.classification===input.classification;
      if (!same) throw new GoliathError('DUPLICATE_EVENT', 'The same finance source revision arrived with conflicting content.');
      return current;
    }
    const record: FinanceEntryRecord = current
      ? { ...current, ...input, id:current.id, revision:current.revision+1 }
      : { ...input, id:input.id ?? randomUUID(), revision:1 };
    this.repo.transaction(() => current ? this.repo.updateEntry(record) : this.repo.insertEntry(record));
    if ([current?.entryType,record.entryType].some((t)=>t==='actual'||t==='credit')) this.syncProjectEac(input.projectId, actorId);
    this.contexts.recordDomainEvent(actorId,'finance.entry-reconciled','project',input.projectId,'recorded','Authoritative finance fact reconciled into the canonical project model.',{ entryId:record.id, entryType:record.entryType, sourceSystem:record.sourceSystem, sourceRef:record.sourceRef, sourceRevision:record.sourceRevision });
    return record;
  }

  setForecast(request: ApplicationContextRequest, input: Omit<FinanceForecastInput, 'updatedBy' | 'revision'>): FinanceForecastInput {
    const context = this.boundary.requireProjectAny(request,input.projectId,['money:view-project','money:view-commercial']);
    if (!context.permissions.includes('project:manage') && context.role !== 'project-director') throw new GoliathError('ACCESS_DENIED','Project management authority is required to update delivery forecast inputs.');
    const project = this.projects.getProject(input.projectId);
    if (!project) throw new GoliathError('NOT_FOUND','Project not found.');
    if (project.currency && project.currency !== input.currency) throw new GoliathError('INVALID_INPUT','Forecast currency must match the project currency.');
    if ([input.etcAmount,input.contingencyAmount,input.projectedRevenue,input.benefitForecast].some((v)=>v!==undefined && (!Number.isFinite(v) || v<0))) throw new GoliathError('INVALID_INPUT','Forecast amounts must be non-negative.');
    if (input.projectedRevenue !== undefined && !context.permissions.includes('money:view-commercial')) throw new GoliathError('ACCESS_DENIED','Commercial revenue forecast requires commercial finance authority.');
    const current = this.repo.getForecast(input.projectId);
    const record: FinanceForecastInput = { ...input, sourceRefs:[...new Set(input.sourceRefs)], updatedBy:request.userId, revision:(current?.revision ?? 0)+1 };
    this.repo.upsertForecast(record);
    this.syncProjectEac(input.projectId, request.userId);
    this.contexts.recordDomainEvent(request.userId,'finance.forecast-updated','project',input.projectId,'allowed','Project delivery forecast inputs updated.',{ etc:record.etcAmount, contingency:record.contingencyAmount },context.assignmentId);
    return this.repo.getForecast(input.projectId)!;
  }

  getProjection(request: ApplicationContextRequest, projectId: string): FinanceProjection {
    const context = this.boundary.requireProjectAny(request,projectId,['money:view-commercial','money:view-project','money:view-summary']);
    const visibility = context.permissions.includes('money:view-commercial') ? 'commercial' : context.permissions.includes('money:view-project') ? 'project' : 'summary';
    const project = this.projects.getProject(projectId)!;
    const entries = this.repo.listEntries(projectId);
    const forecast = this.repo.getForecast(projectId);
    const currency = project.currency ?? forecast?.currency ?? entries[0]?.currency;
    if (!currency) return { projectId, visibility, sourceRefs:[], completeness:'unknown', notes:['No project financial source is configured.'] };
    const mismatched = entries.filter((e)=>e.currency!==currency);
    if (mismatched.length) throw new GoliathError('INVALID_INPUT','Mixed project currencies require a governed conversion rate before aggregation.');
    const actual = entries.filter((e)=>e.entryType==='actual').reduce((s,e)=>s+e.amount,0)-entries.filter((e)=>e.entryType==='credit').reduce((s,e)=>s+e.amount,0);
    const commitments = entries.filter((e)=>e.entryType==='commitment').reduce((s,e)=>s+e.amount,0);
    const accruals = entries.filter((e)=>e.entryType==='accrual').reduce((s,e)=>s+e.amount,0);
    const revenue = entries.filter((e)=>e.entryType==='revenue').reduce((s,e)=>s+e.amount,0);
    const realizedBenefits = entries.filter((e)=>e.entryType==='benefit').reduce((s,e)=>s+e.amount,0);
    const etc = forecast?.etcAmount;
    const contingency = forecast?.contingencyAmount;
    const eac = etc===undefined ? project.eac : round(actual+etc+(contingency??0));
    const budget = project.budget;
    const variance = budget!==undefined && eac!==undefined ? round(eac-budget) : undefined;
    const projectedRevenue = forecast?.projectedRevenue ?? (revenue>0?revenue:undefined);
    const margin = projectedRevenue!==undefined && eac!==undefined ? round(projectedRevenue-eac) : undefined;
    const benefits = forecast?.benefitForecast ?? (realizedBenefits>0?realizedBenefits:undefined);
    const sourceRefs=[...new Set([...entries.map((e)=>`${e.sourceSystem}:${e.sourceRef}`),...(forecast?.sourceRefs??[])])];
    const notes:string[]=[];
    if (entries.length===0) notes.push('No authoritative finance entries have been reconciled.');
    if (!forecast) notes.push('Delivery ETC/contingency forecast has not been recorded.');
    const completeness = entries.length>0 && forecast ? 'complete' : entries.length>0 || forecast ? 'partial' : 'unknown';
    const base: FinanceProjection = { projectId, visibility, currency, ...(budget!==undefined?{budget:round(budget)}:{}), ...(eac!==undefined?{eac:round(eac)}:{}), ...(variance!==undefined?{variance}:{}), sourceRefs, ...(forecast?.asOf?{asOf:forecast.asOf}:{}), completeness, notes };
    if (visibility==='summary') return base;
    const projectView: FinanceProjection = { ...base, actualCost:round(actual), commitments:round(commitments), accruals:round(accruals), ...(etc!==undefined?{etc:round(etc)}:{}), ...(contingency!==undefined?{contingency:round(contingency)}:{}) };
    if (visibility==='project') return projectView;
    return { ...projectView, ...(projectedRevenue!==undefined?{projectedRevenue:round(projectedRevenue)}:{}), ...(margin!==undefined?{margin}:{}), ...(benefits!==undefined?{benefits:round(benefits)}:{}) };
  }

  private syncProjectEac(projectId: string, actorId: string): void {
    const project=this.projects.getProject(projectId)!;
    const entries=this.repo.listEntries(projectId);
    const forecast=this.repo.getForecast(projectId);
    if (!forecast) return;
    const actual=entries.filter((e)=>e.entryType==='actual').reduce((s,e)=>s+e.amount,0)-entries.filter((e)=>e.entryType==='credit').reduce((s,e)=>s+e.amount,0);
    const eac=round(actual+forecast.etcAmount+forecast.contingencyAmount);
    if (project.eac===eac) return;
    this.projects.updateProject({ ...project, eac, updatedAt:this.now().toISOString(), revision:project.revision+1 });
    this.contexts.recordDomainEvent(actorId,'finance.eac-recalculated','project',projectId,'recorded','Project EAC recalculated from canonical actuals and forecast inputs.',{ actual:round(actual), etc:forecast.etcAmount, contingency:forecast.contingencyAmount, eac });
  }
}
