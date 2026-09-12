import { createClient } from 'https://esm.sh/@neondatabase/neon-js@0.7.0-beta';
import { runtimeConfig } from './runtime-config.js';

const client=createClient({auth:{url:runtimeConfig.authUrl,allowAnonymous:false},dataApi:{url:runtimeConfig.dataApiUrl}});
const roleLabels={
  'enterprise-admin':'Enterprise Admin','portfolio-manager':'Portfolio Manager','program-manager':'Program Manager',
  'project-director':'Project Director','project-manager':'Project Manager','pmo':'PMO / Project Controls',
  'resource-manager':'Resource Manager','delivery-lead':'Delivery Lead','agile-delivery-lead':'Agile Delivery Lead',
  'team-member':'Team Member','sponsor':'Sponsor'
};
let loading=false,lastRoleModel=null;

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function arr(v){return Array.isArray(v)?v:[];}
async function rpc(name,payload={}){const {data,error}=await client.rpc(name,payload);if(error)throw new Error(error.message||String(error));return data;}
function badge(v){const s=String(v||'unknown');const cls=s==='ready'?'good':s==='assigned-unlinked'?'warn':s==='not-covering-project'||s==='unassigned'?'bad':'warn';return `<span class="badge ${cls}">${esc(s)}</span>`;}

function humaniseResponsibilityOptions(){
  const select=document.getElementById('contextSelect');
  if(!select)return;
  if(!document.getElementById('responsibilityLabel')){
    const wrap=select.parentElement;
    const label=document.createElement('span');
    label.id='responsibilityLabel';
    label.className='muted';
    label.style.fontSize='11px';
    label.style.marginRight='6px';
    label.textContent='My responsibilities';
    wrap?.insertBefore(label,select);
  }
  for(const option of select.options){
    const raw=option.textContent||'';
    const parts=raw.split(' · ');
    if(parts.length>=3){
      const [name,role,...scope]=parts;
      const pretty=roleLabels[role]||role;
      const next=`${name} · ${pretty} · ${scope.join(' · ')}`;
      if(option.textContent!==next)option.textContent=next;
    }
  }
  select.title='Only responsibilities assigned to your verified identity appear here. This is not an acting-as or role-impersonation control.';
}

async function loadCoverage(projectId=null){
  if(loading)return;
  const ctx=document.getElementById('contextSelect')?.value;
  const view=document.getElementById('view');
  if(!ctx||!view||view.querySelector('h1')?.textContent!=='Administration')return;
  loading=true;
  try{
    const ref=await rpc('admin_reference_data',{p_acting_assignment_id:ctx});
    const projects=arr(ref?.projects);
    const remembered=sessionStorage.getItem('goliathRoleCoverageProject');
    const chosen=projectId&&projects.some(p=>p.id===projectId)?projectId:(remembered&&projects.some(p=>p.id===remembered)?remembered:(projects.find(p=>p.id==='GOLIATH-DEV')?.id||projects[0]?.id||null));
    const model=await rpc('admin_role_coverage',{p_acting_assignment_id:ctx,p_project_id:chosen});
    lastRoleModel=model;
    renderCoverage(view,projects,model,chosen);
  }catch(e){
    const existing=document.getElementById('roleCoveragePanel');
    if(existing)existing.remove();
  }finally{loading=false;}
}

