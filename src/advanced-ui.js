/* Advanced Analytics: account-scoped, interactive breakdowns, closed-trade P&L only. */
(()=>{
 'use strict';
 const q=id=>document.getElementById(id);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>n===null||n===undefined?'—':`${n>=0?'+':''}${Number(n).toFixed(2)}%`;
 const number=n=>n===null||n===undefined?'—':Number.isFinite(n)?Number(n).toFixed(2):'∞';
 const noun=(count,a,b,c)=>{const n=Math.abs(Number(count))%100,last=n%10;return last===1&&n!==11?a:last>=2&&last<=4&&(n<12||n>14)?b:c;};
 let currentRows=[], currentDrill=null;
 let extraPredicate=null;
 const range=q('analyticsRange');
 const dayKey=t=>String(t.closed_at||t.opened_at||'').slice(0,10);
 function scoped(){
   const days=Number(range?.value||0);
   if(!days)return currentRows;
   const cutoff=Date.now()-days*864e5;
   return currentRows.filter(t=>new Date(t.closed_at||t.opened_at).getTime()>=cutoff);
 }
 const rules=()=>window.shelldBeSettings?.()||{};
 const effective=t=>window.ShelldBE.effectiveResult(t,rules());
 function groupFor(t,kind){
   if(kind==='direction')return String(t.direction||'').toUpperCase()||'НЕ УКАЗАНО';
   if(kind==='rband')return window.ShelldAnalyticsV2?.rBand(t)||'';
   if(kind==='heatmap')return window.ShelldAnalyticsV2?.heatmapKey(t,Number(q('analyticsHeatInterval')?.value||2))||'';
   if(kind==='models')return String(t.model||'').trim()||'Без модели';
   if(kind==='assets')return String(t.asset||'').toUpperCase();
   if(kind==='months')return dayKey(t).slice(0,7);
   if(kind==='weekday'){
     const date=new Date(dayKey(t)+'T12:00:00');
     return Number.isNaN(+date)?'':['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][date.getDay()];
   }
   return '';
 }
 function buildRows(items,kind,sort='profit'){
   const sorted=[...items].sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='original'?0:b.profit-a.profit);
   const max=Math.max(1,...sorted.map(g=>Math.abs(g.profit)));
   if(!sorted.length)return '<div class="analysis-empty">Нет закрытых сделок по выбранному периоду</div>';
   return sorted.map(g=>`<button type="button" class="analysis-breakdown-row ${currentDrill?.kind===kind&&currentDrill.name===g.name?'chosen':''}" data-analysis-kind="${kind}" data-analysis-name="${escape(g.name)}" aria-label="Открыть сделки: ${escape(g.name)}">
    <span class="analysis-breakdown-top"><strong>${escape(g.name)}</strong><span>${g.trades} ${noun(g.trades,'сделка','сделки','сделок')} · ${g.winRate.toFixed(1)}% WR · <b class="${g.profit<0?'loss':'win'}">${g.knownProfit?fmt(g.profit):'—'}</b></span></span>
    <span class="analysis-track"><span class="analysis-bar ${g.profit<0?'negative':'positive'}" style="width:${g.knownProfit?Math.max(2,100*Math.abs(g.profit)/max):0}%"></span></span>
    <span class="analysis-open-hint">Просмотреть сделки ↗</span>
   </button>`).join('');
 }
 function renderDrill(){
   const el=q('analyticsDetail');if(!el)return;
   if(!currentDrill){el.classList.add('hidden');el.innerHTML='';return;}
   const rows=scoped().filter(t=>['WIN','LOSS','BE'].includes(effective(t)) && (currentDrill.kind==='drawdown'?currentDrill.ids?.includes(Number(t.id)):groupFor(t,currentDrill.kind)===currentDrill.name));
   if(!rows.length){currentDrill=null;el.classList.add('hidden');return;}
   const summary=window.ShelldAnalytics.calculate(rows,{rules:rules(),effectiveResult:window.ShelldBE.effectiveResult});
   el.innerHTML=`<div class="analysis-detail-head"><div><span class="eyebrow">АНАЛИЗ СДЕЛОК</span><h3>${escape(currentDrill.name)}</h3><p>${rows.length} ${noun(rows.length,'закрытая сделка','закрытые сделки','закрытых сделок')} · Win Rate ${summary.winRate.toFixed(1)}% · ${summary.pricedCount?fmt(summary.totalGain):'Нет данных в %'}</p></div><button type="button" class="secondary" id="analyticsCloseDetail">Закрыть</button></div>
   <div class="analysis-detail-list">${rows.slice().sort((a,b)=>String(b.closed_at||b.opened_at).localeCompare(String(a.closed_at||a.opened_at))).map(t=>`<button type="button" class="analysis-trade-line" data-analytics-trade="${Number(t.id)}"><span class="pill">${escape(t.asset||'—')}</span><span>${escape(new Date(dayKey(t)+'T12:00:00').toLocaleDateString('ru-RU'))}</span><span>${escape(effective(t))}</span><strong class="${Number(t.gain_pct)<0?'loss':'win'}">${t.percent_known===0||t.percent_known==='0'?'—':fmt(Number(t.gain_pct))}</strong><span>↗</span></button>`).join('')}</div>`;
   el.classList.remove('hidden');
 }
 function draw(){
   if(!q('analytics')?.classList.contains('active'))return;
   const summary=window.ShelldAnalytics.calculate(scoped(),{rules:rules(),effectiveResult:window.ShelldBE.effectiveResult});
   const cell=(title,value,meta='')=>`<article class="analysis-stat"><span>${title}</span><strong>${value}</strong><small>${meta}</small></article>`;
   q('analyticsMetrics').innerHTML=[
    cell('NET GAIN',summary.pricedCount?fmt(summary.totalGain):'—',`${summary.pricedCount} ${noun(summary.pricedCount,'сделка','сделки','сделок')} с известным %`),
    cell('WIN RATE',summary.winRate.toFixed(1)+'%',`${summary.wins}W · ${summary.losses}L · ${summary.be} BE`),
    cell('PROFIT FACTOR',number(summary.profitFactor),`Gross profit ${fmt(summary.grossProfit)} · gross loss ${summary.grossLoss.toFixed(2)}%`),
    cell('MAX DRAWDOWN',(summary.maxDrawdown?'−':'')+summary.maxDrawdown.toFixed(2)+'%','От пика накопленной доходности'),
    cell('EXPECTANCY (R)',summary.expectancyR===null?'—':summary.expectancyR.toFixed(2)+'R',`${summary.knownRCount} ${noun(summary.knownRCount,'сделка','сделки','сделок')} с известным R`),
    cell('AVERAGE WINNING TRADE',summary.avgWinningR===null?'—':summary.avgWinningR.toFixed(2)+'R','Только WIN с известным R'),
    cell('AVERAGE LOSS (R)',summary.avgLossR===null?'—':summary.avgLossR.toFixed(2)+'R','Только LOSS с известным R'),
    cell('TOTAL TRADES',String(summary.allCount),`${summary.closedCount} закрыто · ${summary.openCount} OPEN`)
   ].join('');
   q('analyticsNotice').textContent=summary.unpricedCount||summary.knownRCount<summary.closedCount?
     `${summary.unpricedCount} закрытых без подтверждённого %, ${summary.closedCount-summary.knownRCount} без известного R: они исключены из соответствующих метрик.`:
     'Нажми на актив, модель, месяц или день недели, чтобы увидеть конкретные сделки. OPEN не влияет на реализованную прибыль.';
   q('analyticsModels').innerHTML=buildRows(summary.models,'models');
   q('analyticsAssets').innerHTML=buildRows(summary.assets,'assets');
   q('analyticsMonths').innerHTML=buildRows(summary.months,'months','name');
   const order=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
   q('analyticsWeekdays').innerHTML=buildRows(summary.weekday.sort((a,b)=>order.indexOf(a.name)-order.indexOf(b.name)),'weekday','original');
   renderDrill();
   window.renderAnalyticsV2?.(scoped(),{effectiveResult:effective});
 }
 q('analytics')?.addEventListener('click',e=>{
   const drill=e.target.closest('[data-analysis-kind]');
   if(drill){currentDrill={kind:drill.dataset.analysisKind,name:drill.dataset.analysisName};draw();q('analyticsDetail')?.scrollIntoView({behavior:'smooth',block:'nearest'});return;}
   const close=e.target.closest('#analyticsCloseDetail');if(close){currentDrill=null;draw();return;}
   const trade=e.target.closest('[data-analytics-trade]');if(trade)window.openShelldTradeDetails?.(Number(trade.dataset.analyticsTrade));
 });
 range?.addEventListener('change',()=>{currentDrill=null;draw();});
 window.renderAdvancedAnalytics=rows=>{currentRows=Array.isArray(rows)?rows:[];draw();};
 window.updateAnalyticsTab=draw;
 window.showAnalyticsDrill=(selection)=>{if(!selection)return;currentDrill=selection;draw();q('analyticsDetail')?.scrollIntoView({behavior:'smooth',block:'nearest'});};
})();
