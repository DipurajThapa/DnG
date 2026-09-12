import { createClient } from 'https://esm.sh/@neondatabase/neon-js@0.7.0-beta';
import { runtimeConfig } from './runtime-config.js';

const client=createClient({auth:{url:runtimeConfig.authUrl,allowAnonymous:false},dataApi:{url:runtimeConfig.dataApiUrl}});
let invitationState=null;

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function arr(v){return Array.isArray(v)?v:[];}
async function rpc(name,payload={}){const {data,error}=await client.rpc(name,payload);if(error)throw new Error(error.message||String(error));return data;}
function ctx(){return document.getElementById('contextSelect')?.value||null;}
function roleLabel(role){return String(role||'').split('-').map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(' ');}
function closeFlow(){document.getElementById('invitationFlow')?.remove();invitationState=null;}
function modalShell(title,body){
  closeFlow();
  const o=document.createElement('div');
  o.id='invitationFlow';o.className='modal-overlay';
  o.innerHTML=`<div class="modal-card" style="width:min(720px,100%)"><div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" id="inviteClose" aria-label="Close">×</button></div><div id="inviteBody">${body}</div></div>`;
  document.body.appendChild(o);
  o.querySelector('#inviteClose').onclick=closeFlow;
  return o;
}
function targetSummary(t){return arr(t.assignments).map(a=>`${roleLabel(a.role)} · ${a.scopeType} ${a.scopeId}${a.teamId?` · ${a.teamId}`:''}`).join(' | ');}
async function getTargets(){const result=await rpc('admin_invitation_targets',{p_acting_assignment_id:ctx()});return arr(result?.targets).filter(x=>!x.identityLinked);}

async function openInvitationFlow(options={}){
  const acting=ctx();if(!acting)throw new Error('Enterprise Admin responsibility is required.');
  let candidates=[];
  if(options.roleKey){
    const projectId=options.projectId||document.getElementById('roleCoverageProject')?.value||sessionStorage.getItem('goliathRoleCoverageProject')||'GOLIATH-DEV';
    const model=await rpc('admin_role_coverage',{p_acting_assignment_id:acting,p_project_id:projectId});
    const role=arr(model?.roles).find(r=>r.role===options.roleKey);
    candidates=arr(role?.assignments).filter(a=>!a.identityLinked).map(a=>({userId:a.userId,displayName:a.displayName,assignments:[a],pendingInvitation:null}));
  }else{
    candidates=await getTargets();
  }
  if(options.userId)candidates=candidates.filter(x=>x.userId===options.userId);
  if(!candidates.length){alert('No unlinked role holder is available for this invitation.');return;}

  const preset=options.email||candidates[0]?.pendingInvitation?.email||'';
  const o=modalShell('Invite Goliath user · Step 1 of 2',`
    <p class="sub">Choose the governed role holder and the exact verified Google email. Creating the invitation does not send a second record.</p>
    <div class="form-grid">
      <label class="span2">Role holder<select id="inviteTarget">${candidates.map((t,i)=>`<option value="${esc(t.userId)}" ${i===0?'selected':''}>${esc(t.displayName)} · ${esc(targetSummary(t))}</option>`).join('')}</select></label>
      <label class="span2">Verified email<input id="inviteEmail" type="email" value="${esc(preset)}" placeholder="name@example.com"></label>
      <label>Expires in<select id="inviteExpiry"><option value="168">7 days</option><option value="72">3 days</option><option value="336">14 days</option></select></label>
    </div>
    <div class="notice">If the same role holder and email already have a valid pending invitation, Goliath reuses that exact invitation and token rather than creating a duplicate.</div>
    <div class="modal-actions"><button class="btn secondary" id="inviteCancel">Cancel</button><button class="btn" id="inviteContinue">Create / continue</button></div><div id="inviteMsg"></div>`);
  o.querySelector('#inviteCancel').onclick=closeFlow;
  const select=o.querySelector('#inviteTarget'),email=o.querySelector('#inviteEmail');
  select.onchange=()=>{const t=candidates.find(x=>x.userId===select.value);if(t?.pendingInvitation?.email)email.value=t.pendingInvitation.email;};
  o.querySelector('#inviteContinue').onclick=async()=>{
    const button=o.querySelector('#inviteContinue'),msg=o.querySelector('#inviteMsg');button.disabled=true;msg.textContent='';
    try{
      const target=candidates.find(x=>x.userId===select.value);const value=email.value.trim();
      if(!target)throw new Error('Choose a role holder.');
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))throw new Error('Enter a valid email address.');
      const result=await rpc('admin_create_identity_invitation',{p_acting_assignment_id:acting,p_email:value,p_user_id:target.userId,p_expires_hours:Number(o.querySelector('#inviteExpiry').value)});
      invitationState={acting,target,result};
      renderShareStep(o,invitationState);
    }catch(e){msg.className='error';msg.textContent=e.message;}finally{button.disabled=false;}
  };
}

