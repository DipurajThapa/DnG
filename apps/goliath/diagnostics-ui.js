import { createClient } from 'https://esm.sh/@neondatabase/neon-js@0.7.0-beta';
import { runtimeConfig } from './runtime-config.js';

const client=createClient({auth:{url:runtimeConfig.authUrl,allowAnonymous:false},dataApi:{url:runtimeConfig.dataApiUrl}});
const loading=new Set();

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function arr(v){return Array.isArray(v)?v:[];}
async function rpc(name,payload={}){const {data,error}=await client.rpc(name,payload);if(error)throw new Error(error.message||String(error));return data;}
function ctx(){return document.getElementById('contextSelect')?.value||null;}
function badge(v){const s=String(v||'unknown').toLowerCase();const cls=['critical','high','gaps','stale','error'].includes(s)?'bad':['complete-current','current','resolved'].includes(s)?'good':'warn';return `<span class="badge ${cls}">${esc(v||'—')}</span>`;}
function pct(v){return v==null?'—':`${Number(v).toFixed(1)}%`;}

async function loadEvidence(projectId,targetId='evidenceDiagnosticsPanel'){
  const assignment=ctx();if(!assignment||!projectId||loading.has(targetId))return;
  loading.add(targetId);
  try{
    const model=await rpc('evidence_gap_diagnostics',{p_assignment_id:assignment,p_project_id:projectId});
    renderEvidence(model,targetId);
  }catch(e){document.getElementById(targetId)?.remove();}
  finally{loading.delete(targetId);}
}

function renderEvidence(model,targetId){
  document.getElementById(targetId)?.remove();
  const view=document.getElementById('view');if(!view)return;
  const panel=document.createElement('div');panel.id=targetId;panel.className='panel table-wrap';
  const s=model?.summary||{},items=arr(model?.commitments);
  panel.innerHTML=`<h3>Evidence coverage diagnostics</h3><p class="muted">Coverage is calculated only from visible governed evidence that matches the commitment evidence specification. Restricted evidence is counted but not exposed.</p>
  <div class="grid"><div class="card"><span>Controlled commitments</span><strong>${s.controlledCommitments??0}</strong></div><div class="card"><span>With any evidence</span><strong>${s.withAnyEvidence??0}</strong></div><div class="card"><span>Missing evidence spec</span><strong>${s.withoutEvidenceSpec??0}</strong></div><div class="card"><span>Stale evidence rows</span><strong>${s.staleEvidenceRows??0}</strong></div></div>
  <table style="margin-top:14px"><thead><tr><th>Commitment</th><th>State</th><th>Required</th><th>Present</th><th>Missing</th><th>Stale</th><th>Coverage</th><th>Current</th></tr></thead><tbody>${items.map(x=>`<tr><td><b>${esc(x.title)}</b><div class="muted">${esc(x.commitmentId)}</div></td><td>${badge(x.dataState)}</td><td>${esc(arr(x.requiredKinds).join(', ')||'none')}</td><td>${esc(arr(x.presentKinds).join(', ')||'none')}</td><td>${esc(arr(x.missingKinds).join(', ')||'—')}</td><td>${esc(arr(x.staleKinds).join(', ')||'—')}</td><td>${pct(x.coveragePercent)}</td><td>${pct(x.currentCoveragePercent)}${x.restrictedEvidenceCount?`<div class="muted">${x.restrictedEvidenceCount} restricted row(s)</div>`:''}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">No controlled commitments exist yet. Evidence diagnostics will activate after commitment confirmation and evidence-specification setup.</td></tr>'}</tbody></table>`;
  view.appendChild(panel);
}

async function loadPmoDiagnostics(projectId){
  const assignment=ctx();const view=document.getElementById('view');if(!assignment||!projectId||!view||loading.has('pmoReconDiagnostics'))return;
  loading.add('pmoReconDiagnostics');
  try{
    const [recon,evidence]=await Promise.all([
      rpc('integration_reconciliation_queue',{p_assignment_id:assignment,p_project_id:projectId}),
      rpc('evidence_gap_diagnostics',{p_assignment_id:assignment,p_project_id:projectId})
    ]);
    renderPmoDiagnostics(recon,evidence,projectId);
  }catch(e){document.getElementById('pmoReconDiagnostics')?.remove();}
  finally{loading.delete('pmoReconDiagnostics');}
}