function renderCoverage(view,projects,model,chosen){
  document.getElementById('roleCoveragePanel')?.remove();
  const panel=document.createElement('div');
  panel.id='roleCoveragePanel';
  panel.className='panel table-wrap';
  const roles=arr(model?.roles);
  const linkedReady=roles.filter(r=>Number(r.linkedIdentities||0)>0).length;
  const covered=roles.filter(r=>Number(r.projectCoverage||0)>0||r.role==='enterprise-admin').length;
  panel.innerHTML=`
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
      <div><h3 style="margin-top:0">Role coverage</h3><div class="muted">All supported roles are defined centrally. The header selector remains limited to the signed-in user's actual responsibilities.</div></div>
      <select id="roleCoverageProject">${projects.map(p=>`<option value="${esc(p.id)}" ${p.id===chosen?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
    </div>
    <div class="grid" style="margin-top:12px">
      <div class="card"><span>Supported roles</span><strong>${roles.length}</strong></div>
      <div class="card"><span>Roles covering project</span><strong>${covered}</strong></div>
      <div class="card"><span>Roles with linked identities</span><strong>${linkedReady}</strong></div>
      <div class="card"><span>Your current responsibilities</span><strong>${document.getElementById('contextSelect')?.options.length||0}</strong></div>
    </div>
    <div class="notice" style="margin:14px 0">${esc(model?.selectorPrinciple||'Responsibility selection is identity-bound.')}</div>
    <table><thead><tr><th>Role</th><th>Default scope</th><th>Primary surfaces</th><th>Assignments</th><th>Covers project</th><th>Linked identities</th><th>Acceptance state</th><th></th></tr></thead>
      <tbody>${roles.map(r=>{const unlinked=arr(r.assignments).filter(a=>!a.identityLinked);return `<tr><td><b>${esc(r.displayName)}</b><div class="muted">${esc(r.purpose)}</div></td><td>${esc(r.defaultScopeType)}${r.requiresTeam?' · team required':''}</td><td>${esc(arr(r.surfaces).map(s=>String(s).replaceAll('-',' ')).join(', '))}</td><td>${r.activeAssignments??0}</td><td>${r.role==='enterprise-admin'?'admin only':(r.projectCoverage??0)}</td><td>${r.linkedIdentities??0}</td><td>${badge(r.status)}</td><td>${unlinked.length?`<button class="mini secondary" onclick="goliathInviteRoleHolder('${esc(r.role)}')">Invite role holder</button>`:'<span class="muted">Linked</span>'}</td></tr>`;}).join('')}</tbody>
    </table>
    <div class="muted" style="margin-top:10px">A role can be configured for the project without having a linked sign-in identity yet. Use <b>Invite role holder</b> to bind a second real verified identity for end-to-end role testing. Do not grant your own login every role just to preview screens.</div>`;
  const firstTable=view.querySelector('.panel.table-wrap');
  if(firstTable)firstTable.before(panel);else view.appendChild(panel);
  const select=panel.querySelector('#roleCoverageProject');
  select.onchange=()=>{sessionStorage.setItem('goliathRoleCoverageProject',select.value);loadCoverage(select.value);};
}

async function inviteRoleHolder(roleKey){
  const ctx=document.getElementById('contextSelect')?.value;
  const role=arr(lastRoleModel?.roles).find(r=>r.role===roleKey);
  if(!ctx||!role)return;
  const candidates=[];
  const seen=new Set();
  for(const a of arr(role.assignments)){
    if(a.identityLinked||seen.has(a.userId))continue;
    seen.add(a.userId);candidates.push(a);
  }
  if(!candidates.length){alert('Every current holder of this role already has a linked identity.');return;}
  let chosen=candidates[0];
  if(candidates.length>1){
    const menu=candidates.map((a,i)=>`${i+1}. ${a.displayName} · ${a.scopeType} ${a.scopeId}${a.teamId?` · ${a.teamId}`:''}`).join('\n');
    const raw=prompt(`Choose the internal role holder to invite:\n\n${menu}\n\nEnter 1-${candidates.length}:`,'1');
    if(raw===null)return;
    const n=Number(raw);
    if(!Number.isInteger(n)||n<1||n>candidates.length){alert('Invalid selection.');return;}
    chosen=candidates[n-1];
  }
  const email=prompt(`Verified Google email for ${chosen.displayName} (${role.displayName}):`);
  if(!email)return;
  try{
    const result=await rpc('admin_create_identity_invitation',{p_acting_assignment_id:ctx,p_email:email.trim(),p_user_id:chosen.userId,p_expires_hours:168});
    alert(`Invitation created for ${result.email}.\n\nOne-time token:\n${result.token}\n\nThe recipient must sign in with that exact verified email, then claim this token if automatic linking does not occur.`);
    await loadCoverage(lastRoleModel?.project?.id||null);
  }catch(e){alert(e.message);}
}

function attach(){
  humaniseResponsibilityOptions();
  const view=document.getElementById('view');
  if(view?.querySelector('h1')?.textContent==='Administration'&&!document.getElementById('roleCoveragePanel'))loadCoverage();
}

new MutationObserver(attach).observe(document.documentElement,{childList:true,subtree:true});
attach();
Object.assign(window,{goliathInviteRoleHolder:inviteRoleHolder});
