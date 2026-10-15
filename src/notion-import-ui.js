/* Local-only Notion ZIP / CSV preview with configurable risk-to-percent conversion. */
(()=>{
 'use strict';
 const by=id=>document.getElementById(id);
 const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const show=(message,isError=false)=>{
   by('notionPreview').innerHTML=`<p class="${isError?'notion-error':''}">${safe(message)}</p>`;
 };
 const confirm=by('notionImportConfirm');
 const riskInput=by('notionRiskPct');
 const plural=(n,one,few,many)=>{const x=Math.abs(Number(n)||0);return x%100>=11&&x%100<=14?many:x%10===1?one:x%10>=2&&x%10<=4?few:many};
let selected=false,lastPreview=null;
 const risk=()=>riskInput.value.trim();
 const renderPreview=preview=>{
   selected=true;lastPreview=preview;
   const rows=(preview.examples||[]).map(t=>`<tr><td>${safe(t.date||'—')}</td>
     <td>${safe(t.asset||'—')}</td><td>${safe(t.result==='UNKNOWN'?'Не определён':t.result)}</td>
     <td>${t.gain===null?'—':safe(t.gain)+'%'}</td><td>${t.rr===null?'—':safe(t.rr)+'R'}</td>
     <td class="notion-csv-missing">${t.missing?.length?safe(t.missing.join(', ')):'Готово'}</td></tr>`).join('');
   const info=preview.fileCount>1?`· CSV-файлов в ZIP: ${preview.fileCount} · Повторов внутри ZIP: ${preview.duplicateRows}`:'';
   const label=preview.riskPct===null?'Риск не указан: отсутствующие проценты останутся неизвестными':
     `Пересчёт: R × ${preview.riskPct}% риска`;
   by('notionPreview').innerHTML=`<strong>${safe(preview.filename)}</strong>
     <p>К импорту: <b>${preview.valid}</b> · Неполных: ${preview.incomplete||0} ${info}</p>
     <p><strong>${safe(label)}</strong>. Время открытия и дата закрытия заполняются только если они были в файле.</p>
     <p>Скриншотов в ZIP: <b>${preview.imagesInZip||0}</b> · Привязано к сделкам: <b>${preview.matchedImages||0}</b> · Без однозначной привязки: <b>${preview.unmatchedImages||0}</b>.</p>
     ${window.shelldNotionImageReview.render(preview,'journal')}
     <div class="table-scroll"><table class="notion-preview-table"><thead><tr>
       <th>Дата</th><th>Актив</th><th>Статус</th><th>%</th><th>R</th><th>Можно дополнить</th>
     </tr></thead><tbody>${rows}</tbody></table></div>
     ${preview.invalidRows?.length?`<details><summary>Не прочитаны</summary><ul>${preview.invalidRows.map(v=>`<li>${safe(v.filename||v.line||'CSV')}: ${safe(v.reason)}</li>`).join('')}</ul></details>`:''}
     <p>Перед сохранением будет создан Backup. Повторная загрузка того же Notion ZIP не создаст одинаковые сделки. Отсутствующие поля сохраняются для будущего редактирования.</p>`;
   window.shelldNotionImageReview.bind(by('notionPreview'),preview,'journal');
   confirm.disabled=preview.valid===0;
 };
 by('notionImportBtn')?.addEventListener('click',()=>{
   selected=false;lastPreview=null;confirm.disabled=true;
   show('Выбери ZIP с экспортом Notion или отдельную таблицу CSV.');
   window.openModal('notionImportModal');
 });
 by('notionChooseFile')?.addEventListener('click',async()=>{
   confirm.disabled=true;show('Читаю ZIP / CSV…');
   try{
     const preview=await window.shelld.previewNotionCsv(risk());
     if(preview.canceled){show('Файл не выбран');return;}
     renderPreview(preview);
     if(preview.valid>0&&by('notionAutoImport')?.checked&&!(preview.unmatchedFiles||[]).length)confirm.click();
   }catch(error){show('Ошибка импорта: '+error.message,true);}
 });
 riskInput?.addEventListener('input',()=>{
   if(selected){confirm.disabled=true;show('Риск изменён. Для правильных процентов нажми Tab или Enter, чтобы пересчитать предварительный просмотр.');}
 });
 riskInput?.addEventListener('change',async()=>{
   if(!selected)return;
   try{renderPreview(await window.shelld.recalculateNotionImport(risk()));}
   catch(e){confirm.disabled=true;show('Ошибка: '+e.message,true);}
 });
 riskInput?.addEventListener('keydown',event=>{
   if(event.key==='Enter'){event.preventDefault();riskInput.blur();}
 });
 confirm?.addEventListener('click',async()=>{
   confirm.disabled=true;
   try{
     const assignments=window.shelldNotionImageReview.assignments(lastPreview,by('notionPreview'));
     const result=await window.shelld.importNotionCsv(assignments);
     selected=false;
     window.shelldCloseModal?.('notionImportModal');
     const extra=result.unmatchedImages?` · ${result.unmatchedImages} изображений не привязано`:'';
     const repeated=result.duplicates?` · ${result.duplicates} повторов`:'';
     window.shelldToast?.(`Trading Journal: загружено ${result.imported} ${plural(result.imported,'сделка','сделки','сделок')} · ${result.imagesAdded||0} ${plural(result.imagesAdded,'скриншот','скриншота','скриншотов')}${repeated}${extra}`,8000);
     try{if(typeof window.refresh==='function')await window.refresh();}
     catch(error){console.error('Notion import succeeded, UI refresh failed:',error);}
   }catch(error){confirm.disabled=false;show('Импорт не выполнен: '+error.message,true);}
 });
})();
