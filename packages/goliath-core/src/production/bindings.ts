import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { GoliathError } from '../core/errors.js';
import type { OidcTokenVerifier, SecretMaterial, SecretResolver, VerifiedOidcClaims } from './runtime.js';

interface OidcDiscovery { issuer?: unknown; jwks_uri?: unknown; }
interface JsonWebKeyLike { kid?: unknown; kty?: unknown; alg?: unknown; use?: unknown; [key:string]:unknown; }

export interface FetchResponseLike {
  ok:boolean;
  status:number;
  json():Promise<unknown>;
}
export type FetchLike=(url:string,init?:{method?:string;headers?:Readonly<Record<string,string>>})=>Promise<FetchResponseLike>;

function b64urlJson(segment:string,label:string):Record<string,unknown>{
  try {
    const value=JSON.parse(Buffer.from(segment,'base64url').toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('not object');
    return value as Record<string,unknown>;
  } catch { throw new GoliathError('ACCESS_DENIED',`OIDC ${label} is invalid.`); }
}
function requiredClaim(payload:Record<string,unknown>,name:string):string{
  const v=payload[name]; if(typeof v!=='string'||!v.trim()) throw new GoliathError('ACCESS_DENIED',`OIDC ${name} claim is required.`); return v;
}
function audiences(payload:Record<string,unknown>):readonly string[]{
  const aud=payload.aud; if(typeof aud==='string')return [aud]; if(Array.isArray(aud)&&aud.every(x=>typeof x==='string'))return aud as string[]; throw new GoliathError('ACCESS_DENIED','OIDC aud claim is invalid.');
}

/** Minimal production RS256 OIDC/JWKS verifier. It validates discovery, signature, issuer, audience and token time bounds. */
export class RemoteJwksOidcVerifier implements OidcTokenVerifier {
  private discovery?:{value:{issuer:string;jwksUri:string};expiresAt:number};
  private jwks?:{value:readonly JsonWebKeyLike[];expiresAt:number};
  constructor(
    private readonly issuer:string,
    private readonly audience:string,
    private readonly fetcher:FetchLike=(url,init)=>fetch(url,init) as Promise<FetchResponseLike>,
    private readonly now:()=>Date=()=>new Date(),
    private readonly cacheTtlMs=300_000,
    private readonly clockSkewSeconds=60,
  ){
    if(!issuer.startsWith('https://'))throw new GoliathError('INVALID_INPUT','OIDC issuer must use HTTPS.');
    if(!audience.trim())throw new GoliathError('INVALID_INPUT','OIDC audience is required.');
  }
  async verify(token:string):Promise<VerifiedOidcClaims>{
    const parts=token.split('.'); if(parts.length!==3||parts.some(x=>!x))throw new GoliathError('ACCESS_DENIED','OIDC token is malformed.');
    const [h,p,s]=parts as [string,string,string]; const header=b64urlJson(h,'header'); const payload=b64urlJson(p,'payload');
    if(header.alg!=='RS256')throw new GoliathError('ACCESS_DENIED','Only RS256 OIDC tokens are accepted by this verifier.');
    const kid=typeof header.kid==='string'?header.kid:''; if(!kid)throw new GoliathError('ACCESS_DENIED','OIDC signing key id is missing.');
    const discovered=await this.getDiscovery();
    if(discovered.issuer!==this.issuer)throw new GoliathError('ACCESS_DENIED','OIDC discovery issuer does not match configured issuer.');
    const key=(await this.getJwks(discovered.jwksUri)).find(k=>k.kid===kid&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
    if(!key)throw new GoliathError('ACCESS_DENIED','OIDC signing key is not trusted.');
    let publicKey:any; try{ publicKey=createPublicKey({key,format:'jwk'} as any); }catch{throw new GoliathError('ACCESS_DENIED','OIDC signing key is invalid.');}
    const valid=verifySignature('RSA-SHA256',Buffer.from(`${h}.${p}`),publicKey,Buffer.from(s,'base64url'));
    if(!valid)throw new GoliathError('ACCESS_DENIED','OIDC token signature is invalid.');
    const iss=requiredClaim(payload,'iss'); if(iss!==this.issuer)throw new GoliathError('ACCESS_DENIED','OIDC issuer is not trusted.');
    if(!audiences(payload).includes(this.audience))throw new GoliathError('ACCESS_DENIED','OIDC audience is not trusted.');
    const nowSec=Math.floor(this.now().getTime()/1000), skew=this.clockSkewSeconds;
    const exp=payload.exp; if(typeof exp!=='number'||!Number.isFinite(exp)||exp<=nowSec-skew)throw new GoliathError('ACCESS_DENIED','OIDC token has expired.');
    const nbf=payload.nbf; if(nbf!==undefined&&(typeof nbf!=='number'||!Number.isFinite(nbf)||nbf>nowSec+skew))throw new GoliathError('ACCESS_DENIED','OIDC token is not active yet.');
    const email=requiredClaim(payload,'email'); const subject=requiredClaim(payload,'sub');
    const emailVerified=payload.email_verified===true;
    const displayName=typeof payload.name==='string'&&payload.name.trim()?payload.name:(typeof payload.preferred_username==='string'&&payload.preferred_username.trim()?payload.preferred_username:email);
    return {issuer:iss,audience:this.audience,subject,email,emailVerified,displayName,expiresAt:new Date(exp*1000).toISOString()};
  }
  private async getDiscovery():Promise<{issuer:string;jwksUri:string}>{
    const now=this.now().getTime(); if(this.discovery&&this.discovery.expiresAt>now)return this.discovery.value;
    const base=this.issuer.endsWith('/')?this.issuer.slice(0,-1):this.issuer; const response=await this.fetcher(`${base}/.well-known/openid-configuration`);
    if(!response.ok)throw new GoliathError('ACCESS_DENIED',`OIDC discovery failed (${response.status}).`);
    const body=await response.json() as OidcDiscovery; if(typeof body.issuer!=='string'||typeof body.jwks_uri!=='string'||!body.jwks_uri.startsWith('https://'))throw new GoliathError('ACCESS_DENIED','OIDC discovery document is incomplete.');
    const value={issuer:body.issuer,jwksUri:body.jwks_uri}; this.discovery={value,expiresAt:now+this.cacheTtlMs}; return value;
  }
  private async getJwks(uri:string):Promise<readonly JsonWebKeyLike[]>{
    const now=this.now().getTime(); if(this.jwks&&this.jwks.expiresAt>now)return this.jwks.value;
    const response=await this.fetcher(uri); if(!response.ok)throw new GoliathError('ACCESS_DENIED',`OIDC JWKS retrieval failed (${response.status}).`);
    const body=await response.json() as any; if(!body||!Array.isArray(body.keys))throw new GoliathError('ACCESS_DENIED','OIDC JWKS response is invalid.');
    const value=body.keys as readonly JsonWebKeyLike[]; this.jwks={value,expiresAt:now+this.cacheTtlMs}; return value;
  }
}

/** Production-safe fallback for hosts that inject secrets from a managed secret store into process env. DB records keep only env:NAME references. */
export class EnvironmentSecretResolver implements SecretResolver {
  constructor(private readonly environment:Readonly<Record<string,string|undefined>>=process.env){}
  resolve(reference:string):SecretMaterial|undefined{
    if(!reference.startsWith('env:'))return undefined;
    const name=reference.slice(4); if(!/^[A-Z][A-Z0-9_]{2,127}$/.test(name))return undefined;
    const secret=this.environment[name]; if(!secret)return undefined;
    return {secret,keyId:this.environment[`${name}_KEY_ID`]||`env:${name}`};
  }
}

export interface ProductionBindingConfiguration {
  oidcIssuer:string;
  oidcAudience:string;
  sessionSecretReference:string;
  databaseUrlPresent:boolean;
  persistenceDriver:'postgres-sync'|'sqlite'|'unknown';
  workerEnabled:boolean;
  observabilityConfigured:boolean;
  tlsRequired:boolean;
}
function bindingEnv(environment:Readonly<Record<string,string|undefined>>,preferred:string,legacy:string):string|undefined{
  // Prefer Goliath configuration. Legacy EDAPOS keys remain read-only fallbacks during deployment migration.
  return environment[preferred]??environment[legacy];
}
export function readProductionBindingConfiguration(environment:Readonly<Record<string,string|undefined>>=process.env):ProductionBindingConfiguration{
  const oidcIssuer=bindingEnv(environment,'GOLIATH_OIDC_ISSUER','EDAPOS_OIDC_ISSUER')?.trim()??'';
  const oidcAudience=bindingEnv(environment,'GOLIATH_OIDC_AUDIENCE','EDAPOS_OIDC_AUDIENCE')?.trim()??'';
  const sessionSecretReference=bindingEnv(environment,'GOLIATH_SESSION_SECRET_REF','EDAPOS_SESSION_SECRET_REF')?.trim()??'';
  const driver=bindingEnv(environment,'GOLIATH_PERSISTENCE_DRIVER','EDAPOS_PERSISTENCE_DRIVER')?.trim();
  const persistenceDriver=driver==='postgres-sync'||driver==='sqlite'?driver:'unknown';
  return {oidcIssuer,oidcAudience,sessionSecretReference,databaseUrlPresent:Boolean(environment.DATABASE_URL?.trim()),persistenceDriver,workerEnabled:bindingEnv(environment,'GOLIATH_WORKER_ENABLED','EDAPOS_WORKER_ENABLED')==='true',observabilityConfigured:Boolean(bindingEnv(environment,'GOLIATH_OBSERVABILITY_SINK','EDAPOS_OBSERVABILITY_SINK')?.trim()),tlsRequired:bindingEnv(environment,'GOLIATH_REQUIRE_TLS','EDAPOS_REQUIRE_TLS')!=='false'};
}
export function assertProductionBindingConfiguration(config:ProductionBindingConfiguration):void{
  const missing:string[]=[];
  if(!config.oidcIssuer.startsWith('https://'))missing.push('GOLIATH_OIDC_ISSUER');
  if(!config.oidcAudience)missing.push('GOLIATH_OIDC_AUDIENCE');
  if(!config.sessionSecretReference)missing.push('GOLIATH_SESSION_SECRET_REF');
  if(!config.databaseUrlPresent)missing.push('DATABASE_URL');
  if(config.persistenceDriver!=='postgres-sync')missing.push('GOLIATH_PERSISTENCE_DRIVER=postgres-sync');
  if(!config.workerEnabled)missing.push('GOLIATH_WORKER_ENABLED=true');
  if(!config.observabilityConfigured)missing.push('GOLIATH_OBSERVABILITY_SINK');
  if(!config.tlsRequired)missing.push('GOLIATH_REQUIRE_TLS');
  if(missing.length)throw new GoliathError('INVALID_INPUT',`Production configuration is incomplete: ${missing.join(', ')}.`);
}
