const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const main=fs.readFileSync(path.join(root,'src/main.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'src/renderer.js'),'utf8');
const {percentFromCapital}=require('../src/mt5-profit.js');
const {compute}=require('../src/stats.js');

test('live MT5 percentage uses the explicitly selected account capital',()=>{
  assert.equal(percentFromCapital(-45.05,10000),-0.4505);
  assert.equal(percentFromCapital(-13.15,10000),-0.1315);
  assert.equal(percentFromCapital(42,10000),0.42);
  assert.equal(percentFromCapital(0,10000),0);
  assert.equal(percentFromCapital(11,0),null);
  assert.equal(percentFromCapital(11,undefined),null);
  assert.equal(percentFromCapital(null,10000),null);
  assert.equal(percentFromCapital('not-number',10000),null);
});
test('unrealized profit never contributes to realized equity or win rate',()=>{
  const s=compute([
    {result:'WIN',gain_pct:2,r_multiple:2},
    {result:'LOSS',gain_pct:-1,r_multiple:-1},
    {result:'OPEN',gain_pct:-0.4505,r_multiple:0,percent_known:1}
  ]);
  assert.equal(s.totalGain,1);
  assert.equal(s.winRate,50);
  assert.equal(s.closedCount,2);
  assert.equal(s.openCount,1);
});
test('sync computes floating percentage for OPEN and updates rows without duplicates',()=>{
  assert.match(main,/const calculatedPercent=percentFromCapital\(value, known \? denom : null\)/);
  assert.match(main,/const priced=calculatedPercent!==null/);
  assert.match(main,/const patch=mt5Patch\(existing,serverFields\)/);
  assert.match(main,/UPDATE trades SET \$\{names\.map/);
  assert.match(main,/SELECT \* FROM trades WHERE external_key=\?/);
});
test('display lists descending but curve runs chronologically',()=>{
  assert.match(ui,/return orderedJournalTrades\(\)\.reverse\(\)\.filter/);
  assert.match(ui,/rowsHtml\(orderedJournalTrades\(\)\.slice\(-7\)\.reverse\(\)\)/);
  assert.match(ui,/const ordered=chrono\(closedTrades\(dealList\)\)/);
});
