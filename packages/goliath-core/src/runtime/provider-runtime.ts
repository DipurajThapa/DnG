import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SyncSqlDatabase } from '../persistence/sync-database.js';
import { digest } from '../core/hash.js';
import { GoliathError } from '../core/errors.js';
import type { EnterpriseProjectEvent } from '../events/types.js';
import { EnterpriseEventIntelligenceService } from '../events/intelligence.js';

export type RuntimeProvider = 'jira-cloud' | 'qa-system' | 'erp-finance' | 'workforce' | 'github' | 'cicd' | 'hr' | 'procurement' | 'm365' | 'timesheet';

export interface RuntimeBindingRecord {
  id: string;
  organisationId: string;
  projectId: string;
  provider: RuntimeProvider;
  environment: string;
  enabled: boolean;
  domain: string;
}

export interface RuntimeRouteRecord {
  bindingId: string;
  organisationId: string;
  projectId: string;
  providerAccountId: string;
  providerEnvironment: string;
  resourceType: string;
  externalId: string;
  localEntityType: string;
  localEntityId: string;
}

export interface ProviderIdentity {
  eventId: string;
  accountId: string;
  resourceType: string;
  externalId: string;
  sourceVersion: string;
  sourceEffectiveAt: string;
}

export interface ProviderWebhookAdapter {
  readonly provider: RuntimeProvider;
  verify(secret: string, headers: Readonly<Record<string, string>>, rawBody: string): boolean;
  identity(payload: unknown, headers: Readonly<Record<string, string>>, receivedAt: string): ProviderIdentity;
  normalize(route: RuntimeRouteRecord, identity: ProviderIdentity, payload: unknown, receivedAt: string, correlationId: string): EnterpriseProjectEvent;
}

export interface InboxRuntimeRecord {
  id: string;
  bindingId: string;
  organisationId: string;
  projectId: string;
  providerEventId: string;
  providerAccountId: string;
  providerResourceType: string;
  payloadDigest: string;
  state: 'queued' | 'processing' | 'processed' | 'retryable' | 'dead-letter';
  attemptCount: number;
  lastError?: string;
  nextAttemptAt?: string;
  processedAt?: string;
  normalisedEvent: EnterpriseProjectEvent;
}

function parseJson(rawBody: string): unknown {
  try { return JSON.parse(rawBody); }
  catch { throw new GoliathError('INVALID_INPUT', 'Webhook body must be valid JSON.'); }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new GoliathError('INVALID_INPUT', `${label} is required.`);
  return value;
}

function asRecord(value: unknown, label = 'payload'): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GoliathError('INVALID_INPUT', `${label} must be an object.`);
  return value as Record<string, any>;
}

function validIso(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new GoliathError('INVALID_INPUT', `${label} must be a valid date/time.`);
  return value;
}

function integrationHeader(headers: Readonly<Record<string,string>>, suffix: string): string | undefined {
  // Goliath is the preferred protocol name. EDAPOS headers remain accepted only as a migration alias so existing provider registrations do not break.
  return headers[`x-goliath-${suffix}`] ?? headers[`x-edapos-${suffix}`];
}

