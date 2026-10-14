'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const analytics=require('../src/advanced-analytics');
const main=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
const preload=fs.readFileSync(path.join(__dirname,'../src/preload.js'),'utf8');
const row=(id,result,pct,rr,date,opts={})=>({id,result,gain_pct:pct,r_multiple:rr,opened_at:date+'T10:00',closed_at:result==='OPEN'?null:date+'T12:00',asset:'EURUSD',model:'FVG',percent_known:1,r_known:1,...opts});
test('Profit Factor, Max Drawdown, Win Rate and expectancy are calculated from closed rows',()=>{
  const r=analytics.calculate([row(1,'WIN',2,2,'2026-09-01'),row(2,'LOSS',-1,-1,'2026-09-02'),row(3,'LOSS',-1,-1,'2026-09-03'),row(4,'WIN',3,3,'2026-09-04'),row(5,'OPEN',-50,-50,'2026-09-05')]);
  assert.equal(r.closedCount,4);assert.equal(r.openCount,1);assert.equal(r.winRate,50);
  assert.equal(r.totalGain,3);assert.equal(r.grossProfit,5);assert.equal(r.grossLoss,2);
  assert.equal(r.profitFactor,2.5);assert.equal(r.maxDrawdown,2);
  assert.equal(r.expectancyR,0.75);assert.equal(r.avgWinningR,2.5);
  assert.deepEqual(r.curve.map(p=>p.profit),[0,2,1,0,3]);
});
test('Unknown MT5 R and percent remain excluded from R/percent metrics but count for Win Rate',()=>{
  const r=analytics.calculate([row(1,'WIN',0,0,'2026-10-01',{r_known:0,percent_known:0}),row(2,'LOSS',-1,-1,'2026-10-02')]);
  assert.equal(r.winRate,50);assert.equal(r.knownRCount,1);assert.equal(r.expectancyR,-1);
  assert.equal(r.totalGain,-1);assert.equal(r.unpricedCount,1);assert.equal(r.avgWinningR,null);
});
test('BE is neither win nor loss; optional classifier can reclassify near-zero realized trades',()=>{
  const r=analytics.calculate([row(1,'WIN',2,2,'2026-10-01'),row(2,'LOSS',-0.01,-0.01,'2026-10-02'),row(3,'LOSS',-1,-1,'2026-10-03')],{
    effectiveResult:t=>Math.abs(t.gain_pct)<0.05?'BE':t.result
  });
  assert.equal(r.be,1);assert.equal(r.losses,1);assert.equal(r.winRate,50);
});
test('Grouping by month, asset, model and weekday retains only closed, known-profit contributions',()=>{
  const r=analytics.calculate([row(1,'WIN',3,2,'2026-09-01'),row(2,'LOSS',-1,-1,'2026-09-22'),row(3,'WIN',10,3,'2026-10-03',{asset:'GBPUSD'})]);
  assert.equal(r.months.length,2);assert.equal(r.assets.length,2);assert.equal(r.models.length,1);
  assert.equal(r.months.find(g=>g.name==='2026-09').profit,2);
});
test('Backend creates account ownership and scopes Journal, Plans and Backtests',()=>{
  assert.match(main,/CREATE TABLE IF NOT EXISTS accounts/);
  for(const table of ['trades','backtests','plans','weekly_plans'])assert.ok(main.includes("['trades','backtests','plans','weekly_plans']"),table);
  assert.match(main,/WHERE account_id=\?/);
  assert.match(main,/accountId:id,login,password/);
  assert.match(main,/activeAccountId\(\)!==mt5Config\.accountId/);
  assert.match(main,/safeStorage\.encryptString/);
  assert.match(main,/shelld-before-v070-accounts\.sqlite/);
});
test('UI has account selector, profile form, secure password opt-in and analytics page',()=>{
  for(const id of ['accountSelect','accountModal','accountEditForm','mt5Remember','analytics','analyticsMetrics','analyticsModels','analyticsMonths'])assert.ok(html.includes(`id="${id}"`),id);
  for(const name of ['listAccounts','createAccount','selectAccount','activeAccount'])assert.match(preload,new RegExp(name));
  assert.ok(!/value="[^"]+"[^>]*id="mt5Password"/.test(html));
});
