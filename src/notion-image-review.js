/* Confirm-or-skip ambiguous Notion screenshots before importing. No guessing by row order. */
(()=>{
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=t=>[t.number?`№ ${t.number}`:'Без №',t.opened_at||'Без даты',t.asset||'—',t.direction||'—',t.rr==null?'':`${t.rr}R`].filter(Boolean).join(' · ');
function render(preview,kind){
 const files=preview.unmatchedFiles||[];
 if(!files.length)return '';
 const opts=(preview.previewTrades||[]).map(t=>`<option value="${esc(t.key)}">${esc(label(t))}</option>`).join('');
 return `<details open class="notion-manual-review"><summary>Нужна проверка: ${files.length} фото без подтверждённой сделки</summary>
  <p>Для каждого фото выбери номер сделки. Нажми «Показать» для просмотра. Без выбора фото будет пропущено, но другие сделки сохранятся.</p>
  <div class="notion-manual-list" data-notion-review="${kind}">${files.map((f,i)=>`<div class="notion-manual-row" data-manual-index="${i}">
    <div class="notion-manual-filename" title="${esc(f)}">${esc(f)}</div>
    <button type="button" class="secondary" data-notion-show="${i}">Показать</button>
    <select data-notion-assign="${i}" aria-label="Сделка для ${esc(f)}"><option value="">Не привязывать</option>${opts}</select>
    <div class="notion-manual-image" hidden></div>
  </div>`).join('')}</div>
  <p class="notion-review-note">Если не уверен, оставь «Не привязывать». Сделки можно открыть позже и добавить снимки вручную.</p></details>`;
}
function assignments(preview,root){
 const files=preview?.unmatchedFiles||[];
 return files.flatMap((filename,index)=>{
  const select=root.querySelector(`[data-notion-assign="${index}"]`);
  return select?.value?[{filename,key:select.value}]:[];
 });
}
function bind(root,preview,kind){
 root.querySelectorAll('[data-notion-show]').forEach(button=>button.addEventListener('click',async()=>{
  const index=Number(button.dataset.notionShow),file=preview.unmatchedFiles?.[index];
  const target=button.closest('.notion-manual-row')?.querySelector('.notion-manual-image');
  if(!file||!target)return;
  if(target.firstElementChild){target.hidden=!target.hidden;return;}
  button.disabled=true;button.textContent='Загрузка…';
  try{
   const url=await window.shelld.previewNotionImage(kind,file);
   const img=document.createElement('img');img.src=url;img.alt=file;img.loading='lazy';
   target.replaceChildren(img);target.hidden=false;
   button.textContent='Скрыть / показать';
  }catch(e){target.textContent='Не удалось показать: '+e.message;target.hidden=false;button.textContent='Повторить';}
  finally{button.disabled=false;}
 }));
}
window.shelldNotionImageReview={render,assignments,bind};
})();
