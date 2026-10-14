/* Shelld Statistics — account profiles and guarded account deletion. */
(()=>{
  'use strict';
  const by=id=>document.getElementById(id);
  const safeText=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let active=null,accounts=[],creating=false,deletingId=null,submittingDelete=false;
  const inputs={label:'accountLabel',broker:'accountBroker',mt5_login:'accountLogin',mt5_server:'accountServer',currency:'accountCurrency',mt5_basis:'accountBasis',mt5_python:'accountPython',mt5_terminal:'accountTerminal'};
  const notice=text=>window.toast?window.toast(text):alert(text);
  function editFields(profile){
    const p=profile||{};
    for(const [key,id] of Object.entries(inputs))by(id).value=p[key]??(key==='currency'?'EUR':'');
    by('accountFormTitle').textContent=creating?'Новый торговый счёт':'Настройки выбранного счёта';
    by('saveAccountBtn').textContent=creating?'Создать счёт':'Сохранить профиль';
    by('deleteSelectedAccountBtn').classList.toggle('hidden',creating);
    by('deleteSelectedAccountBtn').disabled=creating||accounts.length<=1;
    by('deleteSelectedAccountBtn').title=accounts.length<=1?'Последний профиль удалить нельзя':'';
  }
  async function reload(){
    [accounts,active]=await Promise.all([window.shelld.listAccounts(),window.shelld.activeAccount()]);
    const select=by('accountSelect');
    select.innerHTML=accounts.map(a=>`<option value="${a.id}">${safeText(a.label)} · ${safeText(a.broker)}</option>`).join('');
    select.value=String(active.profile.id);
    if(!creating)editFields(active.profile);
    by('accountModalList').innerHTML=accounts.map(a=>`<div class="account-card ${a.id===active.profile.id?'selected':''}">
      <button type="button" class="account-card-main" data-switch-account="${a.id}" aria-label="Выбрать счёт ${safeText(a.label)}">
        <strong>${safeText(a.label)}</strong><span>${safeText(a.broker)} · ${Number(a.trades_count||0)} сделок</span>
        ${a.id===active.profile.id?'<em>Активный</em>':''}
      </button>
      <button type="button" class="account-card-delete" data-delete-account="${a.id}" aria-label="Удалить счёт ${safeText(a.label)}" title="Удалить этот счёт" ${accounts.length<=1?'disabled':''}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/></svg>
      </button>
    </div>`).join('');
    window.dispatchEvent(new CustomEvent('shelld-account-changed',{detail:active}));
  }
  async function useAccount(id){
    if(Number(id)===active?.profile?.id)return;
    await window.shelld.selectAccount(Number(id));
    creating=false;
    await window.resetShelldAfterAccountSwitch();
    await reload();
  }
  by('accountSelect').addEventListener('change',async e=>{
    try{await useAccount(e.target.value);}catch(error){alert('Ошибка переключения счёта: '+error.message);await reload();}
  });
  by('manageAccountsBtn').addEventListener('click',async()=>{
    creating=false;await reload();window.openModal('accountModal');
  });
  by('accountModalList').addEventListener('click',async e=>{
    const erase=e.target.closest('[data-delete-account]');
    if(erase){showDeleteAccount(Number(erase.dataset.deleteAccount));return;}
    const row=e.target.closest('[data-switch-account]');if(!row)return;
    try{await useAccount(row.dataset.switchAccount);window.openModal('accountModal');}catch(error){alert(error.message);}
  });
  by('newAccountBtn').addEventListener('click',()=>{creating=true;editFields(null);by('accountLabel').focus();});
  by('accountEditForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const profile=Object.fromEntries(Object.entries(inputs).map(([key,id])=>[key,by(id).value.trim()]));
    try{
      if(creating){const created=await window.shelld.createAccount(profile);await useAccount(created.id);}
      else{await window.shelld.updateAccount(profile);await reload();}
      creating=false;editFields(active.profile);window.openModal('accountModal');
    }catch(error){alert('Не удалось сохранить счёт: '+error.message);}
  });
  by('deleteSelectedAccountBtn').addEventListener('click',()=>showDeleteAccount(active?.profile?.id));
  function showDeleteAccount(id){
    const profile=accounts.find(a=>a.id===Number(id));
    if(!profile)return;
    if(accounts.length<=1){notice('Нельзя удалить последний профиль. Сначала создай другой счёт.');return;}
    deletingId=profile.id;
    by('accountDeleteName').textContent=profile.label;
    by('accountDeleteSummary').textContent=`${profile.trades_count||0} сделок · ${profile.backtests_count||0} бектестов · ${profile.weeks_count||0} недельных планов · ${profile.plans_count||0} обычных планов`;
    by('accountDeleteNameInput').value='';
    by('confirmDeleteAccountBtn').disabled=true;
    by('confirmDeleteAccountBtn').textContent='Удалить счёт и его данные';
    window.openModal('accountDeleteModal');
    setTimeout(()=>by('accountDeleteNameInput').focus(),0);
  }
  by('accountDeleteNameInput').addEventListener('input',e=>{
    const account=accounts.find(a=>a.id===deletingId);
    by('confirmDeleteAccountBtn').disabled=submittingDelete||!account||e.target.value.trim()!==account.label;
  });
  by('accountDeleteForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(submittingDelete)return;
    const account=accounts.find(a=>a.id===deletingId);
    const entered=by('accountDeleteNameInput').value.trim();
    if(!account||entered!==account.label)return;
    submittingDelete=true;
    by('confirmDeleteAccountBtn').disabled=true;
    by('confirmDeleteAccountBtn').textContent='Удаление…';
    try{
      const result=await window.shelld.deleteAccount(account.id,entered);
      deletingId=null;creating=false;
      if(result.switchedTo!==null)await window.resetShelldAfterAccountSwitch();
      else by('accountDeleteModal').querySelector('[data-close]').click();
      await reload();
      by('accountDeleteBackupPath').textContent=result.backupPath;
      by('accountDeleteBackup').classList.remove('hidden');
      window.openModal('accountModal');
      notice('Счёт удалён. Резервная копия создана.');
      if(!result.secretRemoved)notice('Пароль удалённого профиля не удалось стереть: проверь хранилище Windows.');
    }catch(error){
      alert('Не удалось удалить счёт: '+error.message);
    }finally{
      submittingDelete=false;
      by('confirmDeleteAccountBtn').textContent='Удалить счёт и его данные';
      by('confirmDeleteAccountBtn').disabled=true;
    }
  });
  by('copyAccountBackupPath').addEventListener('click',()=>{
    window.shelld.copyText(by('accountDeleteBackupPath').textContent);
    notice('Путь к резервной копии скопирован');
  });
  window.shelldReloadAccounts=reload;
  reload().catch(error=>console.error('Accounts could not be loaded:',error));
})();
