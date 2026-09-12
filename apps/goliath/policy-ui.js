import { createClient } from 'https://esm.sh/@neondatabase/neon-js@0.7.0-beta';
import { runtimeConfig } from './runtime-config.js';

const client=createClient({auth:{url:runtimeConfig.authUrl,allowAnonymous:false},dataApi:{url:runtimeConfig.dataApiUrl}});
let assignmentId=null;
let capabilityMap=new Map();
let loading=false;

const actionMap=[
  ['confirmCandidate','commitment.confirm-candidate'],
  ['activateCommitment','commitment.activate'],
  ['setEvidenceSpec','commitment.set-evidence-spec'],
  ['setMethodology','workstream.set-methodology'],
  ['newDecision','decision.create'],
  ['newDependency','dependency.create'],
  ['ackDependency','dependency.acknowledge'],
  ['pmAssessment','health.pm-assessment'],
  ['snapshotReport','report.snapshot'],
  ['allocateDemand','capacity.allocate'],
  ['inviteIdentity','identity.invite'],
  ['goliathInviteRoleHolder','identity.invite'],
  ['grantResponsibility','responsibility.grant'],
  ['revokeResponsibility','responsibility.revoke'],
  ['dataClassOverride','access.data-class-override'],
  ['govCreateRequirement','requirement.create'],
  ['govBaselineRequirement','requirement.baseline'],
  ['govLinkRequirement','requirement.link'],
  ['govAcceptRequirement','requirement.accept'],
  ['govCreateRaid','raid.create-issue'],
  ['govEvaluateRaid','raid.evaluate-triggers'],
  ['govUpdateRaid','raid.update'],
  ['govConvertTrigger','raid.convert-trigger'],
  ['govSubmitBaseline','baseline.submit'],
  ['govFinalizeBaseline','baseline.finalize'],
  ['govCreateChange','change.create'],
  ['govPrepareChange','change.prepare'],
  ['govFinalizeChange','change.finalize'],
  ['pmoRecordEffort','outcome.admin-effort-sample'],
  ['diagCreateReconciliationIssue','integration.reconcile-exception'],
  ['diagRespondReconciliationIssue','integration.reconcile-exception']
];

function key(objectType,action){return `${objectType}.${action}`;}
async function rpc(name,payload={}){const {data,error}=await client.rpc(name,payload);if(error)throw new Error(error.message||String(error));return data;}
function currentAssignment(){return document.getElementById('contextSelect')?.value||null;}
function actionForOnclick(text=''){
  for(const [fn,cap] of actionMap){if(text.includes(`${fn}(`)||text.includes(`${fn}()`))return cap;}
  return null;
}
function effectiveMode(cap){return capabilityMap.get(cap)||'deny';}

async function refreshCapabilities(){
  const id=currentAssignment();
  if(!id){assignmentId=null;capabilityMap.clear();applyPolicy();return;}
  if(loading)return;
  loading=true;
  try{
    const model=await rpc('my_capabilities',{p_assignment_id:id});
    assignmentId=id;capabilityMap=new Map();
    for(const c of Array.isArray(model?.capabilities)?model.capabilities:[]){capabilityMap.set(key(c.objectType,c.action),c.effectiveMode||'deny');}
  }catch(_e){assignmentId=id;capabilityMap.clear();}
  finally{loading=false;applyPolicy();}
}

function applyPolicy(){
  document.querySelectorAll('button[onclick]').forEach(button=>{
    const cap=actionForOnclick(button.getAttribute('onclick')||'');
    if(!cap)return;
    const mode=effectiveMode(cap);
    const denied=mode==='deny';
    button.hidden=denied;
    button.dataset.capability=cap;
    button.dataset.authorityMode=mode;
    if(mode==='conditional')button.title=button.title||'Available only when the object-specific ownership condition is satisfied.';
  });

  // Buttons created with event listeners rather than inline onclick.
  const invite=document.querySelector('#inviteContinue');
  if(invite){const m=effectiveMode('identity.invite');invite.hidden=m==='deny';invite.dataset.authorityMode=m;}
  const record=document.querySelector('[onclick="pmoRecordEffort()"]');
  if(record)record.hidden=effectiveMode('outcome.admin-effort-sample')==='deny';
}

function attach(){
  const id=currentAssignment();
  if(id&&id!==assignmentId){refreshCapabilities();return;}
  applyPolicy();
}

new MutationObserver(attach).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('change',e=>{if(e.target?.id==='contextSelect')setTimeout(refreshCapabilities,0);},true);
attach();
