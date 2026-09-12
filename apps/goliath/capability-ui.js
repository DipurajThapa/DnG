import { createClient } from 'https://esm.sh/@neondatabase/neon-js@0.7.0-beta';
import { runtimeConfig } from './runtime-config.js';

const client=createClient({auth:{url:runtimeConfig.authUrl,allowAnonymous:false},dataApi:{url:runtimeConfig.dataApiUrl}});
let loadingMatrix=false;

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function arr(v){return Array.isArray(v)?v:[];}
async function rpc(name,payload={}){const {data,error}=await client.rpc(name,payload);if(error)throw new Error(error.message||String(error));return data;}
function ctx(){return document.getElementById('contextSelect')?.value||null;}
function badge(v){const s=String(v||'deny');const cls=['allow','pass','passed'].includes(s)?'good':['conditional','pending'].includes(s)?'warn':'bad';return `<span class="badge ${cls}">${esc(s)}</span>`;}
function openModal(title,body){document.getElementById('capabilityModal')?.remove();const o=document.createElement('div');o.id='capabilityModal';o.className='modal-overlay';o.innerHTML=`<div class="modal-card" style="width:min(900px,100%)"><div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close>×</button></div><div>${body}</div><div class="modal-actions"><button class="btn secondary" data-close>Close</button></div></div>`;document.body.appendChild(o);o.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>o.remove());return o;}

async function runSelfTest(){
  const assignment=ctx();if(!assignment)return;
  try{
    const r=await rpc('run_authorization_self_test',{p_assignment_id:assignment});
    openModal(`Authorization self-test · ${r.role||''}`,`<div class="grid"><div class="card"><span>Result</span><strong>${r.passed?'PASS':'FAIL'}</strong></div><div class="card"><span>Actions checked</span><strong>${r.totalActions??0}</strong></div><div class="card"><span>Mismatches</span><strong>${r.mismatchCount??0}</strong></div><div class="card"><span>Policy hash</span><strong style="font-size:12px">${esc(r.policyHash||'—')}</strong></div></div><div class="panel table-wrap"><table><thead><tr><th>Object</th><th>Action</th><th>Policy</th><th>Effective</th><th>Data authority</th><th>Consistent</th></tr></thead><tbody>${arr(r.results).map(x=>`<tr><td>${esc(x.objectType)}</td><td>${esc(x.action)}</td><td>${badge(x.policyMode)}</td><td>${badge(x.effectiveMode)}</td><td>${x.hasDataAuthority?'yes':'no'}</td><td>${badge(x.consistent?'pass':'fail')}</td></tr>`).join('')}</tbody></table></div><div class="notice">This test proves the current signed-in identity/responsibility is evaluated against the canonical role policy. Conditional actions still require their real object-level condition during business acceptance.</div>`);
    return r;
  }catch(e){openModal('Authorization self-test',`<div class="error">${esc(e.message)}</div>`);}
}

async function showMyAuthority(){
  const assignment=ctx();if(!assignment)return;
  try{
    const m=await rpc('my_capabilities',{p_assignment_id:assignment});const caps=arr(m?.capabilities);
    const o=openModal(`My authority · ${m.role||''}`,`<p class="sub">Role policy after data-class restrictions. Conditional actions still require the named object condition such as decider, provider or consumer.</p><div class="actions"><button class="btn" id="capRunSelfTest">Run authorization self-test</button></div><div class="panel table-wrap" style="margin-top:14px"><table><thead><tr><th>Object</th><th>Action</th><th>Authority</th><th>Data class</th><th>Consequence</th><th>Condition</th></tr></thead><tbody>${caps.map(c=>`<tr><td>${esc(c.objectType)}</td><td><b>${esc(c.displayName)}</b><div class="muted">${esc(c.action)}</div></td><td>${badge(c.effectiveMode)}</td><td>${esc(c.dataClass)}</td><td>${esc(c.consequence)}</td><td>${esc(c.conditionCode||'—')}</td></tr>`).join('')}</tbody></table></div>`);
    o.querySelector('#capRunSelfTest').onclick=runSelfTest;return o;
  }catch(e){openModal('My authority',`<div class="error">${esc(e.message)}</div>`);}
}