function renderShareStep(o,state){
  const {target,result}=state;const body=o.querySelector('#inviteBody');
  const masked=`${String(result.token).slice(0,8)}-••••-••••-••••-${String(result.token).slice(-12)}`;
  body.innerHTML=`
    <p class="sub">Step 2 of 2 · Share the same invitation using either method. No additional invitation is created.</p>
    <div class="panel"><div><b>${esc(target.displayName)}</b></div><div class="muted">${esc(result.email)} · expires ${esc(String(result.expiresAt||'').replace('T',' ').slice(0,16))}</div>${result.reused?'<div class="notice"><b>Existing pending invitation reused.</b> The previous token remains the valid token.</div>':''}</div>
    <label style="display:block;font-weight:700;font-size:12px">Invitation token</label>
    <div style="display:flex;gap:8px;margin-top:6px"><input id="inviteToken" type="password" readonly value="${esc(result.token)}" style="flex:1;padding:10px;border:1px solid var(--line);border-radius:8px"><button class="btn secondary" id="inviteReveal">Show</button></div>
    <div class="muted" style="margin-top:6px">${esc(masked)}</div>
    <div class="actions"><button class="btn" id="inviteEmailShare">Send invitation by email</button><button class="btn secondary" id="inviteCopy">Copy invitation token</button></div>
    <div class="notice"><b>Local development:</b> “Send invitation by email” opens your default email client with a pre-filled message. Goliath does not claim an email was sent until a transactional mail provider is configured.</div>
    <div class="modal-actions"><button class="btn secondary" id="inviteDone">Done</button></div><div id="inviteShareMsg"></div>`;
  const token=body.querySelector('#inviteToken');
  body.querySelector('#inviteReveal').onclick=e=>{const show=token.type==='password';token.type=show?'text':'password';e.currentTarget.textContent=show?'Hide':'Show';};
  body.querySelector('#inviteCopy').onclick=async()=>{
    const msg=body.querySelector('#inviteShareMsg');try{await copyText(result.token);await rpc('admin_record_identity_invitation_share',{p_acting_assignment_id:state.acting,p_token:result.token,p_channel:'copy-token'});msg.className='notice';msg.textContent='Invitation token copied. The invitation record was not duplicated.';}catch(e){msg.className='error';msg.textContent=e.message;}
  };
  body.querySelector('#inviteEmailShare').onclick=async()=>{
    const msg=body.querySelector('#inviteShareMsg');
    try{
      await rpc('admin_record_identity_invitation_share',{p_acting_assignment_id:state.acting,p_token:result.token,p_channel:'email-client'});
      const subject=encodeURIComponent('You are invited to Goliath');
      const roles=targetSummary(target)||'Goliath responsibility';
      const text=`You have been invited to Goliath.\n\nRole / scope: ${roles}\nSign in using this exact Google email: ${result.email}\nGoliath: ${location.origin}/\nInvitation token: ${result.token}\nExpires: ${result.expiresAt}\n\nAfter signing in, paste the invitation token into the Claim invitation screen.`;
      location.href=`mailto:${encodeURIComponent(result.email)}?subject=${subject}&body=${encodeURIComponent(text)}`;
      msg.className='notice';msg.textContent='Your email client was opened with the existing invitation. Goliath did not create another token.';
    }catch(e){msg.className='error';msg.textContent=e.message;}
  };
  body.querySelector('#inviteDone').onclick=closeFlow;
}

async function copyText(value){
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);return;}
  const t=document.createElement('textarea');t.value=value;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();
}

// The modal deliberately does not close on blur/focus changes or backdrop clicks.
// It closes only when the user clicks Close/Cancel/Done, or navigates to another app surface/context.
document.addEventListener('click',e=>{if(e.target.closest?.('#nav button[data-surface]')&&document.getElementById('invitationFlow'))closeFlow();},true);
document.addEventListener('change',e=>{if(e.target?.id==='contextSelect'&&document.getElementById('invitationFlow'))closeFlow();},true);

window.inviteIdentity=()=>openInvitationFlow();
window.goliathInviteRoleHolder=(roleKey)=>openInvitationFlow({roleKey});
window.goliathOpenInvitationFlow=openInvitationFlow;
