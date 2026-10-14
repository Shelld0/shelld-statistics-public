'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let trades = [], plans = [], weeklyPlans = [], backtests = [], weeklyAssetCache = new Map(), detailTradeId = null, editingTradeId = null, journalView = 'overview';
let monthCursor = new Date().getFullYear() * 12 + new Date().getMonth();
let quarterCursor = new Date().getFullYear() * 4 + Math.floor(new Date().getMonth() / 3);
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let initialPeriodSelected = false;
let selectedWeekId = null, selectedWeekAssetId = null, selectedBacktestId = null, selectedBacktestRowId = null;
let btRowsCache = [], viewerNatural = false;
const chartZoom = {};
const assetUniverse=['EURUSD','GBPUSD','GER40','USDJPY','XAUUSD','US100'];
const weeklyImageFrames=['1MN','1W','1D','12H','8H','6H','4H','2H','1H','30M','15M','5M','1M'];
let beSettings=window.ShelldBE.parse({});
const resolvedStatus = row => window.ShelldBE.effectiveResult(row,beSettings);
const evaluatedTrade = row => ({...row,result:resolvedStatus(row)});
let pendingTradeResultImages=[];
let resultFileTarget='trade';
let imagePickerContext=null;
let stagedCapturePaste=null;
let selectedWeeklyAssetModalId=null;
const tagValues = value => String(value||'').split(',').map(s=>s.trim()).filter(Boolean);
const tagPills = value => tagValues(value).map(tag=>`<span class="tag-chip">${esc(tag)}</span>`).join('') || '<span class="subtle">Нет тегов</span>';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => `${Number(n) >= 0 ? '+' : ''}${Number(n || 0).toFixed(1)}%`;
const dateValue = t => t.closed_at || t.opened_at;
const tradeTime = t => new Date(dateValue(t)).getTime() || 0;
const dateFmt = s => s ? new Date(s).toLocaleString('ru-RU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const pill = (v, cls = v) => `<span class="pill ${esc(cls)}">${esc(v)}</span>`;
const chrono = list => [...list].sort((a,b) => tradeTime(a) - tradeTime(b) || a.id - b.id);
const closedTrades = list => list.filter(t => window.ShelldStats.isClosed(t));
const orderedJournalTrades=() => [...trades].sort((a,b)=>{
  // First the earliest completed trade, then later completed trades; live OPEN positions last.
  const ac=window.ShelldStats.isClosed(a),bc=window.ShelldStats.isClosed(b);
  if(ac!==bc)return ac?-1:1;
  return (Date.parse(ac?a.closed_at:a.opened_at)||0)-(Date.parse(bc?b.closed_at:b.opened_at)||0) || Number(a.id)-Number(b.id);
});
const tradeNumber = id => orderedJournalTrades().findIndex(t=>Number(t.id)===Number(id))+1;
let toastTimer;
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),3500); }
async function safe(action) { try { return await action(); } catch(e) { toast('Ошибка: '+(e?.message || String(e))); return null; } }
function switchPage(id) {
  $$('.page').forEach(p=>p.classList.toggle('active',p.id===id));
  $$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
}
$$('.nav').forEach(b=>b.addEventListener('click',()=>{switchPage(b.dataset.page);if(b.dataset.page==='analytics'&&window.renderAdvancedAnalytics)window.renderAdvancedAnalytics(trades);}));
$$('[data-goto]').forEach(b=>b.addEventListener('click',()=>switchPage(b.dataset.goto)));
// A screenshot viewer can be opened on top of a trade editor. Close only the top layer.
const modalStack=[];
function openModal(id) {
  const element=$('#'+id);
  if(!element)return;
  if(!element.classList.contains('open')) modalStack.push(id);
  element.classList.add('open');
}
function closeTopModal() {
  while(modalStack.length){
    const id=modalStack.pop(),element=$('#'+id);
    if(element?.classList.contains('open')){element.classList.remove('open');break;}
  }
}
function closeModals() { $$('.modal-backdrop').forEach(m=>m.classList.remove('open')); modalStack.length=0; }
$$('[data-close]').forEach(b=>b.addEventListener('click',closeTopModal));
// Clicking the dimmed background never discards a trade or its unsaved notes.
document.addEventListener('keydown',e=>{
  if(e.key==='Escape' && $$('.modal-backdrop.open').length){e.preventDefault();e.stopImmediatePropagation();closeTopModal();}
},true);
function toLocalInput(date) {
  const pad = n => String(n).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function updateTradeDateButtons(){
  const f=$('#tradeForm');
  for(const field of ['opened_at','closed_at']){
    const value=f.elements[field]?.value||'';
    const label=document.querySelector(`[data-trade-date-display="${field}"]`);
    if(label)label.textContent=dateDisplay(value);
    document.querySelector(`[data-trade-date-field="${field}"]`)?.classList.toggle('is-set',Boolean(value));
  }
}
function newTrade() {
  editingTradeId=null;pendingTradeResultImages=[];
  const f=$('#tradeForm');f.reset(); f.elements.opened_at.value=toLocalInput(new Date());
  f.elements.trade_type.value='Swing';
  updateTradeDateButtons();
  updateTradePlanOptions('', '');
  $('#tradeForm .modal-head h2').textContent='Добавить сделку';
  $('#tradeForm button[type="submit"]').textContent='Сохранить сделку';
  openModal('tradeModal');renderResultGallery('tradeEditor');
}
$$('[data-add]').forEach(b=>b.addEventListener('click',newTrade));
function normalizeTrade(form) {
  const t = Object.fromEntries(new FormData(form).entries());
  const parseSigned=(value,label)=>{
    const raw=String(value??'').trim().replace(',','.');
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw))throw new Error(`Проверь поле «${label}»: введи число, например -1 или 2.5`);
    const number=Number(raw);
    if(!Number.isFinite(number))throw new Error(`Некорректное число в поле «${label}»`);
    return number;
  };
  // Preserve user-entered signs regardless of WIN/LOSS; do not force Math.abs().
  t.gain_pct=parseSigned(t.gain_pct,'Результат (%)');
  t.r_multiple=parseSigned(t.r_multiple,'Результат (R)');
  t.plan_id=t.plan_id||null; t.plan_asset_id=t.plan_asset_id||null;
  return t;
}
$('#tradeForm').addEventListener('submit',e=>{
  e.preventDefault(); safe(async()=>{
  const f=e.currentTarget, data=normalizeTrade(f);
  const existingId=editingTradeId;
  if(editingTradeId) await window.shelld.updateTrade(editingTradeId,data);
  else {
    const created=await window.shelld.addTrade(data);
    editingTradeId=Number(created.id);
  }
  // Persist staged screenshots only after the trade itself has a real SQLite ID.
  // Shift successful writes so a temporary failure cannot duplicate saved images.
  while(pendingTradeResultImages.length){
    await window.shelld.addResultImage('trade',editingTradeId,pendingTradeResultImages[0].dataUrl);
    pendingTradeResultImages.shift();
  }
  const updatedId=editingTradeId;
  editingTradeId=null;
  closeModals();await refresh();
  if(existingId) await openDetails(updatedId);
  toast(existingId?'Сделка обновлена':'Сделка и её скриншоты сохранены');
  });
});
$('#backupBtn').addEventListener('click',()=>{ if(window.shelldOpenBackupPanel) window.shelldOpenBackupPanel(); });
$('#backupBtn').addEventListener('contextmenu',e=>{
  e.preventDefault();safe(async()=>{
    if(!confirm('Восстановление заменит текущие сделки и изображения. Продолжить?'))return;
    const r=await window.shelld.restore();if(r.error)toast(r.error);
    else if(!r.canceled){if(window.shelldReloadAccounts)await window.shelldReloadAccounts();await refresh();toast('Резервная копия восстановлена');}
  });
});
$('#csvBtn').addEventListener('click',()=>safe(async()=>{
  const r=await window.shelld.exportCsv();if(!r.canceled)toast('CSV экспортирован');
}));
$('#themeBtn').addEventListener('click',()=>safe(async()=>{
  const light=document.documentElement.classList.toggle('light');await window.shelld.setSetting('theme',light?'light':'dark');
}));

