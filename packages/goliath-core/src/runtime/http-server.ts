import { createServer } from 'node:http';
import { GoliathError } from '../core/errors.js';
import type { ApplicationContextRequest } from '../application/context-boundary.js';
import { ContextualProjectApplication } from '../application/project-application.js';
import { EnterpriseContextService } from '../context/service.js';
import { RoleExperienceService } from '../experience/service.js';
import { ResourceCapacityService } from '../resource/service.js';
import { AcceptanceIdentityProvider, HmacSessionService, type RuntimePrincipal } from './auth.js';
import { PHASE5_RUNTIME_HTML } from './ui.js';
import { ProviderQueueWorker, ProviderWebhookGateway, type RuntimeProvider } from './provider-runtime.js';

export interface RuntimeHttpServices {
  identity?: AcceptanceIdentityProvider;
  enterpriseIdentity?: { login(token:string): Promise<{token:string;principal:RuntimePrincipal}> };
  readiness?: () => {ready:boolean;blockers:readonly string[]};
  sessions: HmacSessionService;
  contexts: EnterpriseContextService;
  experiences: RoleExperienceService;
  projectApp: ContextualProjectApplication;
  resources: ResourceCapacityService;
  webhooks: ProviderWebhookGateway;
  queue: ProviderQueueWorker;
  control?: { run(projectId:string): Promise<unknown> };
}

function send(res:any,status:number,body:unknown,contentType='application/json'):void {
  res.statusCode=status; res.setHeader('content-type',contentType);
  res.setHeader('cache-control','no-store');
  res.end(contentType==='application/json'?JSON.stringify(body):String(body));
}
function headers(req:any):Record<string,string>{const out:Record<string,string>={};for(const [k,v] of Object.entries(req.headers??{})){if(typeof v==='string')out[k.toLowerCase()]=v;else if(Array.isArray(v))out[k.toLowerCase()]=v.join(',');}return out;}
async function body(req:any,maxBytes=1_048_576):Promise<string>{let text='';for await(const chunk of req){text+=String(chunk);if(text.length>maxBytes)throw new GoliathError('INVALID_INPUT','Request body is too large.');}return text;}
function json(raw:string):any{try{return raw?JSON.parse(raw):{};}catch{throw new GoliathError('INVALID_INPUT','Request body must be JSON.');}}
function asObject(value:unknown,label:string):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))throw new GoliathError('INVALID_INPUT',`${label} must be an object.`);return value as Record<string,any>;}
function bearer(req:any,sessions:HmacSessionService):RuntimePrincipal{const h=String(req.headers?.authorization??'');if(!h.startsWith('Bearer '))throw new GoliathError('ACCESS_DENIED','Authentication is required.');return sessions.verify(h.slice(7));}
function contextRequest(principal:RuntimePrincipal,assignmentId:unknown):ApplicationContextRequest{if(typeof assignmentId!=='string'||!assignmentId.trim())throw new GoliathError('ACCESS_DENIED','actingAssignmentId is required.');return {userId:principal.userId,actingAssignmentId:assignmentId};}
function statusFor(error:unknown):number{if(!(error instanceof GoliathError))return 500; if(error.code==='ACCESS_DENIED')return 403;if(error.code==='NOT_FOUND'||error.code==='MAPPING_REQUIRED')return 404;if(error.code==='DUPLICATE_EVENT')return 409;if(error.code==='INTEGRATION_DISABLED')return 503;return 400;}

export class GoliathRuntimeHttpServer {
  private server:any;
  constructor(private readonly services:RuntimeHttpServices){}
  async listen(port=0,host='127.0.0.1'):Promise<{port:number;url:string}>{
    this.server=createServer((req:any,res:any)=>this.handle(req,res));
    await new Promise<void>((resolve,reject)=>{this.server.once('error',reject);this.server.listen(port,host,()=>resolve());});
    const address=this.server.address();const actual=typeof address==='object'&&address?Number(address.port):port;return {port:actual,url:`http://${host}:${actual}`};
  }
  async close():Promise<void>{if(!this.server)return;await new Promise<void>((resolve,reject)=>this.server.close((e:any)=>e?reject(e):resolve()));this.server=undefined;}

