/* Non-destructive screenshot annotations and image-order drag/drop.
 * Never edits the original bytes, and every IPC request is account validated. */
(()=>{
'use strict';
const by=id=>document.getElementById(id);
const grids={
  tradeResultGrid:{type:'trade-results',owner:()=>editingTradeId,render:()=>renderResultGallery('tradeEditor'),selector:'.result-gallery-tile'},
  detailResultGrid:{type:'trade-results',owner:()=>detailTradeId,render:()=>renderResultGallery('tradeDetail'),selector:'.result-gallery-tile'},
  btResultGrid:{type:'backtest-results',owner:()=>selectedBacktestRowId,render:()=>renderResultGallery('backtest'),selector:'.result-gallery-tile'},
  screenshotGrid:{type:'trade-captures',owner:()=>detailTradeId,render:()=>renderScreenshots(detailTradeId),selector:'.capture-card'},
  btRowImageGrid:{type:'backtest-captures',owner:()=>selectedBacktestRowId,render:()=>renderBacktestImages(),selector:'.capture-card'},
  weeklyAssetModalImages:{type:'weekly-asset',owner:()=>selectedWeeklyAssetModalId,render:()=>renderWeeklyAssetModal(true),selector:'.stack-image-card'}
};
function keyOf(el){
  if(el.classList.contains('capture-card'))return el.hasAttribute('data-legacy-tf')?'legacy:'+el.dataset.legacyTf:'extra:'+el.dataset.imageId;
  if(el.classList.contains('stack-image-card'))return 'id:'+el.querySelector('[data-delete-plan-image]')?.dataset.deletePlanImage;
  const img=el.querySelector('[data-result-id]');
  if(img)return 'id:'+img.dataset.resultId;
  const pending=el.querySelector('[data-result-pending]');return pending?'pending:'+pending.dataset.resultPending:null;
}
function eligibleTiles(grid,cfg){return [...grid.querySelectorAll(cfg.selector)].filter(el=>Boolean(keyOf(el)));}
let suppressRender=new Set();
async function enhance(grid,cfg){
  const tiles=eligibleTiles(grid,cfg);
  if(!tiles.length)return;
  tiles.forEach(tile=>{
    tile.dataset.imageKey=keyOf(tile);
    tile.draggable=true;
    const img=tile.querySelector('img');if(img)img.draggable=false;
    if(!tile.querySelector('[data-annotate]')){
      const actions=document.createElement('div'); actions.className='image-workspace-actions';
      const editor=document.createElement('button');editor.type='button';editor.textContent='✎';editor.title='Рисовать поверх изображения (копия)';editor.setAttribute('aria-label','Редактировать скриншот');editor.setAttribute('data-annotate','');
      const drag=document.createElement('span');drag.textContent='⠿';drag.title='Перетяни для изменения порядка';drag.className='image-drag-hint';
      actions.append(editor,drag);tile.appendChild(actions);
    }
  });
  const owner=cfg.owner();
  if(owner==null)return;
  const saved=await window.shelld.getImageOrder(cfg.type,owner);
  if(!grid.isConnected||owner!==cfg.owner()||suppressRender.has(grid.id))return;
  const byKey=new Map(eligibleTiles(grid,cfg).map(item=>[item.dataset.imageKey,item]));
  // A future screenshot which was not in saved ordering goes at the end.
  let changed=false;
  const sorted=[...saved,...byKey.keys()].filter((key,index,all)=>all.indexOf(key)===index).filter(key=>byKey.has(key));
  suppressRender.add(grid.id);
  try{
    sorted.forEach(key=>{const tile=byKey.get(key);if(tile){grid.appendChild(tile);changed=true;}});
  }finally{queueMicrotask(()=>suppressRender.delete(grid.id));}
}
function bindGallery(grid,cfg){
  let scheduled=false;
  const schedule=()=>{
    if(scheduled||suppressRender.has(grid.id))return;
    scheduled=true;
    queueMicrotask(()=>{scheduled=false;if(!suppressRender.has(grid.id))enhance(grid,cfg).catch(e=>console.warn('Image reorder:',e.message));});
  };
  const observer=new MutationObserver(mutations=>{if(mutations.some(m=>m.type==='childList'&&m.target===grid))schedule();});
  observer.observe(grid,{childList:true});schedule();
}
let dragging=null;
for(const [id,cfg] of Object.entries(grids)){
  const grid=by(id);if(grid)bindGallery(grid,cfg);
}
document.addEventListener('dragstart',event=>{
  const tile=event.target.closest?.('[data-image-key]');if(!tile)return;
  const grid=tile.parentElement,cfg=grids[grid?.id];if(!cfg)return;
  dragging={gridId:grid.id,key:tile.dataset.imageKey,owner:cfg.owner()};
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain','shelld-image-order');
  tile.classList.add('image-dragging');
},true);
document.addEventListener('dragend',()=>{
  document.querySelectorAll('.image-dragging,.image-drop-target').forEach(el=>el.classList.remove('image-dragging','image-drop-target'));
  dragging=null;
},true);
document.addEventListener('dragover',event=>{
  const tile=event.target.closest?.('[data-image-key]');
  if(!tile||!dragging||tile.parentElement?.id!==dragging.gridId)return;
  event.preventDefault();event.dataTransfer.dropEffect='move';tile.classList.add('image-drop-target');
},true);
document.addEventListener('dragleave',event=>event.target.closest?.('[data-image-key]')?.classList.remove('image-drop-target'),true);
document.addEventListener('drop',event=>{
  const tile=event.target.closest?.('[data-image-key]');
  if(!tile||!dragging||tile.parentElement?.id!==dragging.gridId)return;
  event.preventDefault();event.stopPropagation();
  const {gridId,key,owner}=dragging;dragging=null;
  const cfg=grids[gridId],grid=by(gridId),target=tile.dataset.imageKey;
  if(!cfg||owner!==cfg.owner()||key===target)return;
  const old=eligibleTiles(grid,cfg).map(x=>x.dataset.imageKey),from=old.indexOf(key),to=old.indexOf(target);
  if(from<0||to<0)return;
  const next=[...old];next.splice(from,1);next.splice(to,0,key);
  safe(async()=>{
    if(owner==null){
      if(gridId!=='tradeResultGrid')return;
      // Pending screenshots are reordered before the new trade is saved.
      const indices=next.map(v=>Number(v.split(':')[1]));
      const oldPending=[...pendingTradeResultImages];pendingTradeResultImages=indices.map(i=>oldPending[i]);
    }else await window.shelld.saveImageOrder(cfg.type,owner,next);
    await cfg.render();toast('Порядок скриншотов сохранён');
  });
},true);

// Drawing canvas at natural image resolution. Original remains in its original row.
let sourceImage=null,sourceCtx=null,editorContext=null,drawActions=[],draft=null,previousCursor=null;
const canvas=by('imageEditCanvas'),ctx=canvas?.getContext('2d');
function editorColor(){return by('imageEditColor')?.value||'#f14f62';}
function strokeWidth(){return Number(by('imageEditWidth')?.value||4);}
function drawAction(action){
  if(!action||!ctx)return;
  ctx.save();ctx.strokeStyle=action.color;ctx.fillStyle=action.color;ctx.lineWidth=action.width;ctx.lineCap='round';ctx.lineJoin='round';
  if(action.kind==='text'){
    ctx.font=`700 ${Math.max(16,action.width*7)}px Inter, Arial, sans-serif`;
    ctx.textBaseline='top';ctx.fillText(action.text,action.start.x,action.start.y,Math.max(50,canvas.width-action.start.x-20));
  } else {
    const start=action.start,end=action.end||start;
    ctx.beginPath();ctx.moveTo(start.x,start.y);
    if(action.kind==='pen')for(const point of action.points||[])ctx.lineTo(point.x,point.y);
    else if(action.kind==='rect')ctx.rect(start.x,start.y,end.x-start.x,end.y-start.y);
    else ctx.lineTo(end.x,end.y);
    ctx.stroke();
    if(action.kind==='arrow'){
      const a=Math.atan2(end.y-start.y,end.x-start.x),head=Math.max(13,action.width*4);
      ctx.beginPath();ctx.moveTo(end.x,end.y);
      ctx.lineTo(end.x-head*Math.cos(a-.55),end.y-head*Math.sin(a-.55));
      ctx.moveTo(end.x,end.y);ctx.lineTo(end.x-head*Math.cos(a+.55),end.y-head*Math.sin(a+.55));ctx.stroke();
    }
  }
  ctx.restore();
}
function repaint(){
  if(!ctx||!sourceImage)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(sourceImage,0,0,canvas.width,canvas.height);
  drawActions.forEach(drawAction);if(draft)drawAction(draft);
  by('imageEditCounter').textContent=`${drawActions.length} элементов`;
}
function cursorPoint(event){const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)*canvas.width/r.width,y:(event.clientY-r.top)*canvas.height/r.height};}
canvas?.addEventListener('pointerdown',event=>{
  if(!sourceImage||event.button!==0)return;
  const start=cursorPoint(event),kind=by('imageEditTool').value;
  const action={kind,start,end:start,color:editorColor(),width:strokeWidth(),points:[start]};
  if(kind==='text'){
    const value=by('imageEditText').value.trim().slice(0,140);
    if(!value){toast('Сначала напиши текст в поле редактора');return;}
    action.text=value;drawActions.push(action);repaint();return;
  }
  draft=action;canvas.setPointerCapture(event.pointerId);repaint();
});
canvas?.addEventListener('pointermove',event=>{
  if(!draft)return;
  const point=cursorPoint(event);draft.end=point;
  if(draft.kind==='pen')draft.points.push(point);
  repaint();
});
function finishDrawing(){if(!draft)return;drawActions.push(draft);draft=null;repaint();}
canvas?.addEventListener('pointerup',finishDrawing);
canvas?.addEventListener('pointercancel',()=>{draft=null;repaint();});
by('imageEditUndo')?.addEventListener('click',()=>{drawActions.pop();repaint();});
by('imageEditClear')?.addEventListener('click',()=>{drawActions=[];draft=null;repaint();});
by('imageEditClose')?.addEventListener('click',()=>{closeTopModal();editorContext=null;});
by('imageEditDismiss')?.addEventListener('click',()=>{closeTopModal();editorContext=null;});
function openEditor(tile){
  const grid=tile.parentElement,cfg=grids[grid.id];if(!cfg)return;
  const image=tile.querySelector('img');if(!image?.src)return;
  const imageKey=tile.dataset.imageKey,owner=cfg.owner(),tf=tile.querySelector('select')?.value||'4H';
  // The current selected account/record is checked again before saving.
  editorContext={cfg,gridId:grid.id,owner,key:imageKey,tf};
  sourceImage=new Image();sourceImage.onload=()=>{
    const pixels=sourceImage.naturalWidth*sourceImage.naturalHeight;
    if(pixels>48_000_000){toast('Изображение слишком большое для рисования — оригинал не изменён');closeTopModal();return;}
    canvas.width=sourceImage.naturalWidth;canvas.height=sourceImage.naturalHeight;
    drawActions=[];draft=null;by('imageEditSize').textContent=`${canvas.width} × ${canvas.height}`;repaint();
  };
  sourceImage.onerror=()=>{toast('Не удалось открыть изображение');closeTopModal();};
  sourceImage.src=image.src;openModal('imageEditorModal');
}
document.addEventListener('click',event=>{
  const control=event.target.closest?.('[data-annotate]');if(!control)return;
  event.preventDefault();event.stopImmediatePropagation();
  const tile=control.closest('[data-image-key]');if(tile)openEditor(tile);
},true);
by('imageEditSave')?.addEventListener('click',()=>safe(async()=>{
  if(!editorContext||!sourceImage||!drawActions.length){toast('Сначала нарисуй что-нибудь');return;}
  const {cfg,owner,tf,gridId}=editorContext;
  if(owner!==cfg.owner())throw new Error('Счёт или сделка изменились. Открой редактор заново.');
  const dataUrl=canvas.toDataURL('image/png');
  const rawSize=Math.ceil((dataUrl.length-dataUrl.indexOf(',')-1)*3/4);
  if(rawSize>16*1024*1024)throw new Error('Размеченная копия больше 16 МБ. Уменьши исходное изображение.');
  if(gridId==='tradeResultGrid'&&owner==null)pendingTradeResultImages.push({dataUrl});
  else if(cfg.type==='trade-results')await window.shelld.addResultImage('trade',owner,dataUrl);
  else if(cfg.type==='backtest-results')await window.shelld.addResultImage('backtest',owner,dataUrl);
  else if(cfg.type==='trade-captures')await window.shelld.pasteExtraScreenshot(owner,tf,dataUrl);
  else if(cfg.type==='backtest-captures')await window.shelld.pasteBacktestImage(owner,tf,dataUrl);
  else if(cfg.type==='weekly-asset')await window.shelld.pastePlanImage(selectedWeekId,owner,dataUrl);
  closeTopModal();editorContext=null;
  await cfg.render();toast('Размеченная копия сохранена. Оригинал не изменён.');
}));
})();