// Common Notion-inspired curve: Dashboard, Journal and Backtest share axes and style.
let animateNextPeriodEquity=false;
function equityChart(svgId,dealList){
  const ordered=chrono(closedTrades(dealList)).map(t=>({...t,displayNumber:tradeNumber(t.id)}));
  return window.ShelldCurve.draw({
    svg:document.getElementById(svgId),tooltip:document.getElementById(svgId+'Tooltip'),
    rows:ordered,mode:'journal',open:trade=>openDetails(Number(trade.id))
  });
}
function attachTradeRowHandlers(container) {
  if(container.dataset.bound)return;
  container.dataset.bound='yes';
  container.addEventListener('click',e=>{
    const remove=e.target.closest('[data-delete]');
    if(remove){e.stopPropagation();safe(async()=>{
      if(confirm('Удалить эту сделку и прикреплённые скриншоты?')){
        await window.shelld.deleteTrade(Number(remove.dataset.delete));await refresh();toast('Сделка удалена');
      }
    });return;}
    const row=e.target.closest('[data-trade-row]');if(row)openDetails(Number(row.dataset.tradeRow));
  });
  container.addEventListener('keydown',e=>{
    const row=e.target.closest('[data-trade-row]');
    if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openDetails(Number(row.dataset.tradeRow));}
  });
}
function rowsHtml(list,full=false){
  if(!list.length)return `<tr><td colspan="${full?10:8}"><div class="empty"><strong>Пока нет сделок</strong>Нажми «Add Trade», чтобы добавить первую</div></td></tr>`;
  return list.map(t=>`<tr data-trade-row="${Number(t.id)}" tabindex="0" title="Открыть сделку №${tradeNumber(t.id)}">
    <td>#${tradeNumber(t.id)}</td><td>${esc(dateFmt(t.opened_at))}</td><td>${esc(dateFmt(t.closed_at))}</td>
    ${full?`<td class="journal-duration" title="Время между открытием и закрытием">${esc(holdingTime(t.opened_at,t.closed_at))}</td>`:''}
    <td>${pill(t.asset,t.asset)}</td><td>${pill(t.direction,t.direction)}</td><td>${esc(t.model==='MT5'?'—':(t.model||'—'))}</td>
    <td>${pill(resolvedStatus(t),resolvedStatus(t))}</td><td class="gain ${Number(t.gain_pct)>=0?'green':'red'}" ${t.result==='OPEN'&&t.source==='mt5'?'title="Плавающий P&L относительно указанной базы капитала. Обновляется при синхронизации MT5."':''}>${t.percent_known===0?esc(String(t.profit_money??''))+' '+esc(t.profit_currency||'')+' · % —':fmt(t.gain_pct)}</td>
    ${full?`<td><button type="button" class="delete-btn" data-delete="${t.id}" title="Удалить сделку">×</button></td>`:''}
    </tr>`).join('');
}
function filteredTrades(){
  const q=$('#searchTrades').value.trim().toLowerCase(),asset=$('#assetFilter').value,result=$('#resultFilter').value,model=$('#modelFilter').value;
  return orderedJournalTrades().reverse().filter(t=>(!q||`${t.asset} ${t.model} ${t.notes}`.toLowerCase().includes(q))&&(!asset||t.asset===asset)&&(!result||resolvedStatus(t)===result)&&(!model||t.model===model));
}
function selectedPeriodTrade(t) {
  if(journalView==='overview')return true;
  const time=tradeTime(t);if(!time)return false;
  const d=new Date(time);
  if(journalView==='monthly')return d.getFullYear()*12+d.getMonth()===monthCursor;
  if(journalView==='quarterly')return d.getFullYear()*4+Math.floor(d.getMonth()/3)===quarterCursor;
  return true;
}
function periodTrades() {return filteredTrades().filter(t=>selectedPeriodTrade(t));}
function calcStats(list){
  const s=window.ShelldStats.compute(list,'r_multiple',beSettings);
  return {...s,gain:s.totalGain,avgWin:s.averageWinR,wr:s.winRate,maxW:s.maxWin,maxL:s.maxLoss};
}
function renderStats(list,prefix){
  const s=calcStats(list),assets={};
  for(const t of s.closed){assets[t.asset]??={gain:0,count:0,priced:0};if(t.percent_known!==0&&t.percent_known!=='0'){assets[t.asset].gain+=Number(t.gain_pct||0);assets[t.asset].priced++;}assets[t.asset].count++;}
  const assetEntries=Object.entries(assets).sort((a,b)=>b[1].gain-a[1].gain);
  const best=s.closed.filter(t=>t.percent_known!==0&&t.percent_known!=='0').sort((a,b)=>Number(b.gain_pct)-Number(a.gain_pct))[0];
  const bestAsset=assetEntries.find(([,v])=>v.priced>0);
  const id = (dashboard,journal) => '#'+(prefix==='journal'?journal:dashboard);
  const put=(dashboard,journal,value)=>{$(id(dashboard,journal)).textContent=value;};
  const putHTML=(dashboard,journal,value)=>{$(id(dashboard,journal)).innerHTML=value;};
  const gainEl=$(id('totalGain','journalGain'));gainEl.textContent=s.pricedCount?fmt(s.gain):'—';gainEl.classList.toggle('red',s.gain<0);gainEl.classList.toggle('green',s.gain>=0);
  put('tradeCount','journalTradeCount',`${s.closedCount} закрыто · ${s.openCount} открыто${s.unpricedCount?' · '+s.unpricedCount+' без расчёта %':''}`);
  put('winRate','journalWinRate',`${s.wr.toFixed(1)}%`);
  put('winLoss','journalWinLoss',`${s.wins.length}W / ${s.losses.length}L · ${s.beCount} BE`);
  put('avgWin','journalAvgWin',s.winsWithKnownR?`${s.avgWin.toFixed(1)}R`:'—');
  put('totalTrades','journalTotalTrades',s.tradeCount);
  putHTML('winning','journalWinning',`<span class="tally-dot win"></span><span class="tally-label">Winning</span><strong>${s.wins.length}</strong>`);
  putHTML('losing','journalLosing',`<span class="tally-dot loss"></span><span class="tally-label">Losing</span><strong>${s.losses.length}</strong>`);
  put('maxWin','journalMaxWin',s.maxW);
  put('maxLoss','journalMaxLoss',s.maxL);
  put('bestTrade','journalBestTrade',best?fmt(best.gain_pct):'—');
  $(id('bestTradeMeta','journalBestTradeMeta')).innerHTML=best?`${pill(best.asset,best.asset)} <span class="meta-date">${esc(dateFmt(dateValue(best)))}</span>`:'—';
  put('bestAsset','journalBestAsset',bestAsset?fmt(bestAsset[1].gain):'—');
  $(id('bestAssetMeta','journalBestAssetMeta')).innerHTML=bestAsset?pill(bestAsset[0],bestAsset[0]):'—';
  for(const key of [id('bestTrade','journalBestTrade'),id('bestAsset','journalBestAsset')]){
    const el=$(key);el.classList.toggle('red',el.textContent.startsWith('-'));el.classList.toggle('green',!el.textContent.startsWith('-'));
  }
  const summary=$(id('assetSummary','journalAssetSummary'));
  summary.innerHTML=assetEntries.map(([asset,v])=>`<div class="asset-card"><div class="asset-top">${pill(asset,asset)}<span>${v.count} Trades</span></div><strong class="${v.gain>=0?'green':'red'}">${v.priced?fmt(v.gain):'—'}</strong></div>`).join('')||'<div class="empty">Здесь появится статистика по активам</div>';
  const chartId=prefix==='journal'?'journalEquityChart':'equityChart';
  equityChart(chartId,s.closed);
  put('chartCount','journalChartCount',`${s.pricedCount} / ${s.closedCount} trades`);
  put('chartEnd','journalChartEnd',fmt(s.gain));

}
function renderDashboard(){renderStats(trades,'dashboard');$('#recentRows').innerHTML=rowsHtml(orderedJournalTrades().slice(-7).reverse());}
function updatePeriodUI(){
  const enabled=journalView==='monthly'||journalView==='quarterly';
  $('#periodNav').classList.toggle('is-hidden',!enabled);
  $('#journalMonthly').classList.toggle('active',journalView==='monthly');
  $('#journalQuarterly').classList.toggle('active',journalView==='quarterly');
  if(!enabled)return;
  if(journalView==='monthly'){
    const year=Math.floor(monthCursor/12),month=((monthCursor%12)+12)%12;
    const monthName=new Intl.DateTimeFormat('ru-RU',{month:'long'}).format(new Date(year,month,1));
    $('#periodLabel').textContent=monthName[0].toUpperCase()+monthName.slice(1)+' '+year;
  }else{
    const year=Math.floor(quarterCursor/4),q=((quarterCursor%4)+4)%4+1;
    $('#periodLabel').textContent=`Q${q} ${year}`;
  }
  $('#periodCount').textContent=`${calcStats(periodTrades()).closed.length} trades`;
}
function renderReviewTables(list){
  const groups={monthly:{},quarterly:{}};
  for(const t of closedTrades(list)){
    const d=new Date(tradeTime(t));if(Number.isNaN(+d))continue;
    const y=d.getFullYear(),m=d.getMonth()+1;
    for(const [type,key] of [['monthly',`${y}-${String(m).padStart(2,'0')}`],['quarterly',`Q${Math.ceil(m/3)} ${y}`]]){
      (groups[type][key]??=[]).push(t);
    }
  }
  const makeRows=groups=>Object.keys(groups).sort().reverse().map(k=>{
    const s=calcStats(groups[k]),avgWinR=s.averageWinR;
    return `<tr><td>${esc(k)}</td><td>${s.closed.length}</td><td>${s.wr.toFixed(1)}%</td><td class="gain ${s.gain>=0?'green':'red'}">${s.pricedCount?fmt(s.gain):'—'}</td><td>${s.winsWithKnownR?avgWinR.toFixed(2)+'R':'—'}</td></tr>`;
  }).join('')||'<tr><td colspan="5"><div class="empty">Нет закрытых сделок</div></td></tr>';
  $('#monthlyRows').innerHTML=makeRows(groups.monthly);
  $('#quarterlyRows').innerHTML=makeRows(groups.quarterly);
}
function renderCalendar(list){
  const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth();
  $('#calendarMonthLabel').textContent=calendarCursor.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
  const daily={};
  for(const t of closedTrades(list)){
    const d=new Date(tradeTime(t));if(d.getFullYear()!==y||d.getMonth()!==m)continue;
    const day=d.getDate();daily[day]??={gain:0,count:0,priced:0};if(t.percent_known!==0&&t.percent_known!=='0'){daily[day].gain+=Number(t.gain_pct||0);daily[day].priced++;}daily[day].count++;
  }
  const first=(new Date(y,m,1).getDay()+6)%7,days=new Date(y,m+1,0).getDate();
  let html=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>`<div class="calendar-weekday">${d}</div>`).join('');
  for(let i=0;i<first;i++)html+='<div class="calendar-day muted-day"></div>';
  for(let i=1;i<=days;i++){
    const d=daily[i];html+=`<div class="calendar-day ${d?(d.gain>=0?'day-win':'day-loss'):''}"><span>${i}</span>${d?`<b>${d.priced?fmt(d.gain):'—'}</b><small>${d.count} сделок</small>`:''}</div>`;
  }
  $('#calendarGrid').innerHTML=html;
}
function renderTrades(){
  const list=periodTrades(),limit=Number($('#rowLimit').value||20),visible=list.slice(0,limit);
  $('#tradeRows').innerHTML=rowsHtml(visible,true);
  $('#showing').textContent=`Showing ${visible.length} of ${list.length} trades`;
}
function renderJournal(){
  updatePeriodUI();
  renderStats(periodTrades(),'journal');
  renderTrades();
  renderReviewTables(filteredTrades());
  renderCalendar(filteredTrades());
}
function setJournalView(view){
  if(view!==journalView&&view!=='calendar')animateNextPeriodEquity=true;
  journalView=view;
  $$('[data-journal-view]').forEach(b=>b.classList.toggle('active',b.dataset.journalView===view));
  $('#journalOverview').classList.toggle('active',view!=='calendar');
  $('#journalCalendar').classList.toggle('active',view==='calendar');
  $('#journal-trades-title').textContent=view==='overview'?'Сделки за период':view==='calendar'?'Все сделки':view==='monthly'?'Сделки за месяц':'Сделки за квартал';
  renderJournal();
}
$$('[data-journal-view]').forEach(b=>b.addEventListener('click',()=>setJournalView(b.dataset.journalView)));
$('#periodPrev').addEventListener('click',()=>{if(journalView==='monthly')monthCursor--;else quarterCursor--;animateNextPeriodEquity=true;renderJournal()});
$('#periodNext').addEventListener('click',()=>{if(journalView==='monthly')monthCursor++;else quarterCursor++;animateNextPeriodEquity=true;renderJournal()});
$('#calendarPrev').addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);renderCalendar(filteredTrades())});
$('#calendarNext').addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);renderCalendar(filteredTrades())});
['#searchTrades','#assetFilter','#resultFilter','#modelFilter','#rowLimit'].forEach(s=>$(s).addEventListener('input',renderJournal));
function renderPlans(){
  $('#weeklyPlanGrid').innerHTML=weeklyPlans.map(p=>{
    const assets=weeklyAssetCache.get(Number(p.id))||[];
    const linkedTrades=trades.filter(t=>Number(t.plan_id)===Number(p.id));
    const linkedAssetNames=[...new Set(linkedTrades.map(t=>t.asset).filter(Boolean))];
    return `<button type="button" class="weekly-card" data-open-week="${p.id}"><div class="weekly-card-top"><span class="eyebrow">НЕДЕЛЯ С ${esc(p.week_start)}</span><span class="card-arrow">↗</span></div><h3>${esc(p.title)}</h3><p>${esc((p.notes||'Добавь общий план на неделю').slice(0,155))}</p><div class="plan-meta">${assets.slice(0,5).map(a=>pill(a.asset,a.asset)).join('')}</div><div class="weekly-card-info"><span>${assets.length} активов</span><span>${linkedTrades.length} сделок привязано</span>${linkedAssetNames[0]?`<span>Активы в сделках: ${esc(linkedAssetNames.slice(0,3).join(', '))}</span>`:''}</div></button>`;
  }).join('')||'<div class="empty"><strong>Пока нет недельных планов</strong>Создай неделю, добавь EURUSD, GBPUSD или другой актив и свои скриншоты.</div>';
}
// A unified image library: arbitrary timeframes, multiple captures per frame,
// and lossless preservation of the original files in SQLite.
const standardTimeframes=['1MN','1W','1D','12H','8H','6H','4H','2H','1H','30M','15M','5M','1M'];
const timeframeLabel=tf=>tf==='1MN'?'1M · Месячный':tf==='1M'?'1m · Минутный':tf;
function timeframeOptions(current){
  const tf=String(current||'4H');
  const all=standardTimeframes.includes(tf)?standardTimeframes:[...standardTimeframes,tf];
  return all.map(item=>`<option value="${esc(item)}" ${tf===item?'selected':''}>${esc(timeframeLabel(item))}</option>`).join('')+'<option value="CUSTOM">Свой таймфрейм…</option>';
}
function screenshotCard(img,ctx){
  const key=img.legacy ? `data-legacy-tf="${esc(img.timeframe)}"` : `data-image-id="${Number(img.id)}"`;
  const move=ctx==='trade' ? (img.legacy?'data-move-legacy':'data-move-extra') : 'data-move-backtest-image';
  const remove=ctx==='trade' ? (img.legacy?'data-remove-screenshot':'data-remove-extra') : 'data-delete-backtest-image';
  const id=img.legacy ? img.timeframe : Number(img.id);
  return `<div class="capture-card" ${key}>
    <div class="capture-card-toolbar"><select aria-label="Таймфрейм скриншота" ${move}="${esc(id)}">${timeframeOptions(img.timeframe)}</select>
      <button type="button" class="capture-remove" ${remove}="${esc(id)}" title="Удалить скриншот">×</button></div>
    <img class="view-image" tabindex="0" src="${img.dataUrl}" alt="Скриншот ${esc(img.timeframe)}" title="Открыть в полном размере"/>
  </div>`;
}
function addCaptureButton(){return '<button type="button" class="capture-add" data-open-capture-picker>＋<span>Добавить скриншот</span><small>Выбери любой таймфрейм</small></button>';}
async function renderScreenshots(tradeId){
  const [legacy,extra]=await Promise.all([window.shelld.listScreenshots(tradeId),window.shelld.listExtraScreenshots(tradeId)]);
  const items=[...legacy.map(x=>({...x,legacy:true})),...extra].sort((a,b)=>Number(a.id||0)-Number(b.id||0));
  $('#screenshotGrid').innerHTML=items.map(x=>screenshotCard(x,'trade')).join('')+addCaptureButton();
}
function openCapturePicker(context){
  stagedCapturePaste=null;
  imagePickerContext=context;
  $('#screenshotTfForm').reset();$('#screenshotTfCustom').classList.add('hidden');
  openModal('screenshotTfModal');
}
$('#screenshotTfSelect').addEventListener('change',()=>{
  const other=$('#screenshotTfSelect').value==='CUSTOM';
  $('#screenshotTfCustom').classList.toggle('hidden',!other);
  if(other)$('#screenshotTfCustom').focus();
});
$('#screenshotTfForm').addEventListener('submit',event=>{event.preventDefault();safe(async()=>{
  let tf=$('#screenshotTfSelect').value;
  if(tf==='CUSTOM')tf=$('#screenshotTfCustom').value.trim().toUpperCase();
  if(!/^[A-Za-z0-9._-]{1,16}$/.test(tf))throw new Error('Таймфрейм должен содержать 1–16 символов: буквы и числа');
  const context=imagePickerContext;
  // Paste into a screenshot slot: first choose its timeframe, then store the queued clipboard image(s).
  const staged=stagedCapturePaste;
  stagedCapturePaste=null;
  closeTopModal();
  if(staged){
    if(staged.place!==context)throw new Error('Изменилась область вставки');
    if(staged.place==='backtest'&&selectedBacktestRowId==null)throw new Error('Выбери сделку бектеста');
    if(staged.place==='trade'&&detailTradeId==null)throw new Error('Выбери сделку');
    for(const dataUrl of staged.images){
      if(staged.place==='backtest')await window.shelld.pasteBacktestImage(selectedBacktestRowId,tf,dataUrl);
      else await window.shelld.pasteExtraScreenshot(detailTradeId,tf,dataUrl);
    }
    if(staged.place==='backtest')await renderBacktestImages();
    else await renderScreenshots(detailTradeId);
    toast(`${staged.images.length} скриншотов сохранено · ${tf}`);
    return;
  }
  if(context&&typeof context==='object'&&context.kind==='move'){
    if(context.place==='backtest')await window.shelld.moveBacktestImage(context.imageId,tf);
    else if(context.legacy)await window.shelld.moveLegacyScreenshot(detailTradeId,context.previous,tf);
    else await window.shelld.moveExtraScreenshot(context.imageId,tf);
    if(context.place==='backtest')await renderBacktestImages();
    else await renderScreenshots(detailTradeId);
    toast(`Таймфрейм изменён на ${tf}`);
    return;
  }
  if(context==='trade'&&detailTradeId!=null){
    const r=await window.shelld.addExtraScreenshot(detailTradeId,tf);
    if(!r?.canceled){await renderScreenshots(detailTradeId);toast(`Скриншот ${tf} сохранён`);}
  }else if(context==='backtest'&&selectedBacktestRowId!=null){
    const r=await window.shelld.addBacktestImage(selectedBacktestRowId,tf);
    if(!r?.canceled){await renderBacktestImages();toast(`Скриншот ${tf} сохранён`);}
  }
});});
async function openDetails(id){
  await safe(async()=>{
    const t=trades.find(x=>Number(x.id)===Number(id));if(!t){toast('Сделка не найдена');return;}
    detailTradeId=t.id;
    $('#detailsTitle').textContent=`Сделка №${tradeNumber(t.id)}`;
    $('#detailsSubtitle').textContent=`${t.asset} · ${dateFmt(dateValue(t))}`;
    const fields=[['АКТИВ',pill(t.asset,t.asset)],['НАПРАВЛЕНИЕ',pill(t.direction,t.direction)],['ТИП',esc(t.trade_type||'Swing')],['РЕЗУЛЬТАТ',pill(resolvedStatus(t),resolvedStatus(t))],['GAIN',t.percent_known===0?'Не рассчитан (укажи базу капитала)':`<strong class="${Number(t.gain_pct)>=0?'green':'red'}">${fmt(t.gain_pct)}</strong>`],['R MULTIPLE',t.r_known===0?'Неизвестен (нужен исходный риск)':`${Number(t.r_multiple||0).toFixed(1)}R`],['ОТКРЫТИЕ',esc(dateFmt(t.opened_at))],['ЗАКРЫТИЕ',esc(dateFmt(t.closed_at))],['МОДЕЛЬ',esc(t.model==='MT5'?'—':(t.model||'—'))],...(t.source==='mt5'?[['MT5 NET P&L',`${esc(String(t.profit_money??'—'))} ${esc(t.profit_currency||'')}`],['LOT',esc(String(t.mt5_volume??'—'))],['ЦЕНА ВХОДА',esc(String(t.mt5_open_price??'—'))],['ЦЕНА ВЫХОДА',esc(String(t.mt5_close_price??'—'))]]:[])];
    $('#detailsStats').innerHTML=fields.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('#detailNotes').textContent=t.notes?.trim()||'Заметки отсутствуют. Нажми «Редактировать», чтобы добавить анализ.';
    const wp=weeklyPlans.find(p=>Number(p.id)===Number(t.plan_id)), wa=(weeklyAssetCache.get(Number(t.plan_id))||[]).find(a=>Number(a.id)===Number(t.plan_asset_id));
    $('#detailLinkedPlan').innerHTML=wp?`<span class="eyebrow">ТОРГОВЫЙ ПЛАН</span><button type="button" class="linked-plan-button" data-open-linked-plan="${wp.id}" data-linked-asset="${wa?.id||''}">${esc(wp.title)} ${wa?pill(wa.asset,wa.asset):''} <span>Открыть план →</span></button>`:'';
    openModal('detailsModal');await Promise.all([renderScreenshots(t.id),renderResultGallery('tradeDetail')]);
  });
}
$('#screenshotGrid').addEventListener('click',e=>safe(async()=>{
  if(e.target.closest('[data-open-capture-picker]')){openCapturePicker('trade');return;}
  const legacy=e.target.closest('[data-remove-screenshot]'),extra=e.target.closest('[data-remove-extra]');
  if(legacy&&confirm('Удалить скриншот?')){await window.shelld.deleteScreenshot(detailTradeId,legacy.dataset.removeScreenshot);await renderScreenshots(detailTradeId);}
  if(extra&&confirm('Удалить скриншот?')){await window.shelld.deleteExtraScreenshot(Number(extra.dataset.removeExtra));await renderScreenshots(detailTradeId);}
}));
$('#screenshotGrid').addEventListener('change',e=>safe(async()=>{
  const old=e.target.closest('[data-move-legacy]'),extra=e.target.closest('[data-move-extra]');
  if((old||extra)&&e.target.value==='CUSTOM'){
    openCapturePicker({kind:'move',place:'trade',legacy:!!old,
      previous:old?.dataset.moveLegacy,imageId:extra?Number(extra.dataset.moveExtra):null});
    return;
  }
  if(old)await window.shelld.moveLegacyScreenshot(detailTradeId,old.dataset.moveLegacy,old.value);
  if(extra)await window.shelld.moveExtraScreenshot(Number(extra.dataset.moveExtra),extra.value);
  if(old||extra)await renderScreenshots(detailTradeId);
}));
// Screenshot paste: copy an image in TradingView/another program and press Ctrl+V.
// Only image clipboard items are intercepted. Plain text paste works normally.
const clipboardImageFiles = data => [...(data?.items||[])]
  .filter(item=>item.kind==='file'&&/^image\/(png|jpeg|webp)$/.test(item.type))
  .map(item=>item.getAsFile()).filter(Boolean);