  private async handle(req:any,res:any):Promise<void>{
    try{
      const url=new URL(String(req.url??'/'),'http://runtime.local'); const path=url.pathname; const method=String(req.method??'GET').toUpperCase();
      if(method==='GET'&&path==='/'){send(res,200,PHASE5_RUNTIME_HTML,'text/html; charset=utf-8');return;}
      if(method==='GET'&&path==='/health'){send(res,200,{status:'ok',phase:5});return;}
      if(method==='GET'&&path==='/live'){send(res,200,{status:'live'});return;}
      if(method==='GET'&&path==='/ready'){const r=this.services.readiness?.()??{ready:true,blockers:[]};send(res,r.ready?200:503,r);return;}
      if(method==='POST'&&path==='/auth/login'){
        if(!this.services.identity)throw new GoliathError('ACCESS_DENIED','Acceptance login is disabled.');
        const b=json(await body(req)); const result=this.services.identity.login(String(b.userId??''),String(b.password??''));send(res,200,result);return;
      }
      if(method==='POST'&&path==='/auth/oidc'){
        if(!this.services.enterpriseIdentity)throw new GoliathError('INTEGRATION_DISABLED','Enterprise OIDC is not configured.');
        const b=json(await body(req)); const result=await this.services.enterpriseIdentity.login(String(b.token??''));send(res,200,result);return;
      }
      if(method==='POST'&&path.startsWith('/webhooks/')){
        const [, , providerRaw,bindingId]=path.split('/'); if(!providerRaw||!bindingId)throw new GoliathError('INVALID_INPUT','Webhook provider and binding are required.');
        const raw=await body(req); const result=this.services.webhooks.receive({provider:providerRaw as RuntimeProvider,bindingId,headers:headers(req),rawBody:raw}); send(res,result.status==='queued'?202:200,result);return;
      }
      const principal=bearer(req,this.services.sessions);
      if(method==='GET'&&path==='/api/contexts'){
        send(res,200,{contexts:this.services.contexts.listActingContexts(principal.userId)});return;
      }
      if(method==='GET'&&path==='/api/workspace'){
        const request=contextRequest(principal,url.searchParams.get('actingAssignmentId')); const projectId=url.searchParams.get('projectId')??undefined;
        const workspace=this.services.experiences.build(request,projectId?{projectId}:{});send(res,200,workspace);return;
      }
      const assign=path.match(/^\/api\/projects\/([^/]+)\/activities\/([^/]+)\/assign$/);
      if(method==='POST'&&assign){
        const b=json(await body(req));const request=contextRequest(principal,b.actingAssignmentId);const projectId=decodeURIComponent(assign[1]!);const record=this.services.projectApp.assignActivity(request,projectId,decodeURIComponent(assign[2]!),String(b.assigneeId??''),typeof b.reason==='string'?b.reason:undefined);await this.services.control?.run(projectId);send(res,200,record);return;
      }
      const update=path.match(/^\/api\/projects\/([^/]+)\/activities\/([^/]+)\/update$/);
      if(method==='POST'&&update){
        const b=json(await body(req));const request=contextRequest(principal,b.actingAssignmentId);const projectId=decodeURIComponent(update[1]!);const record=this.services.projectApp.updateActivity(request,projectId,decodeURIComponent(update[2]!),asObject(b.update,'update'));await this.services.control?.run(projectId);send(res,200,record);return;
      }
      const decide=path.match(/^\/api\/projects\/([^/]+)\/decisions\/([^/]+)\/decide$/);
      if(method==='POST'&&decide){
        const b=json(await body(req));const request=contextRequest(principal,b.actingAssignmentId);const projectId=decodeURIComponent(decide[1]!);const record=this.services.projectApp.decide(request,projectId,decodeURIComponent(decide[2]!),String(b.choice??''),String(b.state??'approved') as any,String(b.reason??''));await this.services.control?.run(projectId);send(res,200,record);return;
      }
      const createHandoff=path.match(/^\/api\/projects\/([^/]+)\/handoffs$/);
      if(method==='POST'&&createHandoff){
        const b=json(await body(req));const request=contextRequest(principal,b.actingAssignmentId);const projectId=decodeURIComponent(createHandoff[1]!);
        const handoff=asObject(b.handoff,'handoff') as any;
        const record=this.services.projectApp.createHandoff(request,projectId,handoff);await this.services.control?.run(projectId);send(res,200,record);return;
      }
      const handoff=path.match(/^\/api\/projects\/([^/]+)\/handoffs\/([^/]+)\/respond$/);
      if(method==='POST'&&handoff){
        const b=json(await body(req));const request=contextRequest(principal,b.actingAssignmentId);const projectId=decodeURIComponent(handoff[1]!);const state=String(b.state??'');
        if(state!=='accepted'&&state!=='returned')throw new GoliathError('INVALID_INPUT','Handoff state must be accepted or returned.');
        const record=this.services.projectApp.respondToHandoff(request,projectId,decodeURIComponent(handoff[2]!),{state, ...(typeof b.reason==='string'&&b.reason.trim()?{reason:b.reason}: {})});await this.services.control?.run(projectId);send(res,200,record);return;
      }
      if(method==='POST'&&path==='/api/resources/demands'){
        const b=json(await body(req));const request=contextRequest(principal,b.actingAssignmentId);const demand=asObject(b.demand,'demand') as any;const record=this.services.resources.requestDemand(request,demand);await this.services.control?.run(String(demand.projectId));send(res,200,record);return;
      }
      if(method==='POST'&&path==='/api/resources/allocations'){
        const b=json(await body(req));const request=contextRequest(principal,b.actingAssignmentId);const allocation=asObject(b.allocation,'allocation') as any;const record=this.services.resources.allocate(request,allocation);await this.services.control?.run(String(allocation.projectId));send(res,200,record);return;
      }
      if(method==='POST'&&path==='/api/admin/responsibilities/grant'){
        const b=json(await body(req));const request=contextRequest(principal,b.actingAssignmentId);const ctx=this.services.contexts.resolveActingContext(request.userId,request.actingAssignmentId);
        if(ctx.role!=='enterprise-admin'||!ctx.permissions.includes('context:admin'))throw new GoliathError('ACCESS_DENIED','Enterprise administrator context is required.');
        const assignment=asObject(b.assignment,'assignment') as any;const record=this.services.contexts.grantResponsibility(assignment,principal.userId);send(res,200,record);return;
      }
      const revoke=path.match(/^\/api\/admin\/responsibilities\/([^/]+)\/revoke$/);
      if(method==='POST'&&revoke){
        const b=json(await body(req));const request=contextRequest(principal,b.actingAssignmentId);const ctx=this.services.contexts.resolveActingContext(request.userId,request.actingAssignmentId);
        if(ctx.role!=='enterprise-admin'||!ctx.permissions.includes('context:admin'))throw new GoliathError('ACCESS_DENIED','Enterprise administrator context is required.');
        const record=this.services.contexts.revokeResponsibility(decodeURIComponent(revoke[1]!),principal.userId,String(b.reason??''));send(res,200,record);return;
      }
      if(method==='POST'&&path==='/internal/queue/drain'){
        const b=json(await body(req));const request=contextRequest(principal,b.actingAssignmentId);const ctx=this.services.contexts.resolveActingContext(request.userId,request.actingAssignmentId);
        if(ctx.role!=='enterprise-admin'||!ctx.permissions.includes('context:admin'))throw new GoliathError('ACCESS_DENIED','Enterprise administrator context is required.');
        send(res,200,await this.services.queue.drain(typeof b.limit==='number'?b.limit:25));return;
      }
      send(res,404,{message:'Not found.'});
    }catch(error){send(res,statusFor(error),{code:error instanceof GoliathError?error.code:'INTERNAL_ERROR',message:error instanceof Error?error.message:'Unexpected runtime error.'});}
  }
}
