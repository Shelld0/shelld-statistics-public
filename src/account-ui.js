/* Shelld Statistics — account profiles and guarded account deletion. */
(()=>{
  'use strict';
  const by=id=>document.getElementById(id);
  const safeText=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let active=null,accounts=[],groups=[],creating=false,deletingId=null,submittingDelete=false,groupView=null;
  let showGroupLabels=false,groupNoticeTimer=null;
  window.shelldGroupViewId=()=>groupView;
  window.shelldShowGroupAccountLabels=false;
  window.shelldPortfolioWorkAccountId=null;
  // Profile settings and MT5 connection settings have separate owners. Never overwrite MT5 credentials from the account editor.
  const inputs={label:'accountLabel',currency:'accountCurrency',mt5_basis:'accountBasis'};
  const notice=text=>window.toast?window.toast(text):alert(text);
  const memberIds=group=>String(group?.member_ids||'').split(',').map(Number).filter(Number.isSafeInteger);
  function flashGroupNotice(message){
    const el=by('portfolioModeNotice');if(!el)return;
    clearTimeout(groupNoticeTimer);
    el.textContent=message;
    el.classList.remove('hidden','is-visible');
    requestAnimationFrame(()=>el.classList.add('is-visible'));
    groupNoticeTimer=setTimeout(()=>{
      el.classList.remove('is-visible');
      setTimeout(()=>{if(!el.classList.contains('is-visible'))el.classList.add('hidden');},260);
    },8000);
  }
  function editFields(profile){
    const p=profile||{};
    for(const [key,id] of Object.entries(inputs))by(id).value=p[key]??(key==='currency'?'EUR':'');
    by('accountFormTitle').textContent=creating?'Новый торговый счёт':'Настройки выбранного счёта';
    by('saveAccountBtn').textContent=creating?'Создать счёт':'Сохранить профиль';
    by('deleteSelectedAccountBtn').classList.toggle('hidden',creating);
    by('deleteSelectedAccountBtn').disabled=creating||accounts.length<=1;
    by('deleteSelectedAccountBtn').title=accounts.length<=1?'Последний профиль удалить нельзя':'';
  }
  function closeGroupSettings(){
    by('groupSettingsPopover').classList.add('hidden');
    by('groupSettingsBtn').setAttribute('aria-expanded','false');
  }
  function toggleGroupSettings(){
    if(!groupView)return;
    const pop=by('groupSettingsPopover'),open=pop.classList.contains('hidden');
    pop.classList.toggle('hidden',!open);
    by('groupSettingsBtn').setAttribute('aria-expanded',String(open));
    if(open)by('groupShowAccountLabels').focus();
  }
  by('groupSettingsBtn').addEventListener('click',toggleGroupSettings);
  document.addEventListener('pointerdown',event=>{
    if(!by('groupSettingsHolder').contains(event.target))closeGroupSettings();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!by('groupSettingsPopover').classList.contains('hidden')){
      event.preventDefault();event.stopImmediatePropagation();closeGroupSettings();by('groupSettingsBtn').focus();
    }
  },true);
  async function reload(){
    [accounts,active,groups]=await Promise.all([window.shelld.listAccounts(),window.shelld.activeAccount(),window.shelld.listGroups()]);
    if(groupView && !groups.some(g=>Number(g.id)===groupView))groupView=null;
    const select=by('accountSelect');
    select.innerHTML=accounts.map(a=>`<option value="${a.id}">${safeText(a.label)} · ${safeText(a.broker)}${a.archived_at?' · Архив':''}</option>`).join('')+
      groups.map(g=>`<option value="group:${g.id}">◎ ${safeText(g.name)} · ${g.members} сч.</option>`).join('');
    select.value=groupView?'group:'+groupView:String(active.profile.id);
    by('portfolioGroupMembers').innerHTML=accounts.map(a=>`<label class="portfolio-member"><input type="checkbox" name="portfolioMember" value="${a.id}"><span>${safeText(a.label)} · ${safeText(a.currency)}</span></label>`).join('');
    by('portfolioGroupsList').innerHTML=groups.length?groups.map(g=>`<div class="portfolio-group-item"><span>◎ ${safeText(g.name)} <small>${g.members} счетов</small></span><button type="button" class="secondary" data-view-group="${g.id}">Открыть</button><button class="secondary" type="button" data-delete-group="${g.id}" title="Удалить только группу, не счета">×</button></div>`).join(''):'<span class="portfolio-empty">Пока нет групп фаз. Выбери счета и создай группу.</span>';
    const isArchived=Boolean(active.profile.archived_at);
    by('archiveAccountBtn').textContent=isArchived?'↻ Вернуть из архива':'▧ Архивировать фазу';
    by('archiveAccountBtn').title='Архивация не удаляет сделки. Отключает текущую MT5-синхронизацию для этой фазы.';
    const groupMode=Boolean(groupView);
    const currentGroup=groups.find(g=>Number(g.id)===groupView);
    const members=groupMode?memberIds(currentGroup):[];
    const workAccount=active.profile;
    // The selected account is the WRITABLE work account even in the combined view.
    // Aggregate Dashboard/Journal/Analytics never change ownership of SQLite records.
    window.shelldReadOnlyPortfolio=groupMode; // combined list, do not blindly delete other account's trades
    window.shelldPortfolioWorkAccountId=workAccount.id;
    window.shelldShowGroupAccountLabels=showGroupLabels;
    // Group settings live beside the account switch in the top bar.
    // Writable group controls live in the existing account manager, never in
    // an extra toolbar above the dashboard.
    const holder=by('groupSettingsHolder');
    holder.classList.toggle('hidden',!groupMode);
    by('groupSettingsBtn').setAttribute('aria-label',`Настройки группы ${currentGroup?.name||''}`);
    by('groupShowAccountLabels').checked=showGroupLabels;
    if(!groupMode)closeGroupSettings();
    by('groupManagerControls').classList.toggle('hidden',!groupMode);
    if(groupMode){
      by('groupManagerTitle').textContent=`${currentGroup?.name||'Группа'} · рабочий счёт`;
      const workSelect=by('groupWorkAccount');
      workSelect.innerHTML=accounts.filter(a=>members.includes(a.id)).map(a=>`<option value="${a.id}">${safeText(a.label)}${a.archived_at?' · Архив':''}</option>`).join('');
      workSelect.value=String(workAccount.id);
      const join=by('groupJoinAccount');
      const remaining=accounts.filter(a=>!members.includes(a.id) && a.currency===workAccount.currency);
      join.innerHTML=remaining.length?remaining.map(a=>`<option value="${a.id}">${safeText(a.label)}</option>`).join(''):'<option value="">Нет доступных счетов</option>';
      by('groupAddMemberBtn').disabled=!remaining.length;
    }
    // Previously the group locked all workspaces and MT5. Only cross-account
    // edits remain guarded; the work account can still use all app functions.
    by('accountEditForm').querySelectorAll('input').forEach(el=>{el.disabled=false;});
    by('saveAccountBtn').disabled=false;
    by('archiveAccountBtn').disabled=false;
    by('deleteSelectedAccountBtn').disabled=accounts.length<=1;
    document.querySelectorAll('[data-add]').forEach(button=>{button.disabled=false;button.title=groupMode?`Новая сделка будет сохранена в счёт «${workAccount.label}»`:'';});
    const gb=by('portfolioModeNotice');if(gb && !groupMode){gb.classList.remove('is-visible');gb.classList.add('hidden');}
    by('accountModalList').innerHTML=accounts.map(a=>`<div class="account-card ${a.id===active.profile.id?'selected':''}">
      <button type="button" class="account-card-main" data-switch-account="${a.id}" aria-label="Выбрать счёт ${safeText(a.label)}">
        <strong>${safeText(a.label)}</strong><span>${safeText(a.broker)} · ${Number(a.trades_count||0)} сделок</span>
        ${a.id===active.profile.id?'<em>Активный</em>':''}${a.archived_at?'<em>Архив · история сохранена</em>':''}
      </button>
      <button type="button" class="account-card-delete" data-delete-account="${a.id}" aria-label="Удалить счёт ${safeText(a.label)}" title="Удалить этот счёт" ${accounts.length<=1?'disabled':''}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/></svg>
      </button>
    </div>`).join('');
    const mt5Button=by('mt5OpenBtn');if(mt5Button){mt5Button.disabled=false;mt5Button.title=groupMode?`Подключить MT5 к рабочему счёту «${workAccount.label}»`:'Подключить терминал MT5';}
    window.dispatchEvent(new CustomEvent('shelld-account-changed',{detail:active}));
  }
  async function useAccount(id){
    const already=Number(id)===active?.profile?.id;
    groupView=null;window.shelldReadOnlyPortfolio=false;closeGroupSettings();
    if(!already)await window.shelld.selectAccount(Number(id));
    creating=false;
    await window.resetShelldAfterAccountSwitch();
    await reload();
  }
  async function useGroup(id){
    const group=groups.find(g=>Number(g.id)===Number(id));
    if(!group)throw new Error('Группа не найдена');
    const ids=memberIds(group);
    if(!ids.length)throw new Error('В группе нет счетов');
    groupView=Number(id);creating=false;window.shelldReadOnlyPortfolio=true;closeGroupSettings();
    if(!ids.includes(Number(active?.profile.id))){
      const choice=accounts.find(a=>ids.includes(a.id)&&!a.archived_at)||accounts.find(a=>ids.includes(a.id));
      await window.shelld.selectAccount(choice.id);
    }
    await window.resetShelldAfterAccountSwitch();
    await reload();
    flashGroupNotice(`Объединённая статистика «${group.name}». Для MT5, Backtest, Trading Plans и импорта используется рабочий счёт.`);
  }
  async function useGroupWorkAccount(id){
    if(!groupView){await useAccount(id);return;}
    const group=groups.find(g=>Number(g.id)===groupView);
    if(!memberIds(group).includes(Number(id)))throw new Error('Этот счёт не входит в группу');
    if(Number(id)!==Number(active?.profile?.id))await window.shelld.selectAccount(Number(id));
    creating=false;
    await window.resetShelldAfterAccountSwitch(true); // keep current page in combined view
    await reload();
  }
  window.shelldSwitchToTradeAccount=async trade=>{
    if(!groupView)return true;
    if(Number(trade.account_id)===Number(active?.profile?.id))return true;
    // Opening a previous phase must not silently disconnect the active MT5 sync.
    const state=await window.shelld.mt5Status().catch(()=>({connected:false}));
    if(state.connected && !confirm('Эта сделка относится к другому счёту. Для просмотра подробностей необходимо переключить рабочий профиль, что отключит текущую MT5-синхронизацию. Переключиться?'))return false;
    await useGroupWorkAccount(trade.account_id);
    return true;
  };
  by('accountSelect').addEventListener('change',async e=>{
    try{if(String(e.target.value).startsWith('group:'))await useGroup(e.target.value.slice(6));else await useAccount(e.target.value);}catch(error){alert('Ошибка переключения счёта: '+error.message);await reload();}
  });
  by('groupWorkAccount').addEventListener('change',async e=>{
    try{await useGroupWorkAccount(e.target.value);notice('Рабочий счёт переключён. MT5 и новые записи будут относиться к нему.');}
    catch(error){notice('Ошибка: '+error.message);await reload();}
  });
  by('groupConnectMt5Btn').addEventListener('click',()=>by('mt5OpenBtn').click());
  by('groupAddMemberBtn').addEventListener('click',async()=>{
    const id=Number(by('groupJoinAccount').value);
    if(!groupView||!id)return;
    try{await window.shelld.addGroupMember(groupView,id);await reload();notice('Счёт добавлен в объединённую статистику');}
    catch(error){notice('Не удалось добавить счёт в группу: '+error.message);}
  });
  by('groupShowAccountLabels').addEventListener('change',async e=>{
    showGroupLabels=Boolean(e.target.checked);window.shelldShowGroupAccountLabels=showGroupLabels;
    try{await window.shelld.setSetting('group_account_labels',showGroupLabels?'1':'0');}
    catch(error){notice('Не удалось сохранить настройку: '+error.message);}
    if(typeof window.refresh==='function')await window.refresh();
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
  by('newAccountBtn').addEventListener('click',()=>{
    by('newAccountForm').reset();
    by('newAccountCurrency').value=active?.profile?.currency||'EUR';
    by('newAccountBasis').value=''; // Require a conscious choice for each phase.
    window.openModal('newAccountModal');setTimeout(()=>by('newAccountLabel').focus(),30);
  });
  by('newAccountForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const btn=by('newAccountSubmit');btn.disabled=true;
    let created=null;
    try{
      const payload={label:by('newAccountLabel').value.trim(),
        currency:by('newAccountCurrency').value.trim().toUpperCase(),mt5_basis:by('newAccountBasis').value.trim()};
      created=await window.shelld.createAccount(payload);
      if(groupView){
        const originalGroup=groupView;
        await window.shelld.addGroupMember(originalGroup,created.id);
        await reload();
        await useGroupWorkAccount(created.id);
        notice('Новый счёт создан и включён в группу как рабочий.');
      }else{
        await useAccount(created.id);
        notice('Счёт создан. Можно подключать следующую фазу MT5.');
      }
      window.openModal('accountModal');
    }catch(error){
      if(created){
        await reload().catch(()=>{});
        notice(`Счёт №${created.id} создан, но дальнейшее действие не удалось: ${error.message}. Повторно создавать счёт не нужно.`);
      }else notice('Не удалось создать счёт: '+error.message);
    }
    finally{btn.disabled=false;}
  });
  by('cleanupEmptyDuplicatesBtn').addEventListener('click',async()=>{
    const btn=by('cleanupEmptyDuplicatesBtn');btn.disabled=true;
    try{
      const preview=await window.shelld.previewEmptyDuplicates();
      if(!preview.count){notice('Пустых дубликатов нет. Счета с историей остаются без изменений.');return;}
      const names=preview.accounts.slice(0,6).map(a=>`№${a.id} ${a.label}`).join(', ');
      if(!confirm(`Удалить ${preview.count} только ПУСТЫХ повторных профилей?\n${names}${preview.count>6?'…':''}\n\nДо удаления программа создаст отдельную SQLite-копию. Счета со сделками, планами, скриншотами, группами или MT5-подключениями не удаляются.`))return;
      const result=await window.shelld.cleanupEmptyDuplicates();
      await reload();
      notice(`Удалено пустых дублей: ${result.removed}. Резервная копия сохранена.`);
    }catch(error){notice('Не удалось очистить дубликаты: '+error.message);}
    finally{btn.disabled=false;}
  });
  by('archiveAccountBtn').addEventListener('click',async()=>{
    const archived=Boolean(active?.profile?.archived_at);
    if(!archived && !confirm('Архивировать фазу «'+active.profile.label+'»? Сделки останутся в журнале, а MT5-синхронизация отключится.'))return;
    try{await window.shelld.archiveAccount(active.profile.id,!archived);await reload();notice(archived?'Фаза снова активна':'Фаза сохранена в архиве. Резервная копия создана.');}
    catch(e){notice('Не удалось изменить архив: '+e.message);}
  });
  by('portfolioGroupForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const ids=[...by('portfolioGroupMembers').querySelectorAll('input:checked')].map(n=>Number(n.value));
    try{await window.shelld.createGroup(by('portfolioGroupName').value.trim(),ids);by('portfolioGroupName').value='';await reload();notice('Группа фаз создана');}
    catch(e){notice('Группа: '+e.message);}
  });
  by('portfolioGroupsList').addEventListener('click',async e=>{
    const open=e.target.closest('[data-view-group]'),del=e.target.closest('[data-delete-group]');
    if(open){try{await useGroup(open.dataset.viewGroup);window.openModal('accountModal');}catch(ex){notice(ex.message);}return;}
    if(del){if(!confirm('Удалить группу? Сами счета и сделки останутся.'))return;
      try{await window.shelld.deleteGroup(Number(del.dataset.deleteGroup));if(groupView===Number(del.dataset.deleteGroup)){groupView=null;await window.resetShelldAfterAccountSwitch();}await reload();}catch(ex){notice(ex.message);}}
  });
  by('accountEditForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const profile=Object.fromEntries(Object.entries(inputs).map(([key,id])=>[key,by(id).value.trim()]));
    try{
      if(creating){const created=await window.shelld.createAccount(profile);await useAccount(created.id);}
      else{await window.shelld.updateAccount(profile);await reload();if(typeof window.refresh==='function')await window.refresh();}
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
  (async()=>{
    try{
      // Changed default in v0.8.12: show labels only when the user enables them.
      // One-time migration also turns off the old default-on setting; later
      // user preferences survive subsequent restarts and updates.
      const ready=await window.shelld.getSetting('group_account_labels_default_off_v0812');
      if(ready!=='1'){
        await window.shelld.setSetting('group_account_labels','0');
        await window.shelld.setSetting('group_account_labels_default_off_v0812','1');
      }
      showGroupLabels=(await window.shelld.getSetting('group_account_labels'))==='1';
      window.shelldShowGroupAccountLabels=showGroupLabels;
    }catch{showGroupLabels=false;window.shelldShowGroupAccountLabels=false;}
    await reload();
  })().catch(error=>console.error('Accounts could not be loaded:',error));
})();