function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('Не удалось прочитать изображение из буфера обмена'));
    reader.readAsDataURL(file);
  });
}
// Result screenshots are a separate unlimited album, with no timeframe required.
// Ctrl+V inside an editor goes here; Ctrl+V inside the timeframe picker keeps its old behavior.
function resultOwner(place){
  if(place==='tradeEditor')return {kind:'trade',id:editingTradeId,grid:'#tradeResultGrid',counter:'#tradeResultCount'};
  if(place==='tradeDetail')return {kind:'trade',id:detailTradeId,grid:'#detailResultGrid',counter:'#detailResultCount'};
  if(place==='backtest')return {kind:'backtest',id:selectedBacktestRowId,grid:'#btResultGrid',counter:'#btResultCount'};
  throw new Error('Неверный раздел скриншотов');
}
function resultCard(image,index,pending){
  const attr=pending?`data-result-pending="${index}"`:`data-result-id="${Number(image.id)}"`;
  return `<div class="result-gallery-tile">
    <img class="view-image" src="${image.dataUrl}" alt="Результат, скриншот ${index+1}" tabindex="0" title="Открыть оригинал">
    <div class="result-gallery-tile-footer"><span>№ ${index+1}</span>
      <button type="button" class="result-gallery-remove" ${attr} title="Удалить изображение" aria-label="Удалить изображение ${index+1}">×</button>
    </div>
  </div>`;
}
async function renderResultGallery(place){
  const owner=resultOwner(place);
  const images=owner.id==null ? (place==='tradeEditor'?pendingTradeResultImages:[]) : await window.shelld.listResultImages(owner.kind,owner.id);
  const grid=$(owner.grid);
  if(!grid)return;
  grid.innerHTML=images.map((item,i)=>resultCard(item,i,owner.id==null)).join('')+
    `<button type="button" class="result-gallery-add" data-result-add="${place}" aria-label="Добавить скриншоты результата">
      <span>＋</span><strong>Добавить скриншот</strong><small>Ctrl+V или файлы PNG / JPG / WEBP</small></button>`;
  $(owner.counter).textContent=`${images.length} ${images.length===1?'изображение':images.length>=2&&images.length<=4?'изображения':'изображений'}`;
  if(place==='tradeEditor')$('#tradeResultHint').textContent=owner.id==null
    ?'После сохранения новой сделки эти изображения будут записаны в SQLite.'
    :'Скриншоты сохраняются сразу и не заменяют ранее добавленные.';
}
async function appendResultFiles(place,files){
  const owner=resultOwner(place);
  const incoming=[...files];
  if(!incoming.length)return;
  let count=0;
  for(const file of incoming){
    if(!file || !/^image\/(png|jpeg|webp)$/.test(file.type))throw new Error('Нужны изображения PNG, JPG или WEBP');
    if(file.size>16*1024*1024)throw new Error('Скриншот должен быть не больше 16 МБ');
    const dataUrl=await fileToDataURL(file);
    if(owner.id==null){
      if(place!=='tradeEditor')throw new Error('Сначала сохрани сделку');
      pendingTradeResultImages.push({dataUrl});
    }else await window.shelld.addResultImage(owner.kind,owner.id,dataUrl);
    count++;
  }
  await renderResultGallery(place);
  toast(`Добавлено скриншотов в «Результат»: ${count}`);
}
document.addEventListener('click',event=>{
  const add=event.target.closest('[data-result-add]');
  if(add){resultFileTarget=add.dataset.resultAdd;$('#resultImageFileInput').value='';$('#resultImageFileInput').click();return;}
  const remove=event.target.closest('[data-result-id],[data-result-pending]');
  if(!remove)return;
  const grid=remove.closest('.result-gallery-grid');
  const place=grid?.id==='tradeResultGrid'?'tradeEditor':grid?.id==='detailResultGrid'?'tradeDetail':grid?.id==='btResultGrid'?'backtest':null;
  if(!place)return;
  if(!confirm('Удалить этот скриншот результата?'))return;
  safe(async()=>{
    if(remove.dataset.resultPending!==undefined){pendingTradeResultImages.splice(Number(remove.dataset.resultPending),1);}
    else{const owner=resultOwner(place);await window.shelld.deleteResultImage(owner.kind,Number(remove.dataset.resultId));}
    await renderResultGallery(place);
    // The same album may be visible in another editor the next time it opens.
  });
});
$('#resultImageFileInput').addEventListener('change',event=>{
  const files=[...event.target.files];const place=resultFileTarget;
  event.target.value='';safe(()=>appendResultFiles(place,files));
});
for(const [selector,place] of [['#tradeResultGrid','tradeEditor'],['#detailResultGrid','tradeDetail'],['#btResultGrid','backtest']]){
  const grid=$(selector);
  grid.addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files'))event.preventDefault();});
  grid.addEventListener('drop',event=>{event.preventDefault();safe(()=>appendResultFiles(place,event.dataTransfer.files));});
}
// Target screenshots by the *pointer's location*, not by whichever modal opened first.
// Result and timeframe galleries can now coexist in the same Backtest editor.
let pointerPasteX=-1,pointerPasteY=-1,hoveredUpload=null;
function pasteDestination(element){
  if(!element?.closest)return null;
  const backdrop=element.closest('.modal-backdrop');
  if(!backdrop?.classList.contains('open'))return null;
  const grid=element.closest('.result-gallery-grid');
  if(grid){
    const place={tradeResultGrid:'tradeEditor',detailResultGrid:'tradeDetail',btResultGrid:'backtest'}[grid.id];
    if(place)return {kind:'result',place,element:element.closest('.result-gallery-add')||grid};
  }
  if(element.closest('#weeklyAssetModalImages') && $('#weeklyAssetModal')?.classList.contains('open')){
    return {kind:'weekly',element:element.closest('#weeklyAssetModalAddImage')||$('#weeklyAssetModalImages')};
  }
  const capture=element.closest('.capture-card,.capture-add');
  if(capture){
    const place=capture.closest('#btRowImageGrid')?'backtest':capture.closest('#screenshotGrid')?'trade':null;
    if(place){
      const select=capture.querySelector('select');
      return {kind:select?'capture-frame':'capture-picker',place,timeframe:select?.value||null,element:capture};
    }
  }
  if(backdrop.id==='screenshotTfModal'&&$('#screenshotTfModal')?.classList.contains('open')&&
     (imagePickerContext==='trade'||imagePickerContext==='backtest')){
    return {kind:'picker',place:imagePickerContext,timeframe:$('#screenshotTfSelect').value,element:backdrop.querySelector('.modal')};
  }
  return null;
}
function currentPasteDestination(){
  const pointed=pointerPasteX>=0&&pointerPasteY>=0?
    pasteDestination(document.elementFromPoint(pointerPasteX,pointerPasteY)):null;
  return pointed||pasteDestination(document.activeElement);
}
function showPasteHover(element){
  const next=pasteDestination(element)?.element||null;
  const previous=hoveredUpload;
  if(previous===next)return;
  previous?.classList?.remove('paste-hover');
  hoveredUpload=next;
  if(next?.matches?.('.capture-card,.capture-add,.result-gallery-add,.upload-wide-btn'))next.classList.add('paste-hover');
}
document.addEventListener('pointermove',event=>{
  pointerPasteX=event.clientX;pointerPasteY=event.clientY;
  showPasteHover(event.target);
},{passive:true});
window.addEventListener('blur',()=>{pointerPasteX=-1;pointerPasteY=-1;showPasteHover(null);});
async function pasteResultDataURLs(place,images){
  const owner=resultOwner(place);
  for(const dataUrl of images){
    if(owner.id==null){
      if(place!=='tradeEditor')throw new Error('Сначала создай сделку');
      pendingTradeResultImages.push({dataUrl});
    }else await window.shelld.addResultImage(owner.kind,owner.id,dataUrl);
  }
  await renderResultGallery(place);
  toast(`Добавлено в «Результат»: ${images.length}`);
}
async function importClipboardTo(destination,files){
  const images=[];
  if(files.length){
    for(const file of files){
      if(file.size>16*1024*1024)throw new Error('Скриншот должен быть не больше 16 МБ');
      images.push(await fileToDataURL(file));
    }
  }else{
    const native=await window.shelld.readClipboardImage();
    if(native)images.push(native);
  }
  if(!images.length){toast('В буфере обмена нет изображения');return;}
  if(destination.kind==='result'){
    await pasteResultDataURLs(destination.place,images);
  }else if(destination.kind==='weekly'){
    if(selectedWeekId==null||selectedWeeklyAssetModalId==null)throw new Error('Сначала открой актив плана');
    for(const dataUrl of images)await window.shelld.pastePlanImage(selectedWeekId,selectedWeeklyAssetModalId,dataUrl);
    await renderWeeklyAssetModal(true);
    toast(`Скриншотов в недельном плане: ${images.length}`);
  }else if(destination.kind==='capture-frame'||destination.kind==='picker'){
    if(destination.kind==='picker')closeTopModal();
    const tf=destination.timeframe;
    if(!tf||tf==='CUSTOM'){
      if(destination.kind==='capture-frame')openCapturePicker(destination.place);
      stagedCapturePaste={place:destination.place,images};
      toast('Выбери таймфрейм для скриншота');
      return;
    }
    if(destination.place==='trade'){
      if(detailTradeId==null)throw new Error('Сначала выбери сделку');
      for(const dataUrl of images)await window.shelld.pasteExtraScreenshot(detailTradeId,tf,dataUrl);
      await renderScreenshots(detailTradeId);
    }else{
      if(selectedBacktestRowId==null)throw new Error('Сначала выбери сделку бектеста');
      for(const dataUrl of images)await window.shelld.pasteBacktestImage(selectedBacktestRowId,tf,dataUrl);
      await renderBacktestImages();
    }
    toast(`Скриншотов ${tf}: ${images.length}`);
  }else if(destination.kind==='capture-picker'){
    openCapturePicker(destination.place);
    stagedCapturePaste={place:destination.place,images};
    toast('Выбери таймфрейм, затем нажми «Выбрать изображение»');
  }
}
document.addEventListener('paste',event=>{
  const types=[...(event.clipboardData?.types||[])];
  const files=clipboardImageFiles(event.clipboardData);
  // Don't steal ordinary Ctrl+V text from analysis fields.
  if(!files.length&&types.includes('text/plain')&&!types.includes('Files')&&!types.includes('image/png'))return;
  const destination=currentPasteDestination();
  if(!destination)return;
  event.preventDefault();
  safe(()=>importClipboardTo(destination,files));
});
// Legacy invisible controls remain for compatibility with existing markup.
function renderExtraScreenshots(){return Promise.resolve();}
$('#addTradeExtraScreenshot').addEventListener('click',()=>openCapturePicker('trade'));

