/* Daily SQLite backup controls. Manual export and restore remain available. */
(()=>{
'use strict';
const el=id=>document.getElementById(id);
async function refresh(){
  const status=await window.shelld.backupStatus();
  el('autoBackupEnabled').checked=status.enabled;
  el('autoBackupKeep').value=String(status.keep);
  const latest=status.latest?status.latest.replace(/^auto-/,'').replace(/\.sqlite$/,''):'ещё нет';
  el('autoBackupStatus').textContent=
    `Статус: ${status.enabled?'включено':'выключено'}\nПоследняя копия: ${latest}\nВсего копий: ${status.files}\nПапка: ${status.folder}`+
    (status.lastError?`\nОшибка создания: ${status.lastError}`:'');
  el('autoBackupStatus').style.whiteSpace='pre-line';
}
window.shelldOpenBackupPanel=()=>{openModal('backupModal');safe(refresh);};
el('saveBackupConfig').addEventListener('click',()=>safe(async()=>{
  await window.shelld.saveBackupSettings(el('autoBackupEnabled').checked,Number(el('autoBackupKeep').value));
  await refresh();toast('Настройки резервных копий сохранены');
}));
el('autoBackupRun').addEventListener('click',()=>safe(async()=>{
  const result=await window.shelld.makeAutoBackup();
  await refresh();if(!result.skipped)toast('Локальная резервная копия создана');
}));
el('autoBackupFolder').addEventListener('click',()=>safe(async()=>window.shelld.openAutoBackupFolder()));
el('manualBackupExport').addEventListener('click',()=>safe(async()=>{
  const result=await window.shelld.backup();
  if(result&&!result.canceled)toast('SQLite экспортирован, включая скриншоты');
}));
el('manualBackupRestore').addEventListener('click',()=>safe(async()=>{
  if(!confirm('Восстановление заменит текущую базу всех аккаунтов. Перед этим создадим защитную копию. Продолжить?'))return;
  await window.shelld.makeAutoBackup();
  const result=await window.shelld.restore();
  if(result.error)throw new Error(result.error);
  if(!result.canceled){
    closeTopModal();
    if(window.shelldReloadAccounts)await window.shelldReloadAccounts();
    await refresh?.();
    // Reloading is safer after a database restore because open editors have stale IDs.
    window.location.reload();
  }
}));
})();