function renderPmoDiagnostics(recon,evidence,projectId){
  document.getElementById('pmoReconDiagnostics')?.remove();
  const view=document.getElementById('view');if(!view)return;
  const panel=document.createElement('div');panel.id='pmoReconDiagnostics';panel.className='panel';
  const s=recon?.summary||{},issues=arr(recon?.issues),unaccounted=arr(recon?.unaccountedInbox),es=evidence?.summary||{};
  panel.innerHTML=`<h3>Reconciliation & evidence exceptions</h3><p class="muted">Connector records must be reconciled, explicitly queued for human resolution, or remain visibly unprocessed. Goliath does not silently discard ambiguous records.</p>
    <div class="grid"><div class="card"><span>Open reconciliation issues</span><strong>${s.openIssues??0}</strong></div><div class="card"><span>Ambiguous matches</span><strong>${s.ambiguousMatches??0}</strong></div><div class="card"><span>Unmapped objects</span><strong>${s.unmappedObjects??0}</strong></div><div class="card"><span>Unaccounted inbox</span><strong>${s.unaccountedInbox??0}</strong></div></div>
    <div class="panel" style="margin-top:14px"><h3>Human reconciliation queue</h3>${issues.map(i=>`<div class="timeline"><div><b>${esc(i.issueType)} · ${esc(i.summary)}</b><div class="muted">${esc(i.provider||'provider')} · ${esc(i.domain||'domain')} · ${esc(i.detectedAt||'')}</div></div><div>${badge(i.severity)} <button class="mini secondary" onclick="goliathReconRespond('${esc(i.id)}','acknowledge')">Acknowledge</button> <button class="mini" onclick="goliathReconRespond('${esc(i.id)}','resolve')">Resolve</button> <button class="mini secondary" onclick="goliathReconRespond('${esc(i.id)}','dismiss')">Dismiss</button></div></div>`).join('')||'<div class="empty">No open reconciliation ambiguity.</div>'}</div>
    <div class="panel"><h3>Unaccounted connector events</h3>${unaccounted.map(i=>`<div class="timeline"><div><b>${esc(i.provider)} · ${esc(i.resourceType)} · ${esc(i.providerEventId)}</b><div class="muted">Observed ${esc(i.observedAt)} · state ${esc(i.state)} · attempts ${i.attemptCount??0}${i.hasError?' · error present':''}</div></div><button class="mini" onclick="goliathReconRegister('${esc(projectId)}','${esc(i.bindingId)}','${esc(i.id)}')">Register exception</button></div>`).join('')||'<div class="empty">No unaccounted inbox events.</div>'}</div>
    <div class="panel"><h3>Evidence readiness</h3><div class="grid"><div class="card"><span>Controlled commitments</span><strong>${es.controlledCommitments??0}</strong></div><div class="card"><span>With evidence</span><strong>${es.withAnyEvidence??0}</strong></div><div class="card"><span>Missing evidence spec</span><strong>${es.withoutEvidenceSpec??0}</strong></div><div class="card"><span>Stale evidence rows</span><strong>${es.staleEvidenceRows??0}</strong></div></div></div>`;
  view.appendChild(panel);
}

async function reconRespond(issueId,action){
  const reason=prompt(`${action} reason:`);if(!reason)return;
  try{await rpc('respond_reconciliation_issue',{p_assignment_id:ctx(),p_issue_id:issueId,p_action:action,p_reason:reason});const p=document.getElementById('pmoProject')?.value;if(p)await loadPmoDiagnostics(p);}catch(e){alert(e.message);}
}
async function reconRegister(projectId,bindingId,inboxId){
  const issueType=prompt('Issue type: unmapped-object, ambiguous-match, schema-drift, field-conflict, provider-error, auth-error, duplicate, stale-source, other','unmapped-object');if(!issueType)return;
  const severity=prompt('Severity: info, attention, high, critical','attention');if(!severity)return;
  const summary=prompt('Reconciliation summary:');if(!summary)return;
  try{await rpc('create_reconciliation_issue',{p_assignment_id:ctx(),p_project_id:projectId,p_binding_id:bindingId,p_inbox_id:inboxId,p_issue_type:issueType,p_severity:severity,p_summary:summary,p_details:{},p_candidate_matches:[]});await loadPmoDiagnostics(projectId);}catch(e){alert(e.message);}
}

function attach(){
  const view=document.getElementById('view');if(!view)return;
  const pmoProject=document.getElementById('pmoProject');
  if(pmoProject&&view.querySelector('h1')?.textContent==='PMO Controls'&&!document.getElementById('pmoReconDiagnostics'))loadPmoDiagnostics(pmoProject.value);
  const projectSelect=document.getElementById('projectSelect');
  if(projectSelect&&view.textContent.includes('Project Cockpit')&&!document.getElementById('evidenceDiagnosticsPanel'))loadEvidence(projectSelect.value);
}

new MutationObserver(attach).observe(document.documentElement,{childList:true,subtree:true});
attach();
Object.assign(window,{goliathReconRespond:reconRespond,goliathReconRegister:reconRegister});