$('#detailCloseBtn').addEventListener('click',closeModals);
$('#detailEditBtn').addEventListener('click',()=>{
  const t=trades.find(x=>Number(x.id)===Number(detailTradeId));if(!t)return;
  closeModals();editingTradeId=t.id;
  const f=$('#tradeForm');f.reset();
  if(!Array.from(f.elements.asset.options).some(o=>o.value===t.asset))f.elements.asset.add(new Option(t.asset,t.asset));
  for(const key of ['opened_at','closed_at','asset','direction','model','result','gain_pct','r_multiple','notes','trade_type']){
    if(f.elements[key])f.elements[key].value=(key==='model'&&t[key]==='MT5')?'':(t[key]??(key==='trade_type'?'Swing':''));
  }
  updateTradeDateButtons();
  updateTradePlanOptions(t.plan_id||'',t.plan_asset_id||'');
  $('#tradeForm .modal-head h2').textContent=`Редактировать сделку №${tradeNumber(t.id)}`;
  $('#tradeForm button[type="submit"]').textContent='Сохранить изменения';
  pendingTradeResultImages=[];
  openModal('tradeModal');renderResultGallery('tradeEditor');
});
async function refresh(){
  [trades,plans,weeklyPlans,backtests]=await Promise.all([
    window.shelld.listTrades(),window.shelld.listPlans(),window.shelld.listWeeklyPlans(),window.shelld.listBacktests()]);
  const assetPairs=await Promise.all(weeklyPlans.map(async p=>[Number(p.id),await window.shelld.listWeeklyAssets(p.id)]));
  weeklyAssetCache=new Map(assetPairs);
  if(!$('#tradeModal').classList.contains('open'))updateTradePlanOptions('','');
  if(!initialPeriodSelected){
    const last=chrono(closedTrades(trades)).at(-1);
    if(last){const d=new Date(tradeTime(last));monthCursor=d.getFullYear()*12+d.getMonth();quarterCursor=d.getFullYear()*4+Math.floor(d.getMonth()/3);calendarCursor=new Date(d.getFullYear(),d.getMonth(),1);}
    initialPeriodSelected=true;
  }
  const assetFilter=$('#assetFilter'),assetSelected=assetFilter.value;
  const assets=[...new Set(trades.map(t=>String(t.asset||'').trim()).filter(Boolean))].sort();
  assetFilter.innerHTML='<option value="">Все активы</option>'+assets.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');
  assetFilter.value=assets.includes(assetSelected)?assetSelected:'';
  const tradeAssetField=$('#tradeForm').elements.asset;
  for(const asset of assets){if(!Array.from(tradeAssetField.options).some(o=>o.value===asset))tradeAssetField.add(new Option(asset,asset));}
  const mf=$('#modelFilter'),selected=mf.value,models=[...new Set(trades.map(t=>(t.model||'').trim()).filter(Boolean))].sort();
  mf.innerHTML='<option value="">Все модели</option>'+models.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  mf.value=models.includes(selected)?selected:'';
  renderDashboard();renderJournal();renderPlans();await renderBacktests();
  if(window.renderAdvancedAnalytics)window.renderAdvancedAnalytics(trades);
}

