/* Local MT5 connector controls. Password is never saved to settings or logs. */
(()=>{
  'use strict';
  const $=selector=>document.querySelector(selector);
  const by=id=>document.getElementById(id);
  const modal=by('mt5Modal'),form=by('mt5Form');
  if(!modal||!window.shelld?.mt5Connect)return;
  let busy=false;
  const statusText=by('mt5Results');
  const setMessage=(text,error=false)=>{statusText.textContent=text;statusText.classList.toggle('error',error);};
  function display(state){
    const connected=!!state?.connected;
    by('mt5Signal').classList.toggle('connected',connected);
    by('mt5QuickLabel').textContent=connected?'MT5 Connected':'MT5 Connect';
    const panel=by('mt5ConnectionStatus');
    panel.classList.toggle('connected',connected);
    panel.querySelector('strong').textContent=connected?'MT5 подключён':'Не подключено';
    const label=state?.login?`Счёт ${state.login} · ${state.server||'MT5'}${state.auto?' · Auto 60s':''}`:'Подключение через установленный терминал Windows';
    panel.querySelector('small').textContent=label;
    by('mt5ConnectBtn').disabled=busy;
    by('mt5SyncBtn').disabled=busy||!connected;
    by('mt5DisconnectBtn').disabled=busy||!connected;
    if(connected&&state.at){
      const date=new Date(state.at);
      if(!Number.isNaN(+date)){
        const missing=Number(state.unresolved_positions||0);
        setMessage(`Последняя синхронизация: ${date.toLocaleString('ru-RU')} · Новых ${state.imported||0} · Обновлено ${state.updated||0} · Пропущено ${state.skipped||0}`+
          (missing?` · ${missing} ранее открытых позиций не удалось подтвердить по истории MT5`:'') ,Boolean(missing));
      }
    }
    if(state?.error)setMessage(state.error,true);
  }
  const update=()=>window.shelld.mt5Status().then(display).catch(()=>{});
  by('mt5OpenBtn').addEventListener('click',async()=>{
    if(typeof window.openModal==='function')window.openModal('mt5Modal');else modal.classList.add('open');
    await update();
  });
  async function during(promise){
    if(busy)return;
    busy=true;const state=await window.shelld.mt5Status().catch(()=>({}));display(state);
    try{
      const result=await promise();
      if(result?.status)display(result.status);
      await update();
      if(typeof window.refresh==='function')await window.refresh();
      return result;
    }catch(e){setMessage('Ошибка: '+String(e?.message||e),true);return null;}
    finally{busy=false;await update();}
  }
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const base=by('mt5Basis').value.trim().replace(',','.');
    if(base&&(!Number.isFinite(Number(base))||Number(base)<=0)){
      setMessage('База капитала должна быть положительным числом',true);return;
    }
    const config={
      login:by('mt5Login').value.trim(),server:by('mt5Server').value.trim(),
      password:by('mt5Password').value,terminal:by('mt5Terminal').value.trim(),
      python:by('mt5Python').value.trim(),days:Number(by('mt5Days').value),
      basis:base?Number(base):0,auto:by('mt5Auto').checked,
      rememberPassword:by('mt5Remember').checked
    };
    setMessage('Подключение к терминалу MT5 и чтение истории…');
    const response=await during(()=>window.shelld.mt5Connect(config));
    if(response&&window.shelldReloadAccounts)await window.shelldReloadAccounts();
    by('mt5Password').value='';
  });
  by('mt5SyncBtn').addEventListener('click',async()=>{
    setMessage('Проверяю новые закрытые сделки MT5…');
    await during(()=>window.shelld.mt5Sync());
  });
  by('mt5DisconnectBtn').addEventListener('click',async()=>{
    await during(()=>window.shelld.mt5Disconnect());
    setMessage('MT5 отключён. Пароль удалён из памяти подключения.');
  });
  window.shelld.onMt5Synced(async()=>{
    if(typeof window.refresh==='function')await window.refresh();
    await update();
  });
  window.addEventListener('pagehide',()=>{by('mt5Password').value='';});
  update();
})();

// Account profiles are loaded by account-ui.js. Refresh form when another profile is selected.
window.addEventListener('shelld-account-changed',async event=>{
 const a=event.detail?.profile||{};
 const by=id=>document.getElementById(id);
 by('mt5Login').value=a.mt5_login||'';
 by('mt5Server').value=a.mt5_server||'';
 by('mt5Python').value=a.mt5_python==='py'?'':(a.mt5_python||'');
 by('mt5Terminal').value=a.mt5_terminal||'';
 by('mt5Basis').value=a.mt5_basis||'';
 by('mt5Days').value=String(a.mt5_days||365);
 by('mt5Auto').checked=Boolean(a.mt5_auto);
 by('mt5Password').value='';
 const remembered=Boolean(event.detail.hasSavedPassword);
 by('mt5Remember').checked=remembered;
 by('mt5Password').required=!remembered;
 by('mt5RememberInfo').textContent=remembered?'Пароль сохранён в зашифрованном виде для этого профиля Windows. Можно подключиться, не вводя его снова.':'Пароль не сохранён. При включении опции он будет шифрован Windows после успешного подключения.';
});
