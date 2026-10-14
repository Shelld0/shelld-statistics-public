/* Account-scoped Analytics 2.0 renderer. Runs inside the existing Analytics tab. */
(()=>{
 'use strict';
 const api=window.ShelldAnalyticsV2;
 const by=id=>document.getElementById(id);
 if(!api||!by('analyticsDirectionCompare')||!by('analyticsDrawdowns'))return;
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const signed=(n,d=1)=>!Number.isFinite(n)?'—':`${n>0?'+':''}${n.toFixed(d)}%`;
 const rfmt=n=>n===null||!Number.isFinite(n)?'—':`${n>0?'+':''}${n.toFixed(2)}R`;
 let lastRows=[],options={},lastOutput=null;
 function renderCoverage(s){
   const h=s.histogram,coverage=h.coverage;
   by('analyticsRiskCoverage').textContent=coverage===null?'—':`${coverage.toFixed(1)}%`;
   by('analyticsRiskBar').style.width=`${Math.max(0,Math.min(100,coverage||0))}%`;
   by('analyticsRiskProgress').setAttribute('aria-valuenow',String(Math.round(coverage||0)));
   by('analyticsRiskCounts').textContent=`${h.known} из ${s.closedCount} закрытых сделок с известным R · ${h.unknown} без R`;
   by('analyticsRMedian').textContent=`Медиана известного R: ${rfmt(h.median)}`;
 }
 function renderHeat(h){
   const max=Math.max(.01,...h.cells.filter(c=>c.knownPct).map(c=>Math.abs(c.gain)));
   const grid=`<div class="analysis-v2-heat-grid" style="--heat-columns:${h.columns}">
   <div class="analysis-v2-day-label"></div>
   ${Array.from({length:h.columns},(_,i)=>`<div class="analysis-v2-hour-label">${String(i*h.size).padStart(2,'0')}</div>`).join('')}
   ${h.days.map((day,i)=>`<div class="analysis-v2-day-label">${day}</div>${h.cells.filter(c=>c.weekday===i).map(c=>{
     const alpha=c.knownPct?(.14+Math.min(.59,Math.abs(c.gain)/max*.53)):.045;
     const tone=c.knownPct?(c.gain>0.0000001?'positive':c.gain<-.0000001?'negative':'flat'):'unknown';
     const rgb=tone==='positive'?'38,191,143':tone==='negative'?'235,82,105':'125,137,158';
     const label=`${day} ${c.label}: ${c.count} сделок, результат ${c.knownPct?signed(c.gain):'неизвестен'}, известных процентов ${c.knownPct}`;
     return `<button type="button" class="analysis-v2-heat-cell ${tone}" style="background:rgba(${rgb},${alpha.toFixed(3)})" data-v2-kind="heatmap" data-v2-name="${esc(c.key)}" ${!c.count?'disabled':''} title="${esc(label)}" aria-label="${esc(label)}"><strong>${c.count?c.knownPct?signed(c.gain):'—':'·'}</strong>${c.count?`<small>${c.count}</small>`:''}</button>`;
   }).join('')}`).join('')}</div>`;
   by('analyticsHeatmap').innerHTML=grid;
   by('analyticsHeatNote').textContent=h.unknownTime?
     `${h.unknownTime} закрытых сделок не имеют корректного времени открытия и не включены в карту. Часы — сохранённое время журнала/терминала MT5.`:
     'Часы — записанное время открытия сделки, без автоматического перевода в часовой пояс компьютера. Открытые позиции не учитываются.';
 }
 function renderHistogram(h){
   const max=Math.max(1,...h.bands.map(b=>b.count));
   by('analyticsRHistogram').innerHTML=`<div class="analysis-v2-hist-bars">${h.bands.map(b=>`<button type="button" class="analysis-v2-hist-row" data-v2-kind="rband" data-v2-name="${esc(b.key)}" ${!b.count?'disabled':''} title="Показать ${b.count} сделок в диапазоне ${esc(b.label)}"><span class="analysis-v2-hist-label">${esc(b.label)}</span><span class="analysis-v2-hist-track"><span style="width:${(100*b.count/max).toFixed(1)}%" class="${b.key.startsWith('neg')||b.key==='lt3'?'loss':'gain'}"></span></span><strong>${b.count}</strong></button>`).join('')}</div><div class="analysis-v2-hist-summary">Известный R: <strong>${h.known}</strong> · Нет R: <strong>${h.unknown}</strong> · Медиана: <strong>${rfmt(h.median)}</strong></div>`;
 }
 function renderDirections(groups){
   by('analyticsDirectionCompare').innerHTML=groups.map(g=>`<button type="button" class="analysis-v2-direction" data-v2-kind="direction" data-v2-name="${esc(g.direction)}" ${!g.count?'disabled':''}>
    <div><span class="analysis-v2-dir-pill ${g.direction==='SHORT'?'short':'long'}">${esc(g.direction)}</span><strong class="${g.gain<0?'loss':'gain'}">${g.knownPct?signed(g.gain):'—'}</strong></div>
    <div class="analysis-v2-dir-stats"><span>${g.count} сделок</span><span>Win Rate: ${g.winRate===null?'—':g.winRate.toFixed(1)+'%'}</span><span>Ср. R: ${rfmt(g.avgR)}</span></div>
    <small>Прибыль известна: ${g.knownPct}/${g.count} · R: ${g.knownR}/${g.count} · Нажми для просмотра ↗</small>
   </button>`).join('');
 }
 function renderDrawdowns(d){
   const intro=`<div class="analysis-v2-dd-overview"><div><span>Макс. просадка</span><strong>${d.pricedCount?'−'+d.maxDrawdown.toFixed(2)+'%':'—'}</strong></div><div><span>Текущая от пика</span><strong>${d.pricedCount?'−'+d.currentDrawdown.toFixed(2)+'%':'—'}</strong></div><div><span>Длиннейшая серия</span><strong>${d.longest?d.longest.tradeCount+' сделок':'—'}</strong></div></div>`;
   const max=Math.max(1,...d.episodes.map(x=>x.depth));
   const lines=[...d.episodes].sort((a,b)=>b.depth-a.depth).slice(0,5);
   by('analyticsDrawdowns').innerHTML=intro+(lines.length?`<div class="analysis-v2-dd-list">${lines.map((ep,i)=>`<button type="button" class="analysis-v2-dd-row" data-v2-kind="drawdown" data-v2-index="${d.episodes.indexOf(ep)}"><span class="analysis-v2-dd-title"><b>#${i+1} · −${ep.depth.toFixed(2)}%</b><small>${ep.tradeCount} сделок · ${ep.recovered?'Восстановлена':'Не восстановлена'}</small></span><span class="analysis-v2-hist-track"><span class="loss" style="width:${(100*ep.depth/max).toFixed(1)}%"></span></span></button>`).join('')}</div>`:'<p class="analysis-v2-empty">Нет просадок по сделкам с известным результатом в процентах.</p>')+`<p class="analysis-v2-hint">Сумма % считается аддитивно. Без %: ${d.unknown} закрытых сделок, они не участвуют в анализе просадок.</p>`;
 }
 function renderModels(groups){
   if(!groups.length){by('analyticsModelCompare').innerHTML='<p class="analysis-v2-empty">Нет закрытых сделок с моделями.</p>';return;}
   by('analyticsModelCompare').innerHTML=`<table class="analysis-v2-model-table"><thead><tr><th>Модель</th><th>Сделки</th><th>WR</th><th>Доход</th><th>Ср. R</th><th>R известно</th></tr></thead><tbody>${groups.map(g=>`<tr><td><button type="button" data-v2-kind="models" data-v2-name="${esc(g.name)}" class="analysis-v2-model-link" title="Посмотреть сделки">${esc(g.name)} ↗</button></td><td>${g.count}</td><td>${g.winRate===null?'—':g.winRate.toFixed(1)+'%'}</td><td class="${g.gain<0?'loss':'gain'}">${g.knownPct?signed(g.gain):'—'}</td><td>${rfmt(g.avgR)}</td><td>${g.knownR}/${g.count}</td></tr>`).join('')}</tbody></table>`;
 }
 function render(rows,opts={}){
   lastRows=Array.isArray(rows)?rows:[];options=opts;
   lastOutput=api.calculate(lastRows,{effectiveResult:opts.effectiveResult});
   renderDirections(lastOutput.directions);
   renderDrawdowns(lastOutput.drawdowns);
 }
 by('analytics')?.addEventListener('click',event=>{
   const btn=event.target.closest('[data-v2-kind]');
   if(!btn||btn.disabled)return;
   const kind=btn.dataset.v2Kind;
   const name=btn.dataset.v2Name||'';
   let selection={kind,name};
   if(kind==='drawdown'){
     const episode=lastOutput?.drawdowns.episodes[Number(btn.dataset.v2Index)];
     if(!episode)return;
     selection={kind,name:'Просадка',ids:episode.tradeIds.map(Number)};
   }
   window.showAnalyticsDrill?.(selection);
 });
 window.renderAnalyticsV2=render;
})();
