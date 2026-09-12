import { createHmac, timingSafeEqual } from 'node:crypto';
import { GoliathError } from '../core/errors.js';

export interface RuntimePrincipal {
  userId: string;
  displayName: string;
  issuedAt: string;
  expiresAt: string;
}

export interface AcceptanceUser {
  userId: string;
  displayName: string;
  password: string;
}

function b64url(input:string):string { return Buffer.from(input,'utf8').toString('base64url'); }
function fromB64url(input:string):string { return Buffer.from(input,'base64url').toString('utf8'); }
function safeEqual(a:string,b:string):boolean { const ab=Buffer.from(a); const bb=Buffer.from(b); return ab.length===bb.length && timingSafeEqual(ab,bb); }

export class HmacSessionService {
  constructor(private readonly secret:string,private readonly now:()=>Date=()=>new Date(),private readonly ttlSeconds=3600){ if(secret.length<24) throw new GoliathError('INVALID_INPUT','Session signing secret must be at least 24 characters.'); }
  issue(userId:string,displayName:string):string {
    const issuedAt=this.now(); const expiresAt=new Date(issuedAt.getTime()+this.ttlSeconds*1000);
    const payload=b64url(JSON.stringify({userId,displayName,issuedAt:issuedAt.toISOString(),expiresAt:expiresAt.toISOString()}));
    const signature=createHmac('sha256',this.secret).update(payload).digest('hex');
    return `${payload}.${signature}`;
  }
  verify(token:string):RuntimePrincipal {
    const [payload,signature,...extra]=token.split('.');
    if(!payload||!signature||extra.length) throw new GoliathError('ACCESS_DENIED','Session token is malformed.');
    const expected=createHmac('sha256',this.secret).update(payload).digest('hex');
    if(!safeEqual(expected,signature)) throw new GoliathError('ACCESS_DENIED','Session signature is invalid.');
    let parsed:any; try{parsed=JSON.parse(fromB64url(payload));}catch{throw new GoliathError('ACCESS_DENIED','Session payload is invalid.');}
    if(typeof parsed.userId!=='string'||!parsed.userId.trim()||typeof parsed.displayName!=='string'||typeof parsed.expiresAt!=='string'||typeof parsed.issuedAt!=='string') throw new GoliathError('ACCESS_DENIED','Session identity is incomplete.');
    if(!Number.isFinite(Date.parse(parsed.expiresAt))||Date.parse(parsed.expiresAt)<=this.now().getTime()) throw new GoliathError('ACCESS_DENIED','Session has expired.');
    return parsed as RuntimePrincipal;
  }
}

/** Test/demo identity provider only. Production runtime should replace this with enterprise OIDC/SSO. */
export class AcceptanceIdentityProvider {
  private readonly users=new Map<string,AcceptanceUser>();
  constructor(users:readonly AcceptanceUser[],private readonly sessions:HmacSessionService){ for(const user of users)this.users.set(user.userId,user); }
  login(userId:string,password:string):{token:string;principal:RuntimePrincipal}{
    const user=this.users.get(userId); if(!user||!safeEqual(user.password,password)) throw new GoliathError('ACCESS_DENIED','Invalid credentials.');
    const token=this.sessions.issue(user.userId,user.displayName); return {token,principal:this.sessions.verify(token)};
  }
}