async function loadAdminMatrix(){
  if(loadingMatrix)return;
  const assignment=ctx(),view=document.getElementById('view');
  if(!assignment||!view||view.querySelector('h1')?.textContent!=='Administration'||document.getElementById('capabilityMatrixPanel'))return;
  loadingMatrix=true;
  try{
    const [m,a]=await Promise.all([rpc('admin_role_capability_matrix',{p_acting_assignment_id:assignment}),rpc('admin_authorization_acceptance_summary',{p_acting_assignment_id:assignment}).catch(()=>({runs:[]}))]);
    const roles=arr(m?.roles);if(!roles.length)return;
    const panel=document.createElement('div');panel.id='capabilityMatrixPanel';panel.className='panel';
    panel.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><h3 style="margin:0">Role capability matrix</h3><div class="muted">Canonical least-privilege policy. Conditional authority never bypasses named-owner/decider/provider checks.</div></div><select id="capRole">${roles.map(r=>`<option value="${esc(r.role)}">${esc(r.displayName)}</option>`).join('')}</select></div><div id="capRoleBody" style="margin-top:14px"></div>`;
    const insertAfter=document.getElementById('acceptanceReadinessPanel')||document.getElementById('roleCoveragePanel');if(insertAfter)insertAfter.after(panel);else view.appendChild(panel);
    const renderRole=()=>{const role=roles.find(r=>r.role===panel.querySelector('#capRole').value)||roles[0],caps=arr(role?.capabilities);panel.querySelector('#capRoleBody').innerHTML=`<div class="grid"><div class="card"><span>Allowed</span><strong>${caps.filter(c=>c.authorityMode==='allow').length}</strong></div><div class="card"><span>Conditional</span><strong>${caps.filter(c=>c.authorityMode==='conditional').length}</strong></div><div class="card"><span>Denied</span><strong>${caps.filter(c=>c.authorityMode==='deny').length}</strong></div><div class="card"><span>Total actions</span><strong>${caps.length}</strong></div></div><div class="table-wrap"><table><thead><tr><th>Object</th><th>Action</th><th>Policy</th><th>Data class</th><th>Consequence</th><th>Condition / reason</th></tr></thead><tbody>${caps.map(c=>`<tr><td>${esc(c.objectType)}</td><td><b>${esc(c.displayName)}</b><div class="muted">${esc(c.action)}</div></td><td>${badge(c.authorityMode)}</td><td>${esc(c.dataClass)}</td><td>${esc(c.consequence)}</td><td>${esc(c.conditionCode||c.notes||'—')}</td></tr>`).join('')}</tbody></table></div>`;};panel.querySelector('#capRole').onchange=renderRole;renderRole();

    const accept=document.createElement('div');accept.id='authorizationAcceptancePanel';accept.className='panel';const runs=arr(a?.runs);accept.innerHTML=`<h3>Real-session authorization evidence</h3><p class="muted">Latest signed-in self-test per responsibility. A configured role without a real session is not treated as accepted.</p>${runs.length?`<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Scope</th><th>Result</th><th>Actions</th><th>Mismatches</th><th>Run</th></tr></thead><tbody>${runs.map(r=>`<tr><td>${esc(r.userId)}</td><td>${esc(r.role)}</td><td>${esc(r.scopeType)} · ${esc(r.scopeId)}</td><td>${badge(r.passed?'pass':'fail')}</td><td>${r.totalActions}</td><td>${r.mismatchCount}</td><td>${esc(String(r.runAt||'').replace('T',' ').slice(0,19))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No real-session authorization self-test has been recorded yet.</div>'}`;panel.after(accept);
  }catch(_e){document.getElementById('capabilityMatrixPanel')?.remove();document.getElementById('authorizationAcceptancePanel')?.remove();}
  finally{loadingMatrix=false;}
}

function attach(){
  const top=document.querySelector('.top .context');if(top&&!document.getElementById('myAuthority')){const b=document.createElement('button');b.id='myAuthority';b.className='btn secondary';b.textContent='My authority';b.onclick=showMyAuthority;const signout=document.getElementById('signout');if(signout)top.insertBefore(b,signout);else top.appendChild(b);}
  const view=document.getElementById('view');if(view?.querySelector('h1')?.textContent==='Administration'&&!document.getElementById('capabilityMatrixPanel'))loadAdminMatrix();
}

new MutationObserver(attach).observe(document.documentElement,{childList:true,subtree:true});attach();
window.goliathShowMyAuthority=showMyAuthority;window.goliathRunAuthorizationSelfTest=runSelfTest;
