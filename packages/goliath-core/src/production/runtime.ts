import { digest } from '../core/hash.js';
import { GoliathError } from '../core/errors.js';
import { HmacSessionService, type RuntimePrincipal } from '../runtime/auth.js';
import type { ProviderWebhookAdapter, RuntimeBindingRecord, RuntimeProvider, SqlProviderRuntimeRepository, WebhookSecretProvider } from '../runtime/provider-runtime.js';

export interface VerifiedOidcClaims {
  issuer: string;
  audience: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  expiresAt: string;
}
export interface OidcTokenVerifier { verify(token:string): Promise<VerifiedOidcClaims>; }
export interface EnterpriseUserResolver { resolve(claims:VerifiedOidcClaims): {userId:string;displayName:string}|undefined; }

/** Production identity adapter. Token signature/JWKS verification stays with the configured OIDC verifier. */
export class EnterpriseOidcIdentityProvider {
  constructor(
    private readonly verifier:OidcTokenVerifier,
    private readonly users:EnterpriseUserResolver,
    private readonly sessions:HmacSessionService,
    private readonly trustedIssuers:readonly string[],
    private readonly audience:string,
    private readonly now:()=>Date=()=>new Date(),
  ){}
  async login(token:string):Promise<{token:string;principal:RuntimePrincipal}>{
    if(!token.trim()) throw new GoliathError('ACCESS_DENIED','OIDC token is required.');
    const claims=await this.verifier.verify(token);
    if(!this.trustedIssuers.includes(claims.issuer)||claims.audience!==this.audience) throw new GoliathError('ACCESS_DENIED','OIDC issuer or audience is not trusted.');
    if(!claims.subject.trim()||!claims.email.trim()||!claims.emailVerified) throw new GoliathError('ACCESS_DENIED','OIDC identity is incomplete or email is unverified.');
    if(!Number.isFinite(Date.parse(claims.expiresAt))||Date.parse(claims.expiresAt)<=this.now().getTime()) throw new GoliathError('ACCESS_DENIED','OIDC token has expired.');
    const user=this.users.resolve(claims); if(!user) throw new GoliathError('ACCESS_DENIED','OIDC identity is not linked to an GOLIATH user.');
    const session=this.sessions.issue(user.userId,user.displayName);
    return {token:session,principal:this.sessions.verify(session)};
  }
}

export interface SecretMaterial { secret:string; keyId:string; }
export interface SecretResolver { resolve(reference:string):SecretMaterial|undefined; }
export class ManagedWebhookSecretProvider implements WebhookSecretProvider {
  constructor(private readonly db:any,private readonly resolver:SecretResolver){}
  get(bindingId:string):SecretMaterial|undefined{
    const row=this.db.prepare('SELECT secret_reference FROM integration_bindings_v2 WHERE id=?').get(bindingId);
    const ref=row?.secret_reference?String(row.secret_reference):'';
    return ref?this.resolver.resolve(ref):undefined;
  }
}

export interface ReconciliationItem { accountId:string; resourceType:string; externalId:string; eventId:string; sourceVersion:string; sourceEffectiveAt:string; payload:unknown; }
export interface ReconciliationPage { items:readonly ReconciliationItem[]; nextCursor?:string; }
export interface ProviderReconciliationClient { fetch(binding:RuntimeBindingRecord,cursor?:string):Promise<ReconciliationPage>; }