// v0.5 — Weekly plans, separate backtests and original-resolution image viewer.
function mondayISO(date = new Date()) {
  const d = new Date(date.getFullYear(),date.getMonth(),date.getDate());
  d.setDate(d.getDate() - ((d.getDay()+6)%7));
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function updateTradePlanOptions(planId='',assetId='') {
  const select=$('#tradePlanSelect'),assetSelect=$('#tradePlanAssetSelect');
  const previous=planId || '';
  select.innerHTML='<option value="">Без плана</option>'+weeklyPlans.map(p=>`<option value="${p.id}">${esc(p.week_start)} · ${esc(p.title)}</option>`).join('');
  select.value=weeklyPlans.some(p=>String(p.id)===String(previous))?String(previous):'';
  const active=weeklyAssetCache.get(Number(select.value))||[];
  assetSelect.innerHTML='<option value="">Общий план</option>'+active.map(a=>`<option value="${a.id}">${esc(a.asset)}</option>`).join('');
  assetSelect.value=active.some(a=>String(a.id)===String(assetId))?String(assetId):'';
}
$('#tradePlanSelect').addEventListener('change',()=>updateTradePlanOptions($('#tradePlanSelect').value,''));
$('#tradePlanAssetSelect').addEventListener('change',()=>{});
$('#detailLinkedPlan').addEventListener('click',e=>{
  const b=e.target.closest('[data-open-linked-plan]');if(!b)return;
  closeModals();openWeeklyWorkspace(Number(b.dataset.openLinkedPlan),b.dataset.linkedAsset?Number(b.dataset.linkedAsset):null);
});

function openImageViewer(url,title='Скриншот') {
  const img=$('#imageFull');img.src=url;
  $('#imageCaption').textContent=title;
  viewerNatural=false;
  $('#imageLightbox').classList.remove('natural');
  $('#imageToggleScale').textContent='100%';
  openModal('imageLightbox');
}
function toggleImageScale() {
  viewerNatural=!viewerNatural;
  $('#imageLightbox').classList.toggle('natural',viewerNatural);
  $('#imageToggleScale').textContent=viewerNatural?'Вписать':'100%';
  $('#imageViewerStage').scrollTop=0;
  $('#imageViewerStage').scrollLeft=0;
}
$('#imageToggleScale').addEventListener('click',toggleImageScale);
$('#imageClose').addEventListener('click',closeTopModal);
$('#imageFull').addEventListener('click',toggleImageScale);
document.addEventListener('click',e=>{
  const img=e.target.closest('.view-image');
  if(img)openImageViewer(img.src,img.alt||'Скриншот');
});
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&document.activeElement?.matches('.view-image')){
    openImageViewer(document.activeElement.src,document.activeElement.alt);e.preventDefault();
  }
});
window.addEventListener('scroll',()=>$('.topbar').classList.toggle('scrolled',window.scrollY>12),{passive:true});


$('#addWeeklyPlanBtn').addEventListener('click',()=>{
  $('#newWeeklyPlanForm').reset();$('#weeklyStartInput').value=mondayISO();openModal('newWeeklyPlanModal');
});
$('#newWeeklyPlanForm').addEventListener('submit',e=>{
  e.preventDefault();safe(async()=>{
    const p=Object.fromEntries(new FormData(e.target).entries());
    const created=await window.shelld.addWeeklyPlan(p);
    closeModals();await refresh();await openWeeklyWorkspace(created.id);toast('Недельный план создан');
  });
});
$('#weeklyPlanGrid').addEventListener('click',e=>{
  const b=e.target.closest('[data-open-week]');if(b)openWeeklyWorkspace(Number(b.dataset.openWeek));
});
async function openWeeklyWorkspace(planId,assetId=null){
  return safe(async()=>{
    const p=weeklyPlans.find(w=>Number(w.id)===Number(planId));
    if(!p){toast('План не найден');return;}
    selectedWeekId=Number(planId);selectedWeekAssetId=null;
    $('#weeklyPlanOverview').classList.add('hidden');
    $('#weeklyPlanWorkspace').classList.remove('hidden');
    $('#weeklyPlanDate').textContent=`WEEK · ${p.week_start}`;
    $('#weeklyPlanTitle').textContent=p.title;
    $('#weeklyPlanSummary').textContent='Сначала запиши общий план недели, затем открой нужный актив и оформи его разбор в отдельном окне.';
    await renderWeeklyEditor();
    renderWeeklyTabs();
    switchPage('plans');
    window.scrollTo({top:0,behavior:'smooth'});
    if(assetId!=null)await openWeeklyAssetModal(assetId);
  });
}
async function renderWeeklyEditor(){
  const p=weeklyPlans.find(w=>Number(w.id)===selectedWeekId);
  $('#weeklyEditorLabel').textContent='Общий план на неделю';
  $('#weeklyEditor').value=p?.notes||'';
}
async function saveWeeklyEditor(){
  const p=weeklyPlans.find(w=>Number(w.id)===selectedWeekId);if(!p)return;
  const value=$('#weeklyEditor').value;
  await window.shelld.updateWeeklyPlan(p.id,{week_start:p.week_start,title:p.title,notes:value});
  p.notes=value;
  renderPlans();
}
function weeklyAssetTradeCount(assetId){
  return trades.filter(t=>Number(t.plan_asset_id)===Number(assetId)).length;
}
function renderWeeklyTabs(){
  const assets=weeklyAssetCache.get(selectedWeekId)||[];
  $('#weeklyAssetCounter').textContent=`${assets.length} ${assets.length===1?'актив':assets.length<5?'актива':'активов'}`;
  $('#weeklyAssetTabs').innerHTML=assets.map(a=>{
    const links=weeklyAssetTradeCount(a.id);
    return `<button type="button" class="asset-list-btn" data-open-week-asset="${a.id}">
      <div class="asset-list-head">${pill(a.asset,a.asset)}<span class="card-arrow">↗</span></div>
      <div class="asset-list-meta"><span>${links} сделок привязано</span><span>${(a.notes||'').trim()? 'Есть разбор':'Без разбора'}</span></div>
    </button>`;
  }).join('')||'<div class="empty"><strong>Пока нет активов</strong>Нажми «Добавить актив», затем открой его и добавь скриншоты с разбором.</div>';
}
$('#weeklyAssetTabs').addEventListener('click',e=>{
  const b=e.target.closest('[data-open-week-asset]');if(b)openWeeklyAssetModal(Number(b.dataset.openWeekAsset));
});
$('#saveWeeklyNotesBtn').addEventListener('click',()=>safe(async()=>{await saveWeeklyEditor();toast('Недельный план сохранён');}));
$('#weeklyEditor').addEventListener('blur',()=>{if(selectedWeekId!=null)safe(saveWeeklyEditor);});
$('#addWeeklyAssetBtn').addEventListener('click',()=>{
  if(selectedWeekId==null)return;
  $('#assetPickerForm').reset();
  $('#assetPickerOther').classList.add('hidden');
  $('#assetPickerOther').required=false;
  openModal('assetPickerModal');
});
$('#assetPickerSelect').addEventListener('change',()=>{
  const custom=$('#assetPickerSelect').value==='OTHER';
  $('#assetPickerOther').classList.toggle('hidden',!custom);
  $('#assetPickerOther').required=custom;
  if(custom)$('#assetPickerOther').focus();
});
$('#assetPickerForm').addEventListener('submit',e=>{e.preventDefault();safe(async()=>{
  if(selectedWeekId==null)return;
  const v=$('#assetPickerSelect').value;
  const name=v==='OTHER'?$('#assetPickerOther').value.trim().toUpperCase():v;
  if(!name){toast('Укажи актив');return;}
  await saveWeeklyEditor();
  const asset=await window.shelld.addWeeklyAsset(selectedWeekId,name);
  const updated=await window.shelld.listWeeklyAssets(selectedWeekId);
  weeklyAssetCache.set(selectedWeekId,updated);
  closeModals();renderWeeklyTabs();renderPlans();
  await openWeeklyAssetModal(asset.id);
});});
$('#backToWeeklyPlans').addEventListener('click',()=>safe(async()=>{
  await saveWeeklyEditor();selectedWeekId=null;selectedWeekAssetId=null;
  $('#weeklyPlanOverview').classList.remove('hidden');$('#weeklyPlanWorkspace').classList.add('hidden');renderPlans();
}));
$('#deleteWeeklyPlanBtn').addEventListener('click',()=>safe(async()=>{
  if(selectedWeekId==null||!confirm('Удалить всю неделю, её активы и скриншоты?'))return;
  await window.shelld.deleteWeeklyPlan(selectedWeekId);selectedWeekId=null;selectedWeekAssetId=null;
  $('#weeklyPlanOverview').classList.remove('hidden');$('#weeklyPlanWorkspace').classList.add('hidden');
  await refresh();toast('Недельный план удалён');
}));
async function renderWeeklyAssetModal(preserveDraft=false){
  const assets=weeklyAssetCache.get(selectedWeekId)||[];
  const a=assets.find(x=>Number(x.id)===Number(selectedWeeklyAssetModalId));
  if(!a)return;
  $('#weeklyAssetModalTitle').textContent=a.asset;
  $('#weeklyAssetModalSubtitle').textContent=`${weeklyAssetTradeCount(a.id)} сделок связаны с этим активом`;
  if(!preserveDraft)$('#weeklyAssetModalNotes').value=a.notes||'';
  const imgs=await window.shelld.listPlanImages(selectedWeekId,a.id);
  $('#weeklyAssetModalImages').innerHTML=`<button type="button" class="upload-wide-btn" id="weeklyAssetModalAddImage">＋ Добавить скриншот</button>`+
    (imgs.length ? imgs.map(i=>`<div class="stack-image-card"><img class="view-image" src="${i.dataUrl}" alt="${esc(a.asset)} screenshot"><button class="slot-remove floating" type="button" data-delete-plan-image="${Number(i.id)}">×</button></div>`).join('') : '<div class="empty">Пока нет скриншотов. Добавь 1W, 1D, 4H или любой нужный набор сверху вниз.</div>');
}
async function openWeeklyAssetModal(assetId){
  selectedWeeklyAssetModalId=assetId;
  await renderWeeklyAssetModal();
  openModal('weeklyAssetModal');
}
$('#weeklyAssetModalImages').addEventListener('click',e=>safe(async()=>{
  if(e.target.id==='weeklyAssetModalAddImage'){
    const r=await window.shelld.addPlanImage(selectedWeekId,selectedWeeklyAssetModalId);
    if(!r?.canceled){await renderWeeklyAssetModal(true);toast('Скриншот добавлен');}
    return;
  }
  const remove=e.target.closest('[data-delete-plan-image]');
  if(remove&&confirm('Удалить скриншот?')){await window.shelld.deletePlanImage(Number(remove.dataset.deletePlanImage));await renderWeeklyAssetModal(true);}
}));
$('#saveWeeklyAssetBtn').addEventListener('click',()=>safe(async()=>{
  if(selectedWeeklyAssetModalId==null)return;
  await window.shelld.updateWeeklyAsset(selectedWeeklyAssetModalId,$('#weeklyAssetModalNotes').value);
  const list=await window.shelld.listWeeklyAssets(selectedWeekId);weeklyAssetCache.set(selectedWeekId,list);
  renderWeeklyTabs();renderPlans();toast('Актив сохранён');closeModals();
}));
$('#deleteWeeklyAssetBtn').addEventListener('click',()=>safe(async()=>{
  if(selectedWeeklyAssetModalId==null||!confirm('Удалить этот актив и его скриншоты?'))return;
  await window.shelld.deleteWeeklyAsset(selectedWeeklyAssetModalId);
  const list=await window.shelld.listWeeklyAssets(selectedWeekId);weeklyAssetCache.set(selectedWeekId,list);
  closeModals();renderWeeklyTabs();renderPlans();toast('Актив удалён');
}));
// Asset-specific portrait PNG for sending to Telegram. Original screenshots are untouched.
async function loadDataImage(src){
  return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=src;});
}
function roundedExportRect(ctx,x,y,w,h,r){
  const rad=Math.max(0,Math.min(r,w/2,h/2));
  ctx.beginPath();ctx.moveTo(x+rad,y);ctx.arcTo(x+w,y,x+w,y+h,rad);
  ctx.arcTo(x+w,y+h,x,y+h,rad);ctx.arcTo(x,y+h,x,y,rad);
  ctx.arcTo(x,y,x+w,y,rad);ctx.closePath();
}
function exportTextLines(ctx,text,maxWidth,font){
  ctx.font=font;
  const result=[];
  for(const paragraph of String(text||'').replace(/\r\n/g,'\n').split('\n')){
    if(!paragraph.trim()){result.push('');continue;}
    let line='';
    for(const word of paragraph.trim().split(/\s+/)){
      const candidate=line?line+' '+word:word;
      if(ctx.measureText(candidate).width<=maxWidth){line=candidate;continue;}
      if(line){result.push(line);line='';}
      // Also handle long strings without spaces.
      for(const char of word){
        if(ctx.measureText(line+char).width>maxWidth&&line){result.push(line);line='';}
        line+=char;
      }
    }
    if(line)result.push(line);
  }
  return result.length?result:[''];
}
async function exportWeeklyAsset(){
  const plan=weeklyPlans.find(p=>Number(p.id)===Number(selectedWeekId));
  const asset=(weeklyAssetCache.get(selectedWeekId)||[]).find(a=>Number(a.id)===Number(selectedWeeklyAssetModalId));
  if(!plan||!asset)throw new Error('Сначала открой актив недельного плана');
  const notes=$('#weeklyAssetModalNotes').value;
  await window.shelld.updateWeeklyAsset(asset.id,notes);
  asset.notes=notes;
  renderWeeklyTabs();renderPlans();
  if(document.fonts?.ready)await document.fonts.ready;
  const sourceImages=await window.shelld.listPlanImages(plan.id,asset.id);
  const images=[];
  for(const item of [...sourceImages].reverse()){
    try{images.push(await loadDataImage(item.dataUrl));}catch{}
  }
  // Compact Telegram-ready export. True transparency OUTSIDE the rounded panel;
  // translucent dark cards INSIDE keep TradingView screenshots/text legible.
  const width=1000,margin=22,pad=58,inner=width-2*pad;
  const metric=document.createElement('canvas').getContext('2d');
  const bodyFont='24px Inter';
  const textLines=exportTextLines(metric,notes.trim()||'Разбор пока не добавлен.',inner-50,bodyFont);
  const imageLayouts=images.map(img=>{
    const scale=Math.min((inner-24)/img.naturalWidth,540/img.naturalHeight);
    return {img,w:Math.max(1,Math.round(img.naturalWidth*scale)),h:Math.max(1,Math.round(img.naturalHeight*scale))};
  });
  const headerEnd=224;
  const imageTotal=imageLayouts.reduce((sum,item)=>sum+(item.h+24)+18,0);
  const noteHeight=82+textLines.length*34;
  const noteY=headerEnd+imageTotal+16;
  const height=Math.max(540,noteY+noteHeight+82);
  if(height>16000)throw new Error('Слишком много скриншотов или текста для одного PNG');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,width,height);
  // Gentle, restrained border; no decorative character, no huge text overlays.
  ctx.save();ctx.shadowColor='rgba(255,255,255,.18)';ctx.shadowBlur=18;
  ctx.fillStyle='rgba(8,10,15,.96)';roundedExportRect(ctx,margin,margin,width-2*margin,height-2*margin,22);ctx.fill();ctx.restore();
  ctx.save();roundedExportRect(ctx,margin,margin,width-2*margin,height-2*margin,22);ctx.clip();
  const ambient=ctx.createRadialGradient(width-95,60,10,width-95,60,560);
  ambient.addColorStop(0,'rgba(186,44,63,.13)');ambient.addColorStop(1,'rgba(186,44,63,0)');
  ctx.fillStyle=ambient;ctx.fillRect(0,0,width,550);
  ctx.restore();
  ctx.strokeStyle='rgba(226,232,242,.29)';ctx.lineWidth=2;
  roundedExportRect(ctx,margin,margin,width-2*margin,height-2*margin,22);ctx.stroke();
  ctx.fillStyle='#c74a54';roundedExportRect(ctx,pad,57,4,59,2);ctx.fill();
  ctx.fillStyle='#f2f5fa';ctx.font='700 27px Inter';ctx.fillText('Shelld Statistics',pad+19,82);
  ctx.fillStyle='#8f99aa';ctx.font='600 16px JetBrains Mono';ctx.fillText('WEEKLY TRADING PLAN',pad+19,112);
  // Fit long ticker names into the available header rather than clipping.
  function fittedText(value,x,y,maxWidth,baseSize,minSize){
    let size=baseSize;
    do{ctx.font=`700 ${size}px Inter`;if(ctx.measureText(String(value)).width<=maxWidth||size<=minSize)break;size-=1;}while(true);
    let label=String(value);
    while(ctx.measureText(label).width>maxWidth && label.length>1)label=label.slice(0,-2)+'…';
    ctx.fillText(label,x,y);
  }
  ctx.fillStyle='#ffffff';fittedText(asset.asset,pad,174,inner-24,43,23);
  ctx.fillStyle='#aeb7c5';ctx.font='500 19px JetBrains Mono';
  ctx.fillText(plan.week_start,pad,201);
  ctx.strokeStyle='rgba(218,225,236,.15)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(pad,218);ctx.lineTo(width-pad,218);ctx.stroke();
  let y=headerEnd;
  for(const item of imageLayouts){
    const cardHeight=item.h+24;
    ctx.fillStyle='rgba(21,25,33,.87)';roundedExportRect(ctx,pad,y,inner,cardHeight,12);ctx.fill();
    ctx.strokeStyle='rgba(229,233,240,.16)';ctx.lineWidth=1;roundedExportRect(ctx,pad,y,inner,cardHeight,12);ctx.stroke();
    ctx.save();roundedExportRect(ctx,pad+12,y+12,inner-24,item.h,7);ctx.clip();
    ctx.fillStyle='#0a0c10';ctx.fillRect(pad+12,y+12,inner-24,item.h);
    ctx.drawImage(item.img,pad+(inner-item.w)/2,y+12,item.w,item.h);
    ctx.restore();
    y+=cardHeight+18;
  }
  const boxY=noteY;
  ctx.fillStyle='rgba(21,25,33,.78)';roundedExportRect(ctx,pad,boxY,inner,noteHeight,14);ctx.fill();
  ctx.strokeStyle='rgba(229,233,240,.14)';ctx.lineWidth=1;roundedExportRect(ctx,pad,boxY,inner,noteHeight,14);ctx.stroke();
  ctx.fillStyle='#dce2ec';ctx.font='700 19px Inter';ctx.fillText('ANALYSIS',pad+24,boxY+37);
  ctx.fillStyle='#bfc7d5';ctx.font=bodyFont;
  let textY=boxY+77;
  for(const line of textLines){if(line)ctx.fillText(line,pad+24,textY);textY+=34;}
  ctx.fillStyle='#7f8a9b';ctx.font='500 16px Inter';
  ctx.fillText('Shelld Statistics  •  Private trading journal',pad,height-43);
  const safeAsset=asset.asset.replace(/[^a-zA-Z0-9._-]/g,'_');
  const fileName=`Shelld-${safeAsset}-${plan.week_start}.png`;
  const result=await window.shelld.saveImageExport(canvas.toDataURL('image/png'),fileName);
  if(!result?.canceled)toast('Минималистичный PNG готов для Telegram');
}
$('#exportWeeklyAssetBtn').addEventListener('click',()=>safe(exportWeeklyAsset));

