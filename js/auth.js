
(function(){
  const SUPABASE_URL='https://nmgwawdpynmxkgjlsgri.supabase.co';
  const SUPABASE_KEY='sb_publishable_CjgEWpt-EQ6U7zFw-kbJAA_6t1fkJcW';
  const TABS=[
    {id:'overview',label:'Overview'},
    {id:'plans',label:'Production Plans'},
    {id:'operator',label:'Operator'},
    {id:'reports',label:'Reports'},
    {id:'rework',label:'Rework'}
  ];

  const root=document.createElement('div');
  root.id='pmAuthGate';
  root.innerHTML=
    '<div class="auth-card">'+
      '<div class="auth-lock">🔐</div>'+
      '<div class="auth-brand">Production Management</div>'+
      '<div class="auth-sub" id="pmAuthSubtitle">Sign in to your production workspace</div>'+
      '<form id="pmAuthForm">'+
        '<div id="pmAuthNameWrap" hidden><label for="pmAuthName">Full name</label><input id="pmAuthName" type="text" autocomplete="name" placeholder="Your full name"></div>'+
        '<label for="pmAuthEmail">Email address</label><input id="pmAuthEmail" type="email" autocomplete="username" required placeholder="name@company.com">'+
        '<label for="pmAuthPassword">Password</label><input id="pmAuthPassword" type="password" autocomplete="current-password" required placeholder="Enter your password">'+
        '<button id="pmAuthSubmit" type="submit">Sign in</button>'+
      '</form>'+
      '<div id="pmAuthError" class="auth-error" role="alert"></div>'+
      '<div id="pmAuthInfo" class="auth-info" role="status"></div>'+
      '<button type="button" id="pmAuthSwitch" class="auth-switch">Signup</button>'+
      '<div class="auth-note" id="pmAuthNote">New accounts require super-administrator approval. Your access tabs are assigned after signup.</div>'+
      '<div id="pmAuthUser"></div>'+
    '</div>';
  root.hidden=true;
  document.body.appendChild(root);
  document.body.classList.add('pm-auth-pending');

  const form=root.querySelector('#pmAuthForm');
  const btn=root.querySelector('#pmAuthSubmit');
  const err=root.querySelector('#pmAuthError');
  const info=root.querySelector('#pmAuthInfo');
  const nameWrap=root.querySelector('#pmAuthNameWrap');
  const nameInput=root.querySelector('#pmAuthName');
  const emailInput=root.querySelector('#pmAuthEmail');
  const passwordInput=root.querySelector('#pmAuthPassword');
  const switchBtn=root.querySelector('#pmAuthSwitch');

  let mode='login';
  let signupInProgress=false;
  let checkingUser=false;
  let recoveryMode=false;
  let appAuthorized=false;
  let currentUserId=null;
  let allowedTabs=[];
  let isSuperAdmin=false;
  window.pmIsSuperAdmin=false;
  window.pmCurrentUserId=null;

  function showError(message){err.textContent=message||'Unable to continue. Please try again.';info.textContent='';}
  function showInfo(message){info.textContent=message||'';err.textContent='';}
  function escapeHtml(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  function setMode(next){
    mode=next;
    err.textContent='';
    info.textContent='';
    nameWrap.hidden=mode!=='signup';
    nameInput.required=mode==='signup';
    passwordInput.autocomplete=mode==='signup'?'new-password':'current-password';
    passwordInput.minLength=mode==='signup'?8:0;
    root.querySelector('#pmAuthSubtitle').textContent=mode==='signup'?'Create your production workspace account':'Sign in to your production workspace';
    btn.textContent=mode==='signup'?'Create account':'Sign in';
    switchBtn.textContent=mode==='signup'?'Already have an account? Sign in':'Signup';
    root.querySelector('#pmAuthNote').textContent=mode==='signup'
      ?'After signup, confirm your email if prompted. The super administrator must approve your account and assign the tabs you can access.'
      :'New accounts require super-administrator approval. Your access tabs are assigned after signup.';
  }
  switchBtn.addEventListener('click',function(){setMode(mode==='login'?'signup':'login');});

  if(!window.supabase){
    showError('Authentication library failed to load. Check your internet connection and reload.');
    return;
  }
  const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
  window.pmSupabaseAuthClient=sb;
  window.pmSupabaseClient=sb;
  const baseShowPage=window.showPage;

  function ensureAdminPage(){
    const content=document.querySelector('.content');
    if(!content) return;
    if(!document.getElementById('pmAdmin')){
      const section=document.createElement('section');
      section.id='pmAdmin';
      section.className='page hidden';
      section.innerHTML=
        '<div class="pagehead"><div><h1>User Access Management</h1><div class="sub">Approve new accounts, assign roles and choose which workspace tabs each user can access</div></div>'+
        '<div class="filters"><button class="btn" type="button" id="pmAdminRefresh">Refresh users</button></div></div>'+
        '<div class="pm-admin-note"><strong>Super administrator:</strong> admin@gsons.co.in. New signups are created as Pending with no access. Select a role, activate the account and tick the permitted tabs before saving.</div>'+
        '<div id="pmAdminMessage" class="pm-admin-message"></div>'+
        '<div class="panel"><div class="paneltitle"><h3>Registered users</h3><span id="pmAdminCount">Loading…</span></div>'+
        '<div class="pm-admin-table-wrap"><table class="pm-admin-table"><thead><tr><th>USER</th><th>ROLE</th><th>ACCOUNT STATUS</th><th>ALLOWED TABS</th><th>ACTION</th></tr></thead><tbody id="pmAdminUsers"><tr><td colspan="5">Loading users…</td></tr></tbody></table></div></div>';
      content.appendChild(section);
    }
    const nav=document.querySelector('.nav');
    if(nav&&!document.getElementById('pmAdminNav')){
      const button=document.createElement('button');
      button.id='pmAdminNav';
      button.type='button';
      button.dataset.page='pmAdmin';
      button.style.display='none';
      button.innerHTML='<span class="ico">⚙</span><span>User Access</span>';
      button.addEventListener('click',function(){
        if(typeof window.navigatePage==='function') window.navigatePage('pmAdmin');
        else window.showPage('pmAdmin');
      });
      nav.appendChild(button);
    }
    const refresh=document.getElementById('pmAdminRefresh');
    if(refresh&&!refresh.dataset.bound){
      refresh.dataset.bound='1';
      refresh.addEventListener('click',loadAdminUsers);
    }
    const tbody=document.getElementById('pmAdminUsers');
    if(tbody&&!tbody.dataset.bound){
      tbody.dataset.bound='1';
      tbody.addEventListener('click',function(event){
        const saveButton=event.target.closest('[data-save-user]');
        if(saveButton) saveAdminUser(saveButton);
        const resetButton=event.target.closest('[data-reset-email]');
        if(resetButton) resetAdminPassword(resetButton);
      });
      tbody.addEventListener('change',function(event){
        if(event.target.classList.contains('pm-admin-role')){
          const row=event.target.closest('tr');
          const active=row&&row.querySelector('.pm-admin-active');
          if(active&&event.target.value==='pending'){active.checked=false;active.disabled=true;}
          else if(active){active.disabled=false;}
        }
      });
    }
  }

  async function loadAdminUsers(){
    if(!isSuperAdmin) return;
    const tbody=document.getElementById('pmAdminUsers');
    const message=document.getElementById('pmAdminMessage');
    if(tbody) tbody.innerHTML='<tr><td colspan="5">Loading users…</td></tr>';
    if(message) message.textContent='';
    try{
      const result=await sb.from('pm_user_profiles')
        .select('id,email,full_name,role,is_active,is_super_admin,allowed_tabs,email_confirmed_at,created_at')
        .order('created_at',{ascending:false});
      if(result.error) throw result.error;
      renderAdminUsers(result.data||[]);
    }catch(ex){
      if(tbody) tbody.innerHTML='<tr><td colspan="5">Unable to load users: '+escapeHtml(ex.message)+'</td></tr>';
    }
  }

  function renderAdminUsers(users){
    const tbody=document.getElementById('pmAdminUsers');
    const count=document.getElementById('pmAdminCount');
    if(!tbody) return;
    if(count) count.textContent=users.length+' account'+(users.length===1?'':'s');
    const editable=users.filter(function(u){return !u.is_super_admin;});
    if(!editable.length){
      tbody.innerHTML='<tr><td colspan="5">No other user accounts have signed up yet.</td></tr>';
      return;
    }
    const roles=['pending','operator','supervisor','admin'];
    tbody.innerHTML=editable.map(function(u){
      const roleOptions=roles.map(function(r){
        return '<option value="'+r+'"'+(u.role===r?' selected':'')+'>'+r.charAt(0).toUpperCase()+r.slice(1)+'</option>';
      }).join('');
      const tabChecks=TABS.map(function(t){
        const checked=(u.allowed_tabs||[]).indexOf(t.id)>=0?' checked':'';
        return '<label><input type="checkbox" class="pm-admin-tab" value="'+t.id+'"'+checked+'> '+t.label+'</label>';
      }).join('');
      const verified=u.email_confirmed_at
        ?'<span style="color:#188455">Email verified</span>'
        :'<span style="color:#b9770e">Email not verified</span>';
      return '<tr data-user-row="'+escapeHtml(u.id)+'">'+
        '<td><div class="pm-admin-account">'+escapeHtml(u.full_name||'Name not provided')+'</div><small>'+escapeHtml(u.email||'No email')+'</small></td>'+
        '<td><select class="pm-admin-role">'+roleOptions+'</select></td>'+
        '<td><div class="pm-admin-status"><label><input type="checkbox" class="pm-admin-active"'+(u.is_active?' checked':'')+(u.role==='pending'?' disabled':'')+'> Active</label>'+verified+'</div></td>'+
        '<td><div class="pm-admin-tabs">'+tabChecks+'</div></td>'+
        '<td><div class="pm-admin-actions"><button type="button" class="btn primary pm-admin-save" data-save-user="'+escapeHtml(u.id)+'">Save access</button><button type="button" class="btn pm-admin-reset" data-reset-email="'+escapeHtml(u.email||'')+'">Send password reset</button></div></td>'+
      '</tr>';
    }).join('');
  }

  async function saveAdminUser(button){
    if(!isSuperAdmin) return;
    const row=button.closest('tr');
    if(!row) return;
    const message=document.getElementById('pmAdminMessage');
    const role=row.querySelector('.pm-admin-role').value;
    const active=row.querySelector('.pm-admin-active').checked;
    const tabs=Array.from(row.querySelectorAll('.pm-admin-tab:checked')).map(function(x){return x.value;});
    const name=row.querySelector('.pm-admin-account').textContent.trim();
    button.disabled=true;
    button.textContent='Saving…';
    if(message) message.textContent='';
    try{
      const result=await sb.rpc('pm_admin_update_user_access',{
        p_user_id:button.dataset.saveUser,
        p_full_name:name,
        p_role:role,
        p_is_active:active,
        p_allowed_tabs:tabs
      });
      if(result.error) throw result.error;
      if(message) message.textContent='Access saved successfully.';
      await loadAdminUsers();
    }catch(ex){
      if(message) message.textContent='Could not save access: '+ex.message;
    }finally{
      button.disabled=false;
      button.textContent='Save access';
    }
  }


  async function resetAdminPassword(button){
    if(!isSuperAdmin)return;
    const email=(button.dataset.resetEmail||'').trim(),message=document.getElementById('pmAdminMessage');
    if(!email){if(message)message.textContent='This account has no email address.';return;}
    button.disabled=true;button.textContent='Sending…';if(message)message.textContent='';
    try{
      const result=await sb.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname});
      if(result.error)throw result.error;
      if(message)message.textContent='Password reset email sent to '+email+'. The user can set a new password using the secure email link.';
    }catch(ex){if(message)message.textContent='Could not send password reset email: '+ex.message;}
    finally{button.disabled=false;button.textContent='Send password reset';}
  }
  function showPasswordRecovery(){
    recoveryMode=true;
    let panel=document.getElementById('pmRecoveryModal');
    if(!panel){
      panel=document.createElement('div');panel.id='pmRecoveryModal';panel.className='hidden';
      panel.innerHTML='<div class="pm-recovery-card"><h2>Set a new password</h2><p>Choose a new password for your Production Management account.</p><form id="pmRecoveryForm"><label for="pmRecoveryPassword">New password</label><input id="pmRecoveryPassword" type="password" minlength="8" autocomplete="new-password" required><label for="pmRecoveryConfirm">Confirm new password</label><input id="pmRecoveryConfirm" type="password" minlength="8" autocomplete="new-password" required><div id="pmRecoveryError" class="pm-recovery-error" role="alert"></div><div class="pm-recovery-actions"><button type="button" id="pmRecoveryCancel">Cancel</button><button type="submit" class="primary" id="pmRecoverySubmit">Update password</button></div></form></div>';
      document.body.appendChild(panel);
      panel.querySelector('#pmRecoveryCancel').addEventListener('click',async function(){
        recoveryMode=false;panel.classList.add('hidden');await sb.auth.signOut();root.hidden=false;document.body.classList.add('pm-auth-pending');setMode('login');
      });
      panel.querySelector('#pmRecoveryForm').addEventListener('submit',async function(event){
        event.preventDefault();
        const password=panel.querySelector('#pmRecoveryPassword').value,confirm=panel.querySelector('#pmRecoveryConfirm').value;
        const error=panel.querySelector('#pmRecoveryError'),submit=panel.querySelector('#pmRecoverySubmit');
        error.textContent='';
        if(password.length<8){error.textContent='Use at least 8 characters.';return;}
        if(password!==confirm){error.textContent='The passwords do not match.';return;}
        submit.disabled=true;submit.textContent='Updating…';
        try{
          const result=await sb.auth.updateUser({password:password});if(result.error)throw result.error;
          panel.classList.add('hidden');recoveryMode=false;await sb.auth.signOut();
          root.hidden=false;document.body.classList.add('pm-auth-pending');setMode('login');
          showInfo('Your password has been updated. Sign in using your new password.');
        }catch(ex){error.textContent=ex.message;}
        finally{submit.disabled=false;submit.textContent='Update password';}
      });
    }
    root.hidden=true;document.body.classList.add('pm-auth-pending');panel.classList.remove('hidden');
    panel.querySelector('#pmRecoveryPassword').value='';panel.querySelector('#pmRecoveryConfirm').value='';panel.querySelector('#pmRecoveryError').textContent='';
  }

  async function authorizeUser(user){
    if(!user||!user.id||checkingUser) return;
    if(appAuthorized&&currentUserId===user.id) return;
    checkingUser=true;
    try{
      const result=await sb.from('pm_user_profiles')
        .select('id,email,full_name,role,is_active,is_super_admin,allowed_tabs')
        .eq('id',user.id)
        .maybeSingle();
      if(result.error) throw result.error;
      const profile=result.data;
      if(!profile||!profile.is_active||profile.role==='pending'){
        await sb.auth.signOut();
        root.hidden=false;
        document.body.classList.add('pm-auth-pending');
        appAuthorized=false;
        currentUserId=null;
        showError('Your account is registered but is awaiting approval by the super administrator.');
        return;
      }
      const newAllowed=profile.is_super_admin?TABS.map(function(t){return t.id;}):(profile.allowed_tabs||[]).filter(function(t){return TABS.some(function(d){return d.id===t;});});
      if(typeof window.pmLoadProductionData!=='function')throw new Error('Supabase production data loader is unavailable. Please refresh the page.');
      await window.pmLoadProductionData(sb);

      if(!newAllowed.length){
        await sb.auth.signOut();
        root.hidden=false;
        document.body.classList.add('pm-auth-pending');
        appAuthorized=false;
        currentUserId=null;
        showError('Your account is active, but no workspace tabs have been assigned. Please contact the super administrator.');
        return;
      }

      currentUserId=user.id;
      allowedTabs=newAllowed;
      isSuperAdmin=!!profile.is_super_admin;
      window.pmIsSuperAdmin=isSuperAdmin;
      window.pmCanEditSavedHours=isSuperAdmin||profile.role==='admin';
      window.pmCurrentRole=profile.role||'operator';
      window.pmCurrentUserId=user.id;
      appAuthorized=true;
      root.hidden=true;
      document.body.classList.remove('pm-auth-pending');

      ensureAdminPage();
      const adminNav=document.getElementById('pmAdminNav');
      if(adminNav) adminNav.style.display=isSuperAdmin?'flex':'none';
      document.querySelectorAll('.nav button[data-page]').forEach(function(button){
        const page=button.dataset.page;
        if(page==='pmAdmin') return;
        button.style.display=allowedTabs.indexOf(page)>=0?'flex':'none';
      });

      if(typeof baseShowPage==='function'){
        window.showPage=function(page){
          let target=page;
          if(target==='pmAdmin'&&!isSuperAdmin) target=allowedTabs[0]||'overview';
          if(target!=='pmAdmin'&&allowedTabs.indexOf(target)===-1) target=allowedTabs[0]||'overview';
          baseShowPage(target);
          if(target==='pmAdmin'){
            const crumb=document.getElementById('crumb');
            if(crumb) crumb.textContent='User Access';
            loadAdminUsers();
          }
        };
      }

      const requested=location.hash.replace(/^#/,'');
      const initial=(requested==='pmAdmin'&&isSuperAdmin)?'pmAdmin':(allowedTabs.indexOf(requested)>=0?requested:allowedTabs[0]);
      if(typeof baseShowPage==='function') baseShowPage(initial);
      if(initial==='pmAdmin'){
        const crumb=document.getElementById('crumb');
        if(crumb) crumb.textContent='User Access';
        loadAdminUsers();
      }
      history.replaceState({pmPage:initial},'',location.pathname+'#'+initial);

      const userBox=document.querySelector('.user');
      if(userBox){
        const display=profile.full_name||user.email||'Signed in';
        const roleLabel=profile.is_super_admin?'Super Administrator':profile.role;
        userBox.innerHTML=
          '<div class="avatar">'+escapeHtml(display.trim().charAt(0).toUpperCase()||'U')+'</div>'+
          '<div><strong style="color:#263449">'+escapeHtml(display)+'</strong><div style="font-size:11px;color:#64748b">'+escapeHtml(roleLabel)+'</div></div>'+
          '<button type="button" id="pmAuthSignOut" style="margin-left:12px;border:1px solid #dbe3ed;background:#fff;border-radius:8px;padding:8px 10px;cursor:pointer">Sign out</button>';
        document.getElementById('pmAuthSignOut').addEventListener('click',async function(){
          appAuthorized=false;
          currentUserId=null;
          isSuperAdmin=false;
          window.pmIsSuperAdmin=false;
          window.pmCanEditSavedHours=false;
          window.pmCurrentRole=null;
          window.pmCurrentUserId=null;
          allowedTabs=[];
          root.hidden=false;
          document.body.classList.add('pm-auth-pending');
          await sb.auth.signOut();
          setMode('login');
          showInfo('You have signed out.');
        });
      }
    }catch(ex){
      await sb.auth.signOut();
      root.hidden=false;
      document.body.classList.add('pm-auth-pending');
      appAuthorized=false;
      currentUserId=null;
      showError('Unable to verify your workspace access: '+ex.message);
    }finally{
      checkingUser=false;
    }
  }

  form.addEventListener('submit',async function(event){
    event.preventDefault();
    btn.disabled=true;
    err.textContent='';
    info.textContent='';
    try{
      if(mode==='signup'){
        const fullName=nameInput.value.trim();
        const email=emailInput.value.trim();
        const password=passwordInput.value;
        if(!fullName) throw new Error('Enter your full name.');
        if(password.length<8) throw new Error('Use a password with at least 8 characters.');
        signupInProgress=true;
        btn.textContent='Creating account…';
        const result=await sb.auth.signUp({
          email:email,
          password:password,
          options:{
            data:{full_name:fullName},
            emailRedirectTo:window.location.origin+window.location.pathname
          }
        });
        if(result.error) throw result.error;
        if(result.data&&result.data.session) await sb.auth.signOut();
        signupInProgress=false;
        form.reset();
        setMode('login');
        showInfo('Your account has been created. Check your email if confirmation is requested. Next, the super administrator must approve the account and assign your workspace tabs before you can sign in.');
      }else{
        btn.textContent='Signing in…';
        const result=await sb.auth.signInWithPassword({
          email:emailInput.value.trim(),
          password:passwordInput.value
        });
        if(result.error) throw result.error;
        if(result.data&&result.data.user) await authorizeUser(result.data.user);
      }
    }catch(ex){
      signupInProgress=false;
      showError(ex.message);
    }finally{
      btn.disabled=false;
      btn.textContent=mode==='signup'?'Create account':'Sign in';
    }
  });

  sb.auth.onAuthStateChange(function(event,session){
    if(event==='PASSWORD_RECOVERY'){
      window.setTimeout(showPasswordRecovery,0);
      return;
    }
    if(session&&session.user&&!signupInProgress&&!recoveryMode){
      window.setTimeout(function(){authorizeUser(session.user);},0);
    }else if(event==='SIGNED_OUT'){
      window.pmIsSuperAdmin=false;window.pmCanEditSavedHours=false;window.pmCurrentRole=null;window.pmCurrentUserId=null;
      appAuthorized=false;currentUserId=null;
      root.hidden=false;document.body.classList.add('pm-auth-pending');
    }
  });

  sb.auth.getSession().then(function(result){
    if(result.error){
      root.hidden=false;
      showError(result.error.message);
    }else if(result.data.session&&result.data.session.user&&!recoveryMode){
      // Keep the auth gate hidden while the saved session and workspace permissions restore.
      authorizeUser(result.data.session.user);
    }else if(!recoveryMode){
      root.hidden=false;
    }
  }).catch(function(ex){
    root.hidden=false;
    showError(ex.message);
  });
})();
