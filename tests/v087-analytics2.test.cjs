'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const v2=require('../src/analytics-v2.js');
const old=require('../src/advanced-analytics.js');
const trade=(id,result,pct,r,opened,closed,extra={})=>({id,result,gain_pct:pct,r_multiple:r,percent_known:1,r_known:1,opened_at:opened,closed_at:closed,asset:'EURUSD',direction:'LONG',model:'FVG',...extra});
const dt=(date,hour=10)=>`${date}T${String(hour).padStart(2,'0')}:00`;

test('Weekday and hour from saved opening timestamp are retained without timezone conversion',()=>{
 const time=v2.wallClock('2026-10-12T22:15:00'); // Monday
 assert.deepEqual(time,{weekday:0,hour:22,date:'2026-10-12'});
 assert.equal(v2.wallClock('2026-02-31T14:00'),null);
 assert.equal(v2.wallClock('garbage'),null);
});
test('Heatmap groups closed results by opening time, not close time, and excludes OPEN',()=>{
 const r=[trade(1,'WIN',2,2,dt('2026-10-12',9),dt('2026-10-13',17)),trade(2,'LOSS',-1,-1,dt('2026-10-12',8),dt('2026-10-14',14)),trade(3,'OPEN',-300,9,dt('2026-10-12',9),null),trade(4,'BE',-.1,0,dt('2026-10-13',9),dt('2026-10-14',9))];
 const map=v2.heatmap(r);
 const mon=map.cells.find(x=>x.key==='0:8');
 assert.equal(mon.count,2);assert.equal(mon.gain,1);assert.equal(mon.knownPct,2);
 assert.equal(mon.wins,1);assert.equal(mon.losses,1);
 assert.equal(map.cells.find(x=>x.key==='1:8').be,1);
 assert.equal(map.cells.length,84);
});
test('Heatmap can switch 1, 2 and 4 hour grouping',()=>{
 const rows=[trade(1,'WIN',1,1,dt('2026-10-12',9),dt('2026-10-13'))];
 assert.equal(v2.heatmap(rows,1).cells.length,168);
 assert.equal(v2.heatmap(rows,4).cells.find(x=>x.key==='0:8').gain,1);
 assert.throws(()=>v2.heatmap(rows,3),/Размер интервала/);
});
test('Heatmap keeps unknown % as unknown rather than invented zero',()=>{
 const row=trade(1,'WIN',0,0,dt('2026-10-12',9),dt('2026-10-12',10),{percent_known:0,r_known:0});
 const c=v2.heatmap([row]).cells.find(x=>x.key==='0:8');
 assert.equal(c.count,1);assert.equal(c.knownPct,0);assert.equal(c.knownR,0);
});
test('Heatmap tracks missing/invalid opening date separately',()=>{
 const row=trade(1,'WIN',1,1,'',dt('2026-10-12',11));
 const map=v2.heatmap([row]);assert.equal(map.unknownTime,1);assert.equal(map.totalIncluded,0);
});
test('Histogram counts only explicitly known finite R, coverage across all closed trades',()=>{
 const rows=[trade(1,'WIN',1,2,dt('2026-10-12'),dt('2026-10-12')),trade(2,'LOSS',-1,-1,dt('2026-10-13'),dt('2026-10-13')),trade(3,'LOSS',-1,-1,dt('2026-10-14'),dt('2026-10-14'),{r_known:0}),trade(4,'OPEN',0,100,dt('2026-10-14'),null)];
 const h=v2.histogram(rows);
 assert.equal(h.known,2);assert.equal(h.unknown,1);assert.ok(Math.abs(h.coverage-200/3)<1e-9);
 assert.equal(h.median,.5);
 assert.equal(h.bands.find(x=>x.key==='pos3').count,1);
 assert.equal(h.bands.find(x=>x.key==='neg2').count,1);
 assert.equal(h.bands.reduce((sum,x)=>sum+x.count,0),2);
});
test('Histogram counts 0R separately and does not treat known zero as missing',()=>{
 const rows=[trade(1,'BE',-.1,0,dt('2026-10-12'),dt('2026-10-12'))];
 const h=v2.histogram(rows);
 assert.equal(h.known,1);assert.equal(h.bands.find(x=>x.key==='zero').count,1);
});
test('Histogram does not count undefined/null R even if known flag is one',()=>{
 const rows=[trade(1,'WIN',1,null,dt('2026-10-12'),dt('2026-10-12'))];
 const h=v2.histogram(rows);assert.equal(h.known,0);assert.equal(h.coverage,0);
});
test('Direction comparison: BE neutral for WR, % contributions can be negative on BE',()=>{
 const rows=[trade(1,'WIN',3,3,dt('2026-10-12'),dt('2026-10-12')),
 trade(2,'LOSS',-2,-2,dt('2026-10-13'),dt('2026-10-13'),{direction:'SHORT'}),
 trade(3,'BE',-.2,0,dt('2026-10-14'),dt('2026-10-14'),{direction:'LONG'}),
 trade(4,'OPEN',200,10,dt('2026-10-14'),null,{direction:'SHORT'})];
 const [l,s]=v2.groupDirection(rows);assert.equal(l.count,2);assert.equal(l.gain,2.8);assert.equal(l.winRate,100);assert.equal(s.count,1);assert.equal(s.gain,-2);assert.equal(s.winRate,0);
});
test('Model comparison groups no model and reports R coverage per model',()=>{
 const rows=[trade(1,'WIN',2,2,dt('2026-10-12'),dt('2026-10-12')),
 trade(2,'LOSS',-1,-1,dt('2026-10-13'),dt('2026-10-13'),{r_known:0}),
 trade(3,'LOSS',-1,-1,dt('2026-10-14'),dt('2026-10-14'),{model:''})];
 const groups=v2.groupModels(rows);const fvg=groups.find(g=>g.name==='FVG');
 assert.equal(fvg.count,2);assert.equal(fvg.knownR,1);assert.equal(fvg.knownPct,2);assert.equal(fvg.winRate,50);
 assert.equal(groups.find(g=>g.name==='Без модели').count,1);
});
test('Drawdown episodes preserve chronological sequence, recovery and no double-count of open',()=>{
 const rows=[trade(1,'WIN',3,3,dt('2026-10-01'),dt('2026-10-01')),
 trade(2,'LOSS',-2,-2,dt('2026-10-02'),dt('2026-10-02')),
 trade(3,'LOSS',-1,-1,dt('2026-10-03'),dt('2026-10-03')),
 trade(4,'WIN',4,4,dt('2026-10-04'),dt('2026-10-04')),
 trade(5,'LOSS',-2,-2,dt('2026-10-05'),dt('2026-10-05')),
 trade(6,'OPEN',-900,-900,dt('2026-10-06'),null)];
 const d=v2.drawdowns(rows);
 assert.equal(d.pricedCount,5);assert.equal(d.maxDrawdown,3);assert.equal(d.episodes.length,2);
 assert.equal(d.episodes[0].recovered,true);assert.deepEqual(d.episodes[0].tradeIds,[2,3,4]);
 assert.equal(d.episodes[1].recovered,false);assert.deepEqual(d.episodes[1].tradeIds,[5]);
 assert.equal(d.currentDrawdown,2);assert.equal(d.longest.tradeCount,3);
});
test('Drawdown excludes unknown profit, preserves known BE monetary effect',()=>{
 const rows=[trade(1,'WIN',2,2,dt('2026-10-01'),dt('2026-10-01')),
 trade(2,'LOSS',-200,-1,dt('2026-10-02'),dt('2026-10-02'),{percent_known:0}),
 trade(3,'BE',-.2,0,dt('2026-10-03'),dt('2026-10-03'))];
 const d=v2.drawdowns(rows);assert.ok(Math.abs(d.maxDrawdown-.2)<1e-9);assert.equal(d.unknown,1);
});
test('Zero closed trades: show dash coverage and empty heatmap without NaN',()=>{
 const s=v2.calculate([trade(1,'OPEN',-100,3,dt('2026-10-12'),null)]);
 assert.equal(s.closedCount,0);assert.equal(s.histogram.coverage,null);assert.equal(s.drawdowns.maxDrawdown,0);
 assert.ok(s.heatmap.cells.every(c=>c.count===0));
});
test('Effective BE respects caller classification, and old analytics remains aligned on closed count',()=>{
 const rows=[trade(1,'WIN',1,1,dt('2026-10-12'),dt('2026-10-12')),trade(2,'LOSS',-.05,-.05,dt('2026-10-13'),dt('2026-10-13'))];
 const opts={effectiveResult:t=>t.id===2?'BE':t.result};
 const s=v2.calculate(rows,opts),oldResult=old.calculate(rows,opts);
 assert.equal(s.closedCount,oldResult.closedCount);
 assert.equal(s.directions.find(d=>d.direction==='LONG').be,1);
 assert.equal(s.directions.find(d=>d.direction==='LONG').winRate,100);
});
test('Analytics UI keeps directions/drawdown and existing model analysis, hides optional 2.0 blocks',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'../src/analytics-v2-ui.js'),'utf8');
 for(const id of ['analyticsDirectionCompare','analyticsDrawdowns','analyticsModels','analyticsAssets','analyticsMonths','analyticsWeekdays'])assert.ok(html.includes(`id="${id}"`),id);
 for(const id of ['analyticsHeatmap','analyticsRHistogram','analyticsRiskCoverage','analyticsModelCompare'])assert.ok(!html.includes(`id="${id}"`),id);
 assert.match(ui,/window.showAnalyticsDrill/);
 assert.match(ui,/!by\('analyticsDirectionCompare'\)/);
 assert.match(fs.readFileSync(path.join(__dirname,'../src/advanced-ui.js'),'utf8'),/window.renderAnalyticsV2/);
});
