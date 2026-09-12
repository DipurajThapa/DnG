import { randomUUID } from 'node:crypto';
import { digest } from '../core/hash.js';
import { GoliathError } from '../core/errors.js';
import type { ApplicationContextRequest } from '../application/context-boundary.js';
import { ActingContextBoundary } from '../application/context-boundary.js';
import { SqlProjectRepository } from '../project/sqlite-repository.js';
import { ProjectControlService } from '../project/service.js';
import type { EnterpriseProjectEvent } from '../events/types.js';

export interface MeetingProposal { kind:'action'|'risk'|'decision'; title:string; ownerId?:string; teamId?:string; dueAt?:string; confidence:'high'|'medium'|'low'; }
export interface MeetingProposalExtractor { extract(input:{projectId:string;transcriptRef:string;text:string}):Promise<readonly MeetingProposal[]>; }

export class MeetingIntelligenceService {
  constructor(private readonly boundary:ActingContextBoundary,private readonly repo:SqlProjectRepository,private readonly projectService:ProjectControlService,private readonly extractor:MeetingProposalExtractor,private readonly now:()=>Date=()=>new Date()){}
  async ingest(event:Extract<EnterpriseProjectEvent,{kind:'meeting.transcript.received'}>):Promise<number>{
    const proposals=await this.extractor.extract({projectId:event.projectId,transcriptRef:event.payload.transcriptRef,text:event.payload.text});
    let count=0;
    for(const proposal of proposals){
      const id=`meeting-proposal:${digest({projectId:event.projectId,sourceEventId:event.sourceEventId,kind:proposal.kind,title:proposal.title,ownerId:proposal.ownerId??null}).slice(0,40)}`;
      if(this.repo.getEvent(id)) continue;
      this.repo.appendEvent({id,projectId:event.projectId,actorId:'system:meeting-intelligence',eventType:'meeting.proposal',entityType:'meeting-proposal',entityId:id,result:'recorded',reason:'AI-extracted proposal recorded as non-authoritative pending human confirmation.',occurredAt:this.now().toISOString(),correlationId:event.correlationId,sourceRefs:[event.payload.transcriptRef],metadata:{...proposal,transcriptRef:event.payload.transcriptRef,authoritative:false}});count++;
    }
    return count;
  }
  confirm(request:ApplicationContextRequest,projectId:string,proposalId:string):{confirmed:boolean;createdId?:string}{
    const context=this.boundary.requireProjectAny(request,projectId,['project:manage','team:coordinate','decision:prepare']);
    const proposal=this.repo.getEvent(proposalId); if(!proposal||proposal.eventType!=='meeting.proposal'||proposal.projectId!==projectId) throw new GoliathError('NOT_FOUND','Meeting proposal not found.');
    if(this.repo.listEvents(projectId).some(e=>e.eventType==='meeting.proposal.confirmed'&&e.causationId===proposalId)) return {confirmed:true};
    const teamId=typeof proposal.metadata?.teamId==='string'?proposal.metadata.teamId:undefined;
    if((context.role==='delivery-lead'||context.role==='agile-delivery-lead')&&teamId&&context.teamId!==teamId) throw new GoliathError('ACCESS_DENIED','Team lead cannot confirm another team\'s meeting proposal.');
    const kind=String(proposal.metadata?.kind??''); const title=String(proposal.metadata?.title??'').trim(); if(!title) throw new GoliathError('INVALID_INPUT','Meeting proposal title is missing.');
    let createdId:string|undefined;
    if(kind==='action'){
      createdId=`meeting-action:${digest({proposalId}).slice(0,32)}`;
      this.projectService.createWorkAction({id:createdId,projectId,type:'manual',title,ownerId:typeof proposal.metadata?.ownerId==='string'?proposal.metadata.ownerId:request.userId,...(typeof proposal.metadata?.dueAt==='string'?{dueAt:proposal.metadata.dueAt}:{}),state:'open',createdBy:request.userId,createdAt:this.now().toISOString(),sourceRefs:proposal.sourceRefs,revision:1});
    } else if(kind==='risk'||kind==='decision') {
      createdId=`meeting-attention:${digest({proposalId}).slice(0,32)}`;
      const project=this.repo.getProject(projectId)!; const now=this.now().toISOString();
      this.repo.putAttention({id:createdId,organisationId:project.organisationId,projectId,rootCauseKey:`meeting:${proposalId}`,title,state:'open',consequence:kind==='decision'?'high':'medium',confidence:String(proposal.metadata?.confidence??'medium') as any,situation:'Confirmed meeting intelligence requires project follow-through.',impact:kind==='decision'?'A project decision is required.':'A confirmed project risk requires monitoring/correction.',ownerId:typeof proposal.metadata?.ownerId==='string'?proposal.metadata.ownerId:project.pmId,...(kind==='decision'&&project.sponsorId?{decisionOwnerId:project.sponsorId}:{}),nextAction:kind==='decision'?'decide':'correct',sourceSignalIds:[proposalId],sourceRefs:proposal.sourceRefs,firstSeenAt:now,lastSeenAt:now,revision:1});
    } else throw new GoliathError('INVALID_INPUT','Unsupported meeting proposal kind.');
    this.repo.appendEvent({id:randomUUID(),projectId,actorId:request.userId,eventType:'meeting.proposal.confirmed',entityType:'meeting-proposal',entityId:proposalId,result:'allowed',reason:'Human confirmed AI-extracted meeting proposal.',occurredAt:this.now().toISOString(),correlationId:`meeting-confirm:${proposalId}`,causationId:proposalId,sourceRefs:proposal.sourceRefs,metadata:{createdId:createdId??null,actingAssignmentId:request.actingAssignmentId}});
    return {confirmed:true,...(createdId?{createdId}:{})};
  }
}