// ----- Beautiful keyboard-friendly backtest date and time editor -----
let btDateTarget=null;
let btDateCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1);
let btDateSelected='';
const pad2=n=>String(n).padStart(2,'0');
const dateParts=iso=>{
  const match=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(iso||''));
  if(!match)return null;
  return {year:Number(match[1]),month:Number(match[2]),day:Number(match[3]),hour:Number(match[4]||0),minute:Number(match[5]||0)};
};
function dateOK(year,month,day){
  if(year<1900||year>2100||month<1||month>12||day<1||day>31)return false;
  const test=new Date(year,month-1,day);
  return test.getFullYear()===year&&test.getMonth()===month-1&&test.getDate()===day;
}
function dateDisplay(iso){
  const d=dateParts(iso);
  return d?`${pad2(d.day)}.${pad2(d.month)}.${d.year}  ${pad2(d.hour)}:${pad2(d.minute)}`:'Выбрать дату и время';
}
function parsedTextDate(text){
  const m=/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(text||'').trim());
  if(!m)return null;
  const d={day:Number(m[1]),month:Number(m[2]),year:Number(m[3])};
  return dateOK(d.year,d.month,d.day)?d:null;
}
function renderBtCalendar(){
  const year=btDateCursor.getFullYear(),month=btDateCursor.getMonth();
  $('#btMonthName').textContent=btDateCursor.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
  const first=(new Date(year,month,1).getDay()+6)%7;
  const days=new Date(year,month+1,0).getDate();
  const today=toLocalInput(new Date()).slice(0,10);
  const selected=btDateSelected;
  let html='';
  for(let i=0;i<first;i++)html+='<span class="bt-date-empty" aria-hidden="true"></span>';
  for(let day=1;day<=days;day++){
    const iso=`${year}-${pad2(month+1)}-${pad2(day)}`;
    html+=`<button type="button" class="bt-date-day ${iso===selected?'selected':''} ${iso===today?'today':''}" data-bt-day="${iso}" aria-label="${day} ${$('#btMonthName').textContent}">${day}</button>`;
  }
  $('#btDateCalendar').innerHTML=html;
}
function setBtCalendarDay(iso){
  const d=dateParts(iso);if(!d)return;
  btDateSelected=iso.slice(0,10);
  $('#btDayInput').value=`${pad2(d.day)}.${pad2(d.month)}.${d.year}`;
  btDateCursor=new Date(d.year,d.month-1,1);
  renderBtCalendar();
}
function openBtDatePicker(tradeId,field,kind='backtest'){
  let currentValue='';
  if(kind==='journal')currentValue=$('#tradeForm').elements[field]?.value||'';
  else{
    const row=btRowsCache.find(r=>Number(r.id)===Number(tradeId));if(!row)return;
    currentValue=row[field]||'';
  }
  btDateTarget={id:tradeId,field,kind};
  const current=dateParts(currentValue)||dateParts(toLocalInput(new Date()));
  const iso=`${current.year}-${pad2(current.month)}-${pad2(current.day)}`;
  $('#btDateCaption').textContent=(kind==='journal'?'JOURNAL':'BACKTEST')+(field==='opened_at'?' · ОТКРЫТИЕ':' · ЗАКРЫТИЕ');
  $('#btHourInput').value=pad2(current.hour);
  $('#btMinuteInput').value=pad2(current.minute);
  setBtCalendarDay(iso);
  openModal('btDateModal');
  // Focus the hour input for fast keyboard entry without opening the native date picker.
  setTimeout(()=>$('#btHourInput').focus(),30);
}
$('#tradeForm').addEventListener('click',e=>{
  const target=e.target.closest('[data-trade-date-field]');
  if(target)openBtDatePicker(null,target.dataset.tradeDateField,'journal');
});
$('#btMonthPrev').addEventListener('click',()=>{btDateCursor.setMonth(btDateCursor.getMonth()-1);renderBtCalendar();});
$('#btMonthNext').addEventListener('click',()=>{btDateCursor.setMonth(btDateCursor.getMonth()+1);renderBtCalendar();});
$('#btDateCalendar').addEventListener('click',e=>{
  const b=e.target.closest('[data-bt-day]');if(b)setBtCalendarDay(b.dataset.btDay);
});
$('#btDayInput').addEventListener('change',()=>{
  const d=parsedTextDate($('#btDayInput').value);if(d)setBtCalendarDay(`${d.year}-${pad2(d.month)}-${pad2(d.day)}`);
});
$$('[data-bt-quick]').forEach(b=>b.addEventListener('click',()=>{
  const [hours,minutes]=b.dataset.btQuick.split(':');
  $('#btHourInput').value=hours;$('#btMinuteInput').value=minutes;
}));
async function saveBtDate(value){
  if(!btDateTarget)return;
  const target=btDateTarget;
  if(target.kind==='journal'){
    $('#tradeForm').elements[target.field].value=value;
    updateTradeDateButtons();
    btDateTarget=null;
    closeTopModal();
    toast('Дата сохранена в форме. Нажми «Сохранить изменения» в сделке.');
  }else{
    await window.shelld.updateBacktestField(target.id,target.field,value);
    btDateTarget=null;
    closeTopModal();await renderBacktestTable();
    toast('Время сделки сохранено');
  }
}
$('#btDateClear').addEventListener('click',()=>safe(async()=>{if(btDateTarget?.kind==='journal'&&btDateTarget.field==='opened_at')throw new Error('Укажи дату открытия сделки');await saveBtDate('');}));
$('#btDateForm').addEventListener('submit',e=>{
  e.preventDefault();safe(async()=>{
    if(!btDateTarget)return;
    const date=parsedTextDate($('#btDayInput').value);
    const hours=Number($('#btHourInput').value),minutes=Number($('#btMinuteInput').value);
    if(!date)throw new Error('Дата должна быть в формате ДД.ММ.ГГГГ');
    if(!/^\d{1,2}$/.test($('#btHourInput').value)||hours>23||hours<0||
       !/^\d{1,2}$/.test($('#btMinuteInput').value)||minutes>59||minutes<0){
      throw new Error('Введи часы от 00 до 23 и минуты от 00 до 59');
    }
    const stamp=`${date.year}-${pad2(date.month)}-${pad2(date.day)}T${pad2(hours)}:${pad2(minutes)}`;
    // Avoid silently saving a position closed before it opened.
    const row=btDateTarget.kind==='backtest'?btRowsCache.find(r=>Number(r.id)===Number(btDateTarget.id)):null;
    const other=btDateTarget.kind==='journal'?
      $('#tradeForm').elements[btDateTarget.field==='opened_at'?'closed_at':'opened_at'].value:
      (btDateTarget.field==='opened_at'?row?.closed_at:row?.opened_at);
    if(other){
      if(btDateTarget.field==='opened_at'&&new Date(stamp)>new Date(other))throw new Error('Открытие позже закрытия. Проверь время.');
      if(btDateTarget.field==='closed_at'&&new Date(stamp)<new Date(other))throw new Error('Закрытие раньше открытия. Проверь время.');
    }
    await saveBtDate(stamp);
  });
});