export class ProviderReconciliationService {
  constructor(private readonly repo:SqlProviderRuntimeRepository,private readonly adapters:Readonly<Record<string,ProviderWebhookAdapter>>,private readonly client:ProviderReconciliationClient,private readonly now:()=>Date=()=>new Date()){}
  async reconcile(bindingId:string,maxPages=50):Promise<{queued:number;duplicates:number;cursor?:string}>{
    const binding=this.repo.getBinding(bindingId); if(!binding) throw new GoliathError('NOT_FOUND','Provider binding not found.');
    if(!binding.enabled) throw new GoliathError('INTEGRATION_DISABLED','Provider binding is disabled.');
    const adapter=this.adapters[binding.provider]; if(!adapter) throw new GoliathError('NOT_FOUND','Provider adapter is unavailable.');
    let cursor=this.getCursor(bindingId); let lastValidCursor=cursor; let queued=0,duplicates=0;
    try{
      for(let pageNo=0;pageNo<maxPages;pageNo++){
        const page=await this.client.fetch(binding,cursor);
        for(const item of page.items){
          const receivedAt=this.now().toISOString();
          const headers={'x-goliath-account-id':item.accountId,'x-goliath-event-id':item.eventId,'x-goliath-effective-at':item.sourceEffectiveAt};
          const identity=adapter.identity(item.payload,headers,receivedAt);
          // Reconciliation owns immutable identity supplied by the authenticated provider client.
          if(identity.accountId!==item.accountId||identity.resourceType!==item.resourceType||identity.externalId!==item.externalId) throw new GoliathError('ACCESS_DENIED','Reconciliation identity does not match provider item.');
          const route=this.repo.resolveRoute(binding.id,item.accountId,item.resourceType,item.externalId); if(!route) throw new GoliathError('MAPPING_REQUIRED','Reconciliation item is not mapped.');
          if(route.organisationId!==binding.organisationId||route.projectId!==binding.projectId||route.providerEnvironment!==binding.environment) throw new GoliathError('ACCESS_DENIED','Reconciliation route is outside binding scope.');
          const normalized=adapter.normalize(route,{...identity,sourceVersion:item.sourceVersion,sourceEffectiveAt:item.sourceEffectiveAt},item.payload,receivedAt,`reconcile:${binding.id}:${item.eventId}`);
          const outcome=this.repo.enqueue({binding,identity:{...identity,sourceVersion:item.sourceVersion,sourceEffectiveAt:item.sourceEffectiveAt},payload:item.payload,normalisedEvent:normalized,payloadDigest:digest(item.payload),correlationId:normalized.correlationId});
          if(outcome==='conflict') throw new GoliathError('DUPLICATE_EVENT','Reconciliation event identity conflicts with accepted content.');
          outcome==='duplicate'?duplicates++:queued++;
        }
        if(page.nextCursor){ cursor=page.nextCursor; lastValidCursor=page.nextCursor; }
        this.setState(bindingId,lastValidCursor,'ok');
        if(!page.nextCursor||page.items.length===0) break;
      }
      return {queued,duplicates,...(lastValidCursor?{cursor:lastValidCursor}:{})};
    }catch(error){ this.setState(bindingId,lastValidCursor,'failed'); throw error; }
  }
  private getCursor(bindingId:string):string|undefined{const r=this.repo.db.prepare('SELECT reconciliation_cursor FROM integration_bindings_v2 WHERE id=?').get(bindingId);return r?.reconciliation_cursor?String(r.reconciliation_cursor):undefined;}
  private setState(bindingId:string,cursor:string|undefined,status:string):void{this.repo.db.prepare('UPDATE integration_bindings_v2 SET reconciliation_cursor=?,last_reconciled_at=?,last_reconciliation_status=?,updated_at=? WHERE id=?').run(cursor??null,this.now().toISOString(),status,this.now().toISOString(),bindingId);}
}

export interface ProductionReadinessEvidence {
  acceptanceIdentityDisabled:boolean;
  enterpriseOidcConfigured:boolean;
  managedSecretsConfigured:boolean;
  durableWorkerConfigured:boolean;
  productionDatabase:'managed-postgres'|'sqlite'|'other';
  postgresRuntimeAdapterVerified:boolean;
  reconciliationConfigured:boolean;
  observabilityConfigured:boolean;
  backupRestoreVerified:boolean;
  releaseSignatureVerified:boolean;
  tlsConfigured:boolean;
}
export class ProductionReadinessGate {
  evaluate(e:ProductionReadinessEvidence):{ready:boolean;blockers:readonly string[]}{
    const blockers:string[]=[];
    if(!e.acceptanceIdentityDisabled)blockers.push('Acceptance identity must be disabled.');
    if(!e.enterpriseOidcConfigured)blockers.push('Enterprise OIDC/SSO is not configured.');
    if(!e.managedSecretsConfigured)blockers.push('Managed secret resolution is not configured.');
    if(!e.durableWorkerConfigured)blockers.push('Durable worker runtime is not configured.');
    if(e.productionDatabase!=='managed-postgres')blockers.push('Production persistence must use the approved managed PostgreSQL profile.');
    if(!e.postgresRuntimeAdapterVerified)blockers.push('PostgreSQL runtime repository adapter is not verified.');
    if(!e.reconciliationConfigured)blockers.push('Provider reconciliation is not configured.');
    if(!e.observabilityConfigured)blockers.push('Operational observability is not configured.');
    if(!e.backupRestoreVerified)blockers.push('Backup/restore evidence is not verified.');
    if(!e.releaseSignatureVerified)blockers.push('Release signature is not verified.');
    if(!e.tlsConfigured)blockers.push('TLS is not configured.');
    return {ready:blockers.length===0,blockers};
  }
}

export class OperationalHealthService {
  constructor(private readonly repo:SqlProviderRuntimeRepository,private readonly now:()=>Date=()=>new Date()){}
  snapshot():{status:'healthy'|'degraded'|'blocked';queue:{queued:number;retryable:number;deadLetter:number;processing:number};staleBindings:readonly string[]}{
    const rows=this.repo.listInbox(); const queue={queued:rows.filter(x=>x.state==='queued').length,retryable:rows.filter(x=>x.state==='retryable').length,deadLetter:rows.filter(x=>x.state==='dead-letter').length,processing:rows.filter(x=>x.state==='processing').length};
    const cutoff=this.now().getTime()-24*3600_000;
    const bindings=this.repo.db.prepare('SELECT id,last_reconciled_at,last_reconciliation_status,enabled FROM integration_bindings_v2').all();
    const staleBindings=bindings.filter((r:any)=>Number(r.enabled)===1 && (!r.last_reconciled_at||Date.parse(String(r.last_reconciled_at))<cutoff||String(r.last_reconciliation_status??'')==='failed')).map((r:any)=>String(r.id));
    const status=queue.deadLetter>0?'blocked':(queue.retryable>0||queue.processing>0||staleBindings.length>0?'degraded':'healthy');
    return {status,queue,staleBindings};
  }
}