function safeEqualHex(expected: string, supplied: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(supplied, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signWebhook(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

abstract class SignedWebhookAdapter implements ProviderWebhookAdapter {
  abstract readonly provider: RuntimeProvider;
  verify(secret: string, headers: Readonly<Record<string, string>>, rawBody: string): boolean {
    const supplied = integrationHeader(headers,'signature') ?? '';
    return safeEqualHex(signWebhook(secret, rawBody), supplied);
  }
  abstract identity(payload: unknown, headers: Readonly<Record<string, string>>, receivedAt: string): ProviderIdentity;
  abstract normalize(route: RuntimeRouteRecord, identity: ProviderIdentity, payload: unknown, receivedAt: string, correlationId: string): EnterpriseProjectEvent;
}

function jiraStatus(value: string): 'not-started' | 'in-progress' | 'blocked' | 'done' {
  const v = value.trim().toLowerCase();
  if (['done', 'closed', 'resolved', 'complete', 'completed'].includes(v)) return 'done';
  if (['blocked', 'impediment'].includes(v)) return 'blocked';
  if (['in progress', 'in-progress', 'active', 'started'].includes(v)) return 'in-progress';
  return 'not-started';
}

export class JiraCloudWebhookAdapter extends SignedWebhookAdapter {
  readonly provider = 'jira-cloud' as const;
  identity(payload: unknown, headers: Readonly<Record<string, string>>, receivedAt: string): ProviderIdentity {
    const p = asRecord(payload);
    const issue = asRecord(p.issue, 'issue');
    const eventId = requiredString(integrationHeader(headers,'event-id') ?? `${p.webhookEvent ?? 'jira'}:${p.timestamp ?? receivedAt}:${issue.id ?? issue.key}`, 'event id');
    return {
      eventId,
      accountId: requiredString(integrationHeader(headers,'account-id'), 'x-goliath-account-id'),
      resourceType: 'issue',
      externalId: requiredString(issue.key ?? issue.id, 'issue key'),
      sourceVersion: String(p.timestamp ?? p.changelog?.id ?? receivedAt),
      sourceEffectiveAt: validIso(requiredString(integrationHeader(headers,'effective-at') ?? receivedAt, 'effective time'), 'effective time'),
    };
  }
  normalize(route: RuntimeRouteRecord, identity: ProviderIdentity, payload: unknown, receivedAt: string, correlationId: string): EnterpriseProjectEvent {
    const p = asRecord(payload); const issue = asRecord(p.issue, 'issue'); const fields = asRecord(issue.fields ?? {}, 'issue.fields');
    const status = jiraStatus(String(fields.status?.name ?? fields.status ?? 'not-started'));
    const evidenceRef = `JIRA:${identity.externalId}:${identity.eventId}`;
    const completion = status === 'done'
      ? { percentComplete: 100, actualFinish: validIso(requiredString(fields.resolutiondate, 'issue.fields.resolutiondate for completed work'), 'issue.fields.resolutiondate').slice(0, 10) }
      : {};
    return {
      kind:'activity.changed', projectId:route.projectId, organisationId:route.organisationId, entityId:route.localEntityId,
      sourceSystem:'Jira', sourceTenant:identity.accountId, sourceEventId:identity.eventId, sourceRef:`JIRA:${identity.externalId}`,
      sourceRevision:identity.sourceVersion, sourceEffectiveAt:identity.sourceEffectiveAt, observedAt:receivedAt, correlationId,
      payload:{ status, ...completion, evidenceRefs:[evidenceRef] },
    };
  }
}

export class QaWebhookAdapter extends SignedWebhookAdapter {
  readonly provider = 'qa-system' as const;
  identity(payload: unknown, headers: Readonly<Record<string, string>>, receivedAt: string): ProviderIdentity {
    const p=asRecord(payload);
    return { eventId:requiredString(p.eventId,'eventId'), accountId:requiredString(integrationHeader(headers,'account-id'),'x-goliath-account-id'), resourceType:'test-run',
      externalId:requiredString(p.activityKey ?? p.testRunId,'activityKey'), sourceVersion:String(p.revision ?? p.updatedAt ?? receivedAt),
      sourceEffectiveAt:validIso(requiredString(p.updatedAt ?? receivedAt,'updatedAt'),'updatedAt') };
  }
  normalize(route: RuntimeRouteRecord, identity: ProviderIdentity, payload: unknown, receivedAt: string, correlationId: string): EnterpriseProjectEvent {
    const p=asRecord(payload); const status=jiraStatus(String(p.status ?? (p.passed === true ? 'done' : 'in-progress')));
    const forecastFinish = typeof p.forecastFinish === 'string' ? p.forecastFinish : undefined;
    const blocker = p.blocker === null || typeof p.blocker === 'string' ? p.blocker : undefined;
    return { kind:'activity.changed',projectId:route.projectId,organisationId:route.organisationId,entityId:route.localEntityId,sourceSystem:'QA',sourceTenant:identity.accountId,
      sourceEventId:identity.eventId,sourceRef:`QA:${identity.externalId}`,sourceRevision:identity.sourceVersion,sourceEffectiveAt:identity.sourceEffectiveAt,observedAt:receivedAt,correlationId,
      payload:{status,...(forecastFinish?{forecastFinish}:{}),...(blocker!==undefined?{blocker}:{}),...(status==='done'?{percentComplete:100}:{}),evidenceRefs:[`QA:${identity.externalId}:${identity.eventId}`]} };
  }
}

export class ErpFinanceWebhookAdapter extends SignedWebhookAdapter {
  readonly provider = 'erp-finance' as const;
  identity(payload: unknown, headers: Readonly<Record<string, string>>, receivedAt: string): ProviderIdentity {
    const p=asRecord(payload);
    return { eventId:requiredString(p.eventId,'eventId'),accountId:requiredString(integrationHeader(headers,'account-id'),'x-goliath-account-id'),resourceType:'finance-entry',
      externalId:requiredString(p.recordId,'recordId'),sourceVersion:String(p.revision ?? 1),sourceEffectiveAt:validIso(requiredString(p.occurredAt ?? receivedAt,'occurredAt'),'occurredAt') };
  }
  normalize(route: RuntimeRouteRecord, identity: ProviderIdentity, payload: unknown, receivedAt: string, correlationId: string): EnterpriseProjectEvent {
    const p=asRecord(payload); const entryType=requiredString(p.entryType,'entryType') as 'actual'|'commitment'|'accrual'|'credit'|'revenue'|'benefit';
    if (!['actual','commitment','accrual','credit','revenue','benefit'].includes(entryType)) throw new GoliathError('INVALID_INPUT','Unsupported finance entry type.');
    if (typeof p.amount !== 'number' || !Number.isFinite(p.amount)) throw new GoliathError('INVALID_INPUT','amount must be numeric.');
    return {kind:'finance.entry.changed',projectId:route.projectId,organisationId:route.organisationId,entityId:identity.externalId,sourceSystem:'ERP',sourceTenant:identity.accountId,
      sourceEventId:identity.eventId,sourceRef:`ERP:${identity.externalId}`,sourceRevision:identity.sourceVersion,sourceEffectiveAt:identity.sourceEffectiveAt,observedAt:receivedAt,correlationId,
      payload:{entryType,amount:p.amount,currency:requiredString(p.currency,'currency'),occurredAt:identity.sourceEffectiveAt,classification:(p.classification ?? 'confidential') as any} };
  }
}

export class WorkforceWebhookAdapter extends SignedWebhookAdapter {
  readonly provider = 'workforce' as const;
  identity(payload: unknown, headers: Readonly<Record<string, string>>, receivedAt: string): ProviderIdentity {
    const p=asRecord(payload); const recordType=requiredString(p.recordType,'recordType');
    if (!['capacity','allocation'].includes(recordType)) throw new GoliathError('INVALID_INPUT','recordType must be capacity or allocation.');
    return { eventId:requiredString(p.eventId,'eventId'),accountId:requiredString(integrationHeader(headers,'account-id'),'x-goliath-account-id'),resourceType:recordType,
      externalId:requiredString(recordType==='capacity' ? p.resourceId : p.allocationId,recordType==='capacity'?'resourceId':'allocationId'),sourceVersion:String(p.revision ?? 1),
      sourceEffectiveAt:validIso(requiredString(p.updatedAt ?? receivedAt,'updatedAt'),'updatedAt') };
  }
  normalize(route: RuntimeRouteRecord, identity: ProviderIdentity, payload: unknown, receivedAt: string, correlationId: string): EnterpriseProjectEvent {
    const p=asRecord(payload);
    if (identity.resourceType==='capacity') {
      return {kind:'resource.capacity.changed',projectId:route.projectId,organisationId:route.organisationId,entityId:identity.externalId,sourceSystem:'WFM',sourceTenant:identity.accountId,
        sourceEventId:identity.eventId,sourceRef:`WFM:CAPACITY:${identity.externalId}`,sourceRevision:identity.sourceVersion,sourceEffectiveAt:identity.sourceEffectiveAt,observedAt:receivedAt,correlationId,
        payload:{periodStart:requiredString(p.periodStart,'periodStart'),periodEnd:requiredString(p.periodEnd,'periodEnd'),grossHours:Number(p.grossHours),unavailableHours:Number(p.unavailableHours ?? 0)} };
    }
    return {kind:'resource.allocation.changed',projectId:route.projectId,organisationId:route.organisationId,entityId:identity.externalId,sourceSystem:'WFM',sourceTenant:identity.accountId,
      sourceEventId:identity.eventId,sourceRef:`WFM:ALLOCATION:${identity.externalId}`,sourceRevision:identity.sourceVersion,sourceEffectiveAt:identity.sourceEffectiveAt,observedAt:receivedAt,correlationId,
      payload:{resourceId:requiredString(p.resourceId,'resourceId'),...(typeof p.activityId==='string'?{activityId:p.activityId}:{}),...(typeof p.teamId==='string'?{teamId:p.teamId}:{}),periodStart:requiredString(p.periodStart,'periodStart'),periodEnd:requiredString(p.periodEnd,'periodEnd'),hours:Number(p.hours),status:(p.status ?? 'confirmed') as any} };
  }
}

export class SqlProviderRuntimeRepository {
  constructor(public readonly db: SyncSqlDatabase, private readonly now: () => Date = () => new Date()) {}

  getBinding(id: string): RuntimeBindingRecord | undefined {
    const r=this.db.prepare('SELECT * FROM integration_bindings_v2 WHERE id=?').get(id); if(!r) return undefined;
    return {id:String(r.id),organisationId:String(r.organisation_id),projectId:String(r.project_id),provider:String(r.provider) as RuntimeProvider,environment:String(r.environment),enabled:Number(r.enabled)===1,domain:String(r.domain)};
  }

  resolveRoute(bindingId:string, accountId:string, resourceType:string, externalId:string):RuntimeRouteRecord|undefined {
    const r=this.db.prepare(`SELECT l.*, b.organisation_id AS b_org, b.project_id AS b_project FROM external_object_links_v2 l JOIN integration_bindings_v2 b ON b.id=l.binding_id
      WHERE l.binding_id=? AND l.provider_account_id=? AND l.resource_type=? AND l.external_id=? AND l.tombstoned_at IS NULL ORDER BY l.mapping_version DESC LIMIT 1`).get(bindingId,accountId,resourceType,externalId);
    if(!r) return undefined;
    return {bindingId:String(r.binding_id),organisationId:String(r.organisation_id),projectId:String(r.project_id),providerAccountId:String(r.provider_account_id),providerEnvironment:String(r.provider_environment),resourceType:String(r.resource_type),externalId:String(r.external_id),localEntityType:String(r.local_entity_type),localEntityId:String(r.local_entity_id)};
  }

  enqueue(input:{binding:RuntimeBindingRecord;identity:ProviderIdentity;payload:unknown;normalisedEvent:EnterpriseProjectEvent;payloadDigest:string;correlationId:string;keyId?:string}):'queued'|'duplicate'|'conflict' {
    const existing=this.db.prepare(`SELECT payload_digest FROM integration_inbox_v2 WHERE binding_id=? AND provider_account_id=? AND provider_resource_type=? AND provider_event_id=?`).get(input.binding.id,input.identity.accountId,input.identity.resourceType,input.identity.eventId);
    if(existing) return String(existing.payload_digest)===input.payloadDigest ? 'duplicate' : 'conflict';
    const now=this.now().toISOString();
    this.db.prepare(`INSERT INTO integration_inbox_v2(id,organisation_id,project_id,binding_id,provider_event_id,provider_account_id,provider_resource_type,source_version,source_effective_at,observed_at,payload_digest,schema_version,state,correlation_id,created_at,updated_at,payload_json,normalised_event_json,attempt_count,signature_key_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`runtime:${digest({bindingId:input.binding.id,accountId:input.identity.accountId,resourceType:input.identity.resourceType,eventId:input.identity.eventId}).slice(0,40)}`,input.binding.organisationId,input.binding.projectId,input.binding.id,input.identity.eventId,input.identity.accountId,input.identity.resourceType,input.identity.sourceVersion,input.identity.sourceEffectiveAt,input.normalisedEvent.observedAt,input.payloadDigest,'phase5.v1','queued',input.correlationId,now,now,JSON.stringify(input.payload),JSON.stringify(input.normalisedEvent),0,input.keyId ?? null);
    return 'queued';
  }

  nextReady(nowIso:string):InboxRuntimeRecord|undefined {
    const r=this.db.prepare(`SELECT * FROM integration_inbox_v2 WHERE state IN ('queued','retryable') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at,id LIMIT 1`).get(nowIso);
    return r?this.mapInbox(r):undefined;
  }
  markProcessing(id:string):boolean { return Number(this.db.prepare(`UPDATE integration_inbox_v2 SET state='processing',updated_at=? WHERE id=? AND state IN ('queued','retryable')`).run(this.now().toISOString(),id).changes)>0; }
  recoverStaleProcessing(cutoffIso:string, readyAtIso:string):number { return Number(this.db.prepare(`UPDATE integration_inbox_v2 SET state='retryable',attempt_count=attempt_count+1,last_error=COALESCE(last_error,'Worker lease expired before completion.'),next_attempt_at=?,updated_at=? WHERE state='processing' AND updated_at<=?`).run(readyAtIso,readyAtIso,cutoffIso).changes); }
  markProcessed(id:string):void { const now=this.now().toISOString(); this.db.prepare(`UPDATE integration_inbox_v2 SET state='processed',processed_at=?,updated_at=?,last_error=NULL,next_attempt_at=NULL WHERE id=?`).run(now,now,id); }
  markRetry(id:string,error:string,attempt:number,nextAttemptAt:string):void { this.db.prepare(`UPDATE integration_inbox_v2 SET state='retryable',attempt_count=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=?`).run(attempt,error,nextAttemptAt,this.now().toISOString(),id); }
  markDeadLetter(id:string,error:string,attempt:number):void { this.db.prepare(`UPDATE integration_inbox_v2 SET state='dead-letter',attempt_count=?,last_error=?,next_attempt_at=NULL,updated_at=? WHERE id=?`).run(attempt,error,this.now().toISOString(),id); }
  getInbox(id:string):InboxRuntimeRecord|undefined { const r=this.db.prepare('SELECT * FROM integration_inbox_v2 WHERE id=?').get(id); return r?this.mapInbox(r):undefined; }
  listInbox():readonly InboxRuntimeRecord[] { return this.db.prepare('SELECT * FROM integration_inbox_v2 ORDER BY created_at,id').all().map((r)=>this.mapInbox(r)); }
  private mapInbox(r:any):InboxRuntimeRecord { return {id:String(r.id),bindingId:String(r.binding_id),organisationId:String(r.organisation_id),projectId:String(r.project_id),providerEventId:String(r.provider_event_id),providerAccountId:String(r.provider_account_id),providerResourceType:String(r.provider_resource_type),payloadDigest:String(r.payload_digest),state:String(r.state) as InboxRuntimeRecord['state'],attemptCount:Number(r.attempt_count??0),...(r.last_error?{lastError:String(r.last_error)}:{}),...(r.next_attempt_at?{nextAttemptAt:String(r.next_attempt_at)}:{}),...(r.processed_at?{processedAt:String(r.processed_at)}:{}),normalisedEvent:JSON.parse(String(r.normalised_event_json)) as EnterpriseProjectEvent}; }
}

export interface WebhookSecretProvider { get(bindingId:string): {secret:string;keyId:string}|undefined; }

export class StaticWebhookSecretProvider implements WebhookSecretProvider {
  constructor(private readonly secrets:Readonly<Record<string,{secret:string;keyId:string}>>) {}
  get(bindingId:string){ return this.secrets[bindingId]; }
}

export class ProviderWebhookGateway {
  constructor(private readonly repo:SqlProviderRuntimeRepository, private readonly adapters:Readonly<Record<string,ProviderWebhookAdapter>>, private readonly secrets:WebhookSecretProvider, private readonly now:()=>Date=()=>new Date()){}
  receive(input:{provider:RuntimeProvider;bindingId:string;headers:Readonly<Record<string,string>>;rawBody:string;receivedAt?:string;correlationId?:string}):{status:'queued'|'duplicate';inboxId?:string} {
    const binding=this.repo.getBinding(input.bindingId); if(!binding) throw new GoliathError('NOT_FOUND','Provider binding not found.');
    if(!binding.enabled) throw new GoliathError('INTEGRATION_DISABLED','Provider binding is disabled.');
    if(binding.provider!==input.provider) throw new GoliathError('ACCESS_DENIED','Webhook provider does not match binding.');
    const adapter=this.adapters[input.provider]; if(!adapter) throw new GoliathError('NOT_FOUND','Provider adapter is unavailable.');
    const secret=this.secrets.get(binding.id); if(!secret) throw new GoliathError('INTEGRATION_DISABLED','Webhook secret is not configured.');
    if(!adapter.verify(secret.secret,input.headers,input.rawBody)) throw new GoliathError('ACCESS_DENIED','Webhook signature is invalid.');
    const payload=parseJson(input.rawBody); const receivedAt=validIso(input.receivedAt??this.now().toISOString(),'receivedAt');
    const identity=adapter.identity(payload,input.headers,receivedAt); const route=this.repo.resolveRoute(binding.id,identity.accountId,identity.resourceType,identity.externalId);
    if(!route) throw new GoliathError('MAPPING_REQUIRED','Provider object is not mapped to a governed GOLIATH entity.');
    if(route.organisationId!==binding.organisationId||route.projectId!==binding.projectId||route.providerEnvironment!==binding.environment) throw new GoliathError('ACCESS_DENIED','Provider mapping no longer matches binding scope.');
    const correlationId=input.correlationId??integrationHeader(input.headers,'correlation-id')??`webhook:${identity.eventId}`;
    const normalisedEvent=adapter.normalize(route,identity,payload,receivedAt,correlationId); const pd=digest(payload);
    const outcome=this.repo.enqueue({binding,identity,payload,normalisedEvent,payloadDigest:pd,correlationId,keyId:secret.keyId});
    if(outcome==='conflict') throw new GoliathError('DUPLICATE_EVENT','Provider event identity was reused with changed payload.');
    if(outcome==='duplicate') return {status:'duplicate'};
    const row=this.repo.listInbox().find((x)=>x.bindingId===binding.id&&x.providerEventId===identity.eventId&&x.providerAccountId===identity.accountId&&x.providerResourceType===identity.resourceType);
    return {status:'queued',...(row?{inboxId:row.id}:{})};
  }
}

export class ProviderQueueWorker {
  constructor(private readonly repo:SqlProviderRuntimeRepository,private readonly events:Pick<EnterpriseEventIntelligenceService, 'process'>,private readonly now:()=>Date=()=>new Date(),private readonly maxAttempts=3,private readonly processingLeaseMs=30_000){}
  async drain(limit=25):Promise<{processed:number;retried:number;deadLettered:number;recovered:number}> {
    const current=this.now();
    const recovered=this.repo.recoverStaleProcessing(new Date(current.getTime()-this.processingLeaseMs).toISOString(),current.toISOString());
    let processed=0,retried=0,deadLettered=0;
    for(let i=0;i<limit;i++){
      const row=this.repo.nextReady(this.now().toISOString()); if(!row) break;
      if(!this.repo.markProcessing(row.id)) continue;
      try { await this.events.process(row.normalisedEvent); this.repo.markProcessed(row.id); processed++; }
      catch(error){
        const attempt=row.attemptCount+1; const message=error instanceof Error?error.message:'Provider event processing failed.';
        const permanent=error instanceof GoliathError && ['ACCESS_DENIED','INVALID_INPUT','FIELD_AUTHORITY_DENIED','DUPLICATE_EVENT','MAPPING_REQUIRED','NOT_FOUND'].includes(error.code);
        if(permanent||attempt>=this.maxAttempts){ this.repo.markDeadLetter(row.id,message,attempt); deadLettered++; }
        else { const delayMs=Math.min(60_000,1000*(2**(attempt-1))); this.repo.markRetry(row.id,message,attempt,new Date(this.now().getTime()+delayMs).toISOString()); retried++; }
      }
    }
    return {processed,retried,deadLettered,recovered};
  }
}

/** Backward-compatible local/test name. The implementation is SQL-port based. */
export class SqliteProviderRuntimeRepository extends SqlProviderRuntimeRepository {}
