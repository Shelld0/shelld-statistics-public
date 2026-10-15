/* Backtest-only Notion ZIP/CSV import dialog. */
(()=>{
'use strict';
const by=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plural=(n,one,few,many)=>{const x=Math.abs(Number(n)||0);return x%100>=11&&x%100<=14?many:x%10===1?one:x%10>=2&&x%10<=4?few:many};
let selected=false,previewed=null,target=null;
const confirm=by('btNotionImportConfirm');
const previewBox=by('btNotionPreview');
const risk=()=>by('btNotionRisk').value.trim();
const year=()=>by('btNotionFallbackYear').value.trim();
function message(text,err=false){previewBox.innerHTML=`<p class="${err?'bt-notion-warning':''}">${esc(text)}</p>`;}
function open(targetId){
 target=targetId||null;selected=false;previewed=null;confirm.disabled=true;
 by('btNotionRisk').value='1';by('btNotionFallbackYear').value=String(new Date().getFullYear());
 by('btNotionTargetDescription').textContent=target?
  'Добавить сделки в открытый Backtest: актив, год и стиль должны совпадать. Повторы будут пропущены.':
  'Создать отдельный Backtest по активу, году и стилю. Trading Journal и MT5 не изменяются.';
 message('Выбери ZIP с экспортом Notion или отдельный CSV.');
 window.openModal('notionBacktestModal');
}
function display(data){
 selected=true;previewed=data;confirm.disabled=!data.total;
 const projects=(data.projects||[]).map(p=>`<div class="bt-notion-project"><strong>${esc(p.title)}</strong><span class="bt-notion-meta">${Number(p.count)} сделок</span></div>`).join('');
 const sample=(data.examples||[]).map(r=>`<tr><td>${esc(r.date||'—')}</td><td>${esc(r.asset||'—')}</td><td>${esc(r.result)}</td><td>${r.rr==null?'—':esc(r.rr)+'R'}</td><td>${r.gain==null?'—':esc(r.gain)+'%'}</td></tr>`).join('');
 previewBox.innerHTML=`<strong>${esc(data.filename)}</strong><p>Уникальных сделок: <b>${data.total}</b> · Повторов в ZIP: ${data.duplicateRows} · Неполных: ${data.missing} · CSV: ${data.files.length}</p>
 <p class="bt-notion-meta">${data.riskPct==null?'Неизвестные проценты останутся пустыми':`Расчёт процента = R × ${esc(data.riskPct)}% риска`}. Перед импортом создаётся резервная копия SQLite.</p>
 <p class="bt-notion-meta">Скриншотов в ZIP: ${data.imagesInZip||0} · Привязано к сделкам: ${data.matchedImages||0} · Без однозначной привязки: ${data.unmatchedImages||0}.</p>
 ${window.shelldNotionImageReview.render(data,'backtest')}
 <div>${projects}</div><div class="bt-notion-sample"><table><thead><tr><th>Дата</th><th>Актив</th><th>Результат</th><th>R</th><th>%</th></tr></thead><tbody>${sample}</tbody></table></div>
 <p class="bt-notion-meta">Неизвестное время закрытия, R и прибыль можно заполнить позже. Повторный импорт в тот же проект не создаст дубликаты.</p>`;
 window.shelldNotionImageReview.bind(previewBox,data,'backtest');
}
by('importBacktestNotionBtn')?.addEventListener('click',()=>open(null));
by('appendBacktestNotionBtn')?.addEventListener('click',()=>{
 const id=Number(document.querySelector('#backtestRows tr[data-bt-id]')?.dataset?.btId);
 // Use the open project's ID from the renderer's stable public API.
 const projectId=window.shelldCurrentBacktest?.()??null;
 open(projectId);
});
by('btNotionChoose')?.addEventListener('click',async()=>{
 confirm.disabled=true;message('Проверяю ZIP / CSV…');
 try{
  const data=await window.shelld.previewNotionBacktest(risk(),target,year());
  if(data.canceled){message('Файл не выбран');return;}
  display(data);
  if(data.total>0&&by('btNotionAutoImport')?.checked&&!(data.unmatchedFiles||[]).length)confirm.click();
 }catch(e){message('Не удалось прочитать архив: '+e.message,true);}
});
for(const id of ['btNotionRisk','btNotionFallbackYear']){
 by(id)?.addEventListener('input',()=>{
  if(selected){confirm.disabled=true;message('Параметры изменены. Нажми Tab или Enter для пересчёта предпросмотра.');}
 });
 by(id)?.addEventListener('change',async()=>{
  if(!selected)return;
  try{display(await window.shelld.recalculateNotionBacktest(risk(),year()));}
  catch(e){message('Ошибка: '+e.message,true);confirm.disabled=true;}
 });
 by(id)?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();by(id).blur();}});
}
confirm?.addEventListener('click',async()=>{
 confirm.disabled=true;
 try{
  const assignments=window.shelldNotionImageReview.assignments(previewed,previewBox);
  const result=await window.shelld.importNotionBacktest(assignments);
  selected=false;
  window.shelldCloseModal?.('notionBacktestModal');
  const extra=result.unmatchedImages?` · ${result.unmatchedImages} изображений не привязано`:'';
  const repeated=result.duplicates?` · ${result.duplicates} повторов`:'';
  window.shelldToast?.(`Backtest: загружено ${result.imported} ${plural(result.imported,'сделка','сделки','сделок')} · ${result.imagesAdded||0} ${plural(result.imagesAdded,'скриншот','скриншота','скриншотов')}${repeated}${extra}`,8000);
  try{
    await window.refresh();
    const newId=result.projectIds?.[0];
    if(newId&&result.projectIds.length===1)await window.openImportedBacktest?.(newId);
  }catch(error){console.error('Backtest import succeeded, UI refresh failed:',error);}
 }catch(e){confirm.disabled=false;message('Импорт не выполнен: '+e.message,true);}
});
})();