// Each backtest is isolated from the live Trading Journal.
const btFmt=n=>Number(n||0).toFixed(2);
const btStat=rows=>{
  const stats=window.ShelldStats.compute(rows,'rr',beSettings);
  return {
    ...stats, count:stats.tradeCount, profit:stats.totalGain, avgR:stats.averageR,
    avgWinR:stats.averageWinR, wr:stats.winRate, totalR:stats.totalR
  };
};
const formatR=n=>`${Number(n||0)>=0?'+':''}${btFmt(n)}R`;
function backtestMetricHTML(s){
  return `<div class="bt-summary-cell"><span>ВСЕГО СДЕЛОК</span><strong>${s.count}</strong><small>${s.closedCount} закрыто · ${s.openCount} OPEN</small></div>
    <div class="bt-summary-cell"><span>WIN RATE</span><strong>${s.wr.toFixed(1)}%</strong><small>${s.winCount}W / ${s.lossCount}L</small></div>
    <div class="bt-summary-cell" title="Средний реализованный RR только по WIN"><span>AVERAGE WINNING TRADE</span><strong>${s.winsWithKnownR ? formatR(s.avgWinR) : '—'}</strong><small>${s.winCount} прибыльных сделок</small></div>
    <div class="bt-summary-cell"><span>NET GAIN (%)</span><strong class="${s.profit<0?'red':'green'}">${fmt(s.profit)}</strong><small>Закрытые сделки</small></div>
    ${s.conflicting.length?`<div class="bt-stat-warning">⚠ ${s.conflicting.length} сделок: результат не соответствует знаку R / Gain.</div>`:''}`;
}
async function renderBacktests(){
  const cards=await Promise.all(backtests.map(async p=>{
    const rows=await window.shelld.listBacktestTrades(p.id);
    return {project:p,stats:btStat(rows)};
  }));
  $('#backtestGrid').innerHTML=cards.map(({project:p,stats:s})=>`<button type="button" class="backtest-card" data-open-backtest="${p.id}"><div class="backtest-card-top"><span class="eyebrow">BACKTEST · ${esc(p.style)}</span><span class="card-arrow">↗</span></div><div class="backtest-card-heading">${pill(p.asset,p.asset)} <strong>${p.year}</strong></div><h3>${esc(p.title)}</h3><div class="backtest-preview-stats"><span><small>TRADES</small><b>${s.count}</b></span><span><small>WIN RATE</small><b>${s.wr.toFixed(1)}%</b></span><span><small>AVERAGE WINNING TRADE</small><b>${s.winsWithKnownR?formatR(s.avgWinR):'—'}</b></span><span><small>GAIN</small><b class="${s.profit>=0?'green':'red'}">${fmt(s.profit)}</b></span></div></button>`).join('')||'<div class="empty"><strong>Нет бектестов</strong>Создай первый тест: Swing · EURUSD · 2026.</div>';
}
$('#addBacktestBtn').addEventListener('click',()=>{
  $('#newBacktestForm').reset();
  $('#btNewAssetCustom').classList.add('hidden');$('#btNewAssetCustom').required=false;
  $('#newBacktestYear').value=new Date().getFullYear();
  closeModals();openModal('newBacktestModal');
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const field=$('#newBacktestTitle');field.disabled=false;field.readOnly=false;
    field.focus({preventScroll:true});
  }));
  setTimeout(()=>{if($('#newBacktestModal').classList.contains('open'))$('#newBacktestTitle').focus({preventScroll:true});},120);
});
$('#btNewAssetSelect').addEventListener('change',()=>{
  const custom=$('#btNewAssetSelect').value==='CUSTOM', field=$('#btNewAssetCustom');
  field.classList.toggle('hidden',!custom);field.required=custom;
  if(custom)field.focus();
});
$('#newBacktestForm').addEventListener('submit',e=>{e.preventDefault();safe(async()=>{
  const project=Object.fromEntries(new FormData(e.target).entries());
  if(project.asset==='CUSTOM'){
    const name=$('#btNewAssetCustom').value.trim().toUpperCase();
    if(!/^[A-Z0-9._-]{2,48}$/.test(name))throw new Error('Введи название актива: 2–48 латинских букв, цифр или символов . _ -');
    project.asset=name;
  }
  const created=await window.shelld.addBacktest(project);
  closeModals();await refresh();await openBacktestWorkspace(created.id);toast('Бектест создан');
});});
function setBacktestInlineRename(open){
  const box=$('#backtestInlineRename');
  box.classList.toggle('hidden',!open);
  $('#backtestWorkspaceTitle').classList.toggle('hidden',open);
  $('#editBacktestTitleBtn').classList.toggle('hidden',open);
  if(open){
    const field=$('#backtestInlineTitleInput');
    const project=backtests.find(p=>Number(p.id)===Number(selectedBacktestId));
    field.value=project?.title||'';
    // Direct focus in the actual visible page avoids an Electron overlay issue.
    window.focus();
    field.focus({preventScroll:true});
    field.select();
  }
}
$('#editBacktestTitleBtn').addEventListener('click',()=>setBacktestInlineRename(true));
$('#cancelBacktestInlineName').addEventListener('click',()=>setBacktestInlineRename(false));
async function saveBacktestInlineName(){
  if(selectedBacktestId==null)return;
  const title=$('#backtestInlineTitleInput').value.trim();
  if(title.length<2)throw new Error('Название должно содержать не менее 2 символов');
  const updated=await window.shelld.renameBacktest(selectedBacktestId,title);
  const p=backtests.find(x=>Number(x.id)===Number(selectedBacktestId));
  if(p)p.title=updated.title;
  $('#backtestWorkspaceTitle').textContent=updated.title;
  setBacktestInlineRename(false);
  await renderBacktests();
  toast('Название бектеста сохранено');
}
$('#saveBacktestInlineName').addEventListener('click',()=>safe(saveBacktestInlineName));
$('#backtestInlineTitleInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();safe(saveBacktestInlineName);}
  if(e.key==='Escape'){e.stopImmediatePropagation();setBacktestInlineRename(false);}
});
// Legacy rename popup kept for compatibility, but the visible editor is inline.
$('#backtestRenameForm').addEventListener('submit',e=>{
  e.preventDefault();safe(async()=>{
    const title=$('#backtestRenameInput').value.trim();
    if(title.length<2)throw new Error('Название должно содержать не менее 2 символов');
    const updated=await window.shelld.renameBacktest(selectedBacktestId,title);
    const p=backtests.find(x=>Number(x.id)===Number(selectedBacktestId));if(p)p.title=updated.title;
    $('#backtestWorkspaceTitle').textContent=updated.title;
    closeTopModal();await renderBacktests();toast('Название бектеста сохранено');
  });
});
$('#backtestGrid').addEventListener('click',e=>{
  const card=e.target.closest('[data-open-backtest]');if(card)openBacktestWorkspace(Number(card.dataset.openBacktest));
});
async function openBacktestWorkspace(id){
  return safe(async()=>{
    const p=backtests.find(b=>Number(b.id)===Number(id));if(!p)return;
    selectedBacktestId=p.id;
    setBacktestInlineRename(false);
    $('#backtestOverview').classList.add('hidden');$('#backtestWorkspace').classList.remove('hidden');
    $('#backtestWorkspacePills').innerHTML=`${pill(p.asset,p.asset)} ${pill(p.style,'OPEN')} <span class="pill year-pill">${p.year}</span>`;
    $('#backtestWorkspaceTitle').textContent=p.title;
    switchPage('backtest');await renderBacktestTable();window.scrollTo({top:0,behavior:'smooth'});
  });
}
function holdingTime(opened,closed){
  return window.ShelldDuration.holdingTime(opened,closed);
}

