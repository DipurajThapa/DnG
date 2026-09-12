import { ActingContextBoundary, type ApplicationContextRequest } from './context-boundary.js';
import type { ApprovalEvidence, EffectIntent } from '../core/types.js';
import { IntegrationOrchestrator } from '../integrations/orchestrator.js';

export class ContextualOutboundEffects {
  constructor(private readonly boundary:ActingContextBoundary,private readonly orchestrator:IntegrationOrchestrator){}
  prepare(request:ApplicationContextRequest,input:{id?:string;bindingId:string;projectId:string;action:string;targetExternalId:string;targetResourceType:string;payload:Readonly<Record<string,unknown>>;correlationId:string;approval?:ApprovalEvidence}):EffectIntent{
    const ctx=this.boundary.requireProjectAny(request,input.projectId,['project:manage','team:coordinate']);
    return this.orchestrator.prepareEffect({actorId:request.userId,organisationId:ctx.accessibleOrganisationIds[0]!,projectIds:[input.projectId],permissions:['integration.effect.prepare']},input);
  }
  async dispatch(request:ApplicationContextRequest,projectId:string,intentId:string):Promise<EffectIntent>{
    const ctx=this.boundary.requireProjectAny(request,projectId,['project:manage','team:coordinate']);
    return this.orchestrator.dispatch({actorId:request.userId,organisationId:ctx.accessibleOrganisationIds[0]!,projectIds:[projectId],permissions:['integration.effect.dispatch']},intentId);
  }
}