function sideButtons(current){
  return `<div class="bt-side-group"><button type="button" class="bt-side-btn ${current==='LONG'?'active long':''}" data-bt-side="LONG">Long</button><button type="button" class="bt-side-btn ${current==='SHORT'?'active short':''}" data-bt-side="SHORT">Short</button></div>`;
}
async function renderBacktestTable(){
  if(selectedBacktestId==null)return;
  btRowsCache=await window.shelld.listBacktestTrades(selectedBacktestId);
  const stats=btStat(btRowsCache);
  $('#backtestMetrics').innerHTML=backtestMetricHTML(stats);
  const chartRows=btRowsCache.filter(r=>window.ShelldStats.isClosed(r));
  const chart=window.ShelldCurve.draw({svg:$('#backtestEquityChart'),tooltip:$('#backtestEquityChartTooltip'),
    rows:chartRows,mode:'backtest',open:entry=>openBacktestRow(Number(entry.id))});
  $('#backtestCurveTotal').textContent=fmt(chart?.total||0);
  $('#backtestCurveTotal').classList.toggle('red',(chart?.total||0)<0);
  $('#backtestCurveTotal').classList.toggle('green',(chart?.total||0)>=0);
  const options=(values,current)=>values.map(v=>`<option ${v===current?'selected':''}>${esc(v)}</option>`).join('');
  $('#backtestRows').innerHTML=btRowsCache.map((t,i)=>`<tr data-bt-id="${t.id}" class="bt-trade-row bt-row-${resolvedStatus(t).toLowerCase()}">
    <td class="backtest-row-index">${i+1}</td>
    <td><button type="button" class="bt-datetime-btn ${t.opened_at?'is-set':''}" data-bt-date-field="opened_at" aria-label="Изменить дату открытия"><span>${esc(dateDisplay(t.opened_at))}</span><span class="bt-date-icon">▦</span></button></td>
    <td><button type="button" class="bt-datetime-btn ${t.closed_at?'is-set':''}" data-bt-date-field="closed_at" aria-label="Изменить дату закрытия"><span>${esc(dateDisplay(t.closed_at))}</span><span class="bt-date-icon">▦</span></button></td>
    <td class="bt-holding-time" title="Время между открытием и закрытием">${esc(holdingTime(t.opened_at,t.closed_at))}</td>
    <td>${sideButtons(t.direction)}</td>
    <td><input aria-label="Модель" data-bt-field="model" value="${esc(t.model)}" placeholder="FVG / OB"></td>
    <td><select class="bt-result-select bt-result-${resolvedStatus(t)}" aria-label="Result" data-bt-field="result">${options(['WIN','LOSS','BE','OPEN'],resolvedStatus(t))}</select></td>
    <td><input class="bt-decimal-input" aria-label="RR" title="OPEN: целевой RR; WIN/LOSS/BE: реализованный RR" type="text" inputmode="decimal" spellcheck="false" autocomplete="off" data-bt-field="rr" value="${t.rr}"></td>
    <td><input class="bt-decimal-input" aria-label="Риск в процентах" type="text" inputmode="decimal" spellcheck="false" autocomplete="off" data-bt-field="risk_pct" value="${t.risk_pct??1}"></td>
    <td>${t.result==='OPEN'?'<span class="bt-open-gain" title="Открытая сделка — прибыль ещё не реализована">—</span>':`<input class="bt-decimal-input" aria-label="Результат в процентах" title="Изменение Gain пересчитывает RR и статус сделки" type="text" inputmode="decimal" spellcheck="false" autocomplete="off" data-bt-field="gain_pct" value="${t.gain_pct}">`}</td>
    <td><div class="tag-cell">${tagPills(t.tags)}<button class="mini-add-btn" type="button" data-open-bt-row="${t.id}">＋</button></div></td>
    <td><button class="row-details" type="button" data-open-bt-row="${t.id}">▧ Анализ / Фото</button></td>
    <td><button class="delete-btn" type="button" data-delete-bt-row="${t.id}">×</button></td></tr>`).join('')||'<tr><td colspan="13" class="empty">Нажми «Add Trade», чтобы добавить первую строку.</td></tr>';
}
$('#backtestRows').addEventListener('change',e=>safe(async()=>{
  const field=e.target.closest('[data-bt-field]');if(!field)return;
  const row=e.target.closest('[data-bt-id]');if(!row)return;
  await window.shelld.updateBacktestField(Number(row.dataset.btId),field.dataset.btField,field.value);
  await renderBacktestTable();
}));
$('#backtestRows').addEventListener('click',e=>safe(async()=>{
  const details=e.target.closest('[data-open-bt-row]'),remove=e.target.closest('[data-delete-bt-row]'),side=e.target.closest('[data-bt-side]'),date=e.target.closest('[data-bt-date-field]');
  const row=e.target.closest('[data-bt-id]');
  if(date&&row){openBtDatePicker(Number(row.dataset.btId),date.dataset.btDateField);return;}
  if(side&&row){await window.shelld.updateBacktestField(Number(row.dataset.btId),'direction',side.dataset.btSide);await renderBacktestTable();return;}
  if(details){await openBacktestRow(Number(details.dataset.openBtRow));return;}
  if(remove&&confirm('Удалить эту строку и её скриншоты?')){
    await window.shelld.deleteBacktestTrade(Number(remove.dataset.deleteBtRow));await renderBacktestTable();
  }
}));
$('#addBacktestRowBtn').addEventListener('click',()=>safe(async()=>{
  await window.shelld.addBacktestTrade(selectedBacktestId);await renderBacktestTable();toast('Строка добавлена');
}));
$('#backToBacktests').addEventListener('click',()=>safe(async()=>{
  selectedBacktestId=null;$('#backtestOverview').classList.remove('hidden');$('#backtestWorkspace').classList.add('hidden');await renderBacktests();
}));
$('#deleteBacktestBtn').addEventListener('click',()=>safe(async()=>{
  if(selectedBacktestId==null||!confirm('Удалить бектест со всеми строками и скриншотами?'))return;
  await window.shelld.deleteBacktest(selectedBacktestId);selectedBacktestId=null;
  $('#backtestOverview').classList.remove('hidden');$('#backtestWorkspace').classList.add('hidden');await refresh();
}));
function renderBacktestTagEditor(row){
  $('#btTagEditor').innerHTML=`<div class="tag-editor-list">${tagValues(row.tags).map(tag=>`<button type="button" class="tag-chip removable" data-delete-tag="${esc(tag)}">${esc(tag)} ×</button>`).join('')}</div>`;
}
async function openBacktestRow(id){
  return safe(async()=>{
    selectedBacktestRowId=id;
    const row=btRowsCache.find(r=>Number(r.id)===Number(id));if(!row)return;
    $('#btRowTitle').textContent=`Сделка №${btRowsCache.indexOf(row)+1}`;
    $('#btRowNotes').value=row.notes||'';
    renderBacktestTagEditor(row);
    await Promise.all([renderBacktestImages(),renderResultGallery('backtest')]);openModal('backtestRowModal');
  });
}
async function renderBacktestImages(){
  const imgs=await window.shelld.listBacktestImages(selectedBacktestRowId);
  $('#btRowImageGrid').innerHTML=imgs.map(img=>screenshotCard(img,'backtest')).join('')+addCaptureButton();
}
async function persistBacktestNotes(){
  if(selectedBacktestRowId==null)return;
  const id=Number(selectedBacktestRowId),value=$('#btRowNotes').value;
  await window.shelld.updateBacktestField(id,'notes',value);
  const row=btRowsCache.find(r=>Number(r.id)===id);if(row)row.notes=value;
}
let btNotesTimer;
$('#btRowNotes').addEventListener('input',()=>{
  clearTimeout(btNotesTimer);
  btNotesTimer=setTimeout(()=>safe(persistBacktestNotes),400);
});
$('#btRowNotes').addEventListener('blur',()=>{clearTimeout(btNotesTimer);safe(persistBacktestNotes);});
$('#saveBtNotesBtn').addEventListener('click',()=>safe(async()=>{clearTimeout(btNotesTimer);await persistBacktestNotes();toast('Заметки сохранены');}));
$('#btAddTagBtn').addEventListener('click',()=>{
  const row=btRowsCache.find(r=>Number(r.id)===Number(selectedBacktestRowId));if(!row)return;
  $('#tagPickerForm').reset();
  const used=[...new Set(btRowsCache.flatMap(t=>tagValues(t.tags)))].sort();
  const suggestions=$('#tagSuggestions');
  suggestions.innerHTML=used.length?used.map(tag=>`<button type="button" class="tag-chip" data-select-tag="${esc(tag)}">${esc(tag)}</button>`).join(''):'';
  openModal('tagPickerModal');
  $('#tagPickerInput').focus();
});
$('#tagSuggestions').addEventListener('click',e=>{
  const b=e.target.closest('[data-select-tag]');if(!b)return;
  $('#tagPickerInput').value=b.dataset.selectTag;
});
$('#tagPickerForm').addEventListener('submit',e=>{e.preventDefault();safe(async()=>{
  const row=btRowsCache.find(r=>Number(r.id)===Number(selectedBacktestRowId));if(!row)return;
  const tag=$('#tagPickerInput').value.trim().slice(0,60);
  if(!tag){toast('Введи тег');return;}
  const next=[...new Set([...tagValues(row.tags), tag])].join(', ');
  await window.shelld.updateBacktestField(selectedBacktestRowId,'tags',next);
  closeModals();
  await renderBacktestTable();
  const refreshed=btRowsCache.find(r=>Number(r.id)===Number(selectedBacktestRowId));
  if(refreshed)renderBacktestTagEditor(refreshed);
  openModal('backtestRowModal');toast('Тег добавлен');
});});
$('#btTagEditor').addEventListener('click',e=>safe(async()=>{
  const b=e.target.closest('[data-delete-tag]'); if(!b)return;
  const row=btRowsCache.find(r=>Number(r.id)===Number(selectedBacktestRowId)); if(!row)return;
  const next=tagValues(row.tags).filter(tag=>tag!==b.dataset.deleteTag).join(', ');
  await window.shelld.updateBacktestField(selectedBacktestRowId,'tags',next); row.tags=next; renderBacktestTagEditor(row); await renderBacktestTable();
}));
$('#btRowImageGrid').addEventListener('change',e=>safe(async()=>{
  const sel=e.target.closest('[data-move-backtest-image]');if(!sel)return;
  if(sel.value==='CUSTOM'){
    openCapturePicker({kind:'move',place:'backtest',imageId:Number(sel.dataset.moveBacktestImage)});
    return;
  }
  await window.shelld.moveBacktestImage(Number(sel.dataset.moveBacktestImage),sel.value);
  await renderBacktestImages();
}));
$('#btRowImageGrid').addEventListener('click',e=>safe(async()=>{
  if(e.target.closest('[data-open-capture-picker]')){openCapturePicker('backtest');return;}
  const remove=e.target.closest('[data-delete-backtest-image]');
  if(remove&&confirm('Удалить скриншот?')){
    await window.shelld.deleteBacktestImage(Number(remove.dataset.deleteBacktestImage));
    await renderBacktestImages();
  }
}));

// BE classification is a view-level statistic. Original broker cash P&L is not modified.
function populateBeSettings(){
  $('#beEnabled').checked=beSettings.enabled;
  $('#beUnit').value=beSettings.unit;
  $('#beMin').value=String(beSettings.min);
  $('#beMax').value=String(beSettings.max);
}
$('#settingsBtn').addEventListener('click',()=>{populateBeSettings();openModal('beSettingsModal');});
$('#beResetBtn').addEventListener('click',()=>{beSettings=window.ShelldBE.parse({});populateBeSettings();});
$('#beSettingsForm').addEventListener('submit',e=>{e.preventDefault();safe(async()=>{
  const rule=window.ShelldBE.validate({enabled:$('#beEnabled').checked,unit:$('#beUnit').value,min:$('#beMin').value,max:$('#beMax').value});
  beSettings=rule;
  await window.shelld.setSetting('be_range',JSON.stringify(rule));
  closeTopModal();
  await refresh();
  if(selectedBacktestId)await renderBacktestTable();
  toast('Диапазон BE сохранён');
});});

window.refresh=refresh;window.openModal=openModal;window.switchShelldPage=switchPage;
window.openShelldTradeDetails=openDetails;
window.shelldBeSettings=()=>beSettings;
window.resetShelldAfterAccountSwitch=async()=>{
  selectedWeekId=null;selectedWeekAssetId=null;selectedBacktestId=null;selectedBacktestRowId=null;
  initialPeriodSelected=false;closeModals();
  $('#weeklyPlanOverview').classList.remove('hidden');$('#weeklyPlanWorkspace').classList.add('hidden');
  $('#backtestOverview').classList.remove('hidden');$('#backtestWorkspace').classList.add('hidden');
  switchPage('dashboard');await refresh();
};
attachTradeRowHandlers($('#recentRows'));attachTradeRowHandlers($('#tradeRows'));
(async()=>{await safe(async()=>{
  beSettings=window.ShelldBE.parse(await window.shelld.getSetting('be_range'));
  const theme=await window.shelld.getSetting('theme');
  if(theme==='light')document.documentElement.classList.add('light');
  await refresh();
});})();
