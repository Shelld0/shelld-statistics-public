const test = require('node:test');
const assert = require('node:assert/strict');
const { compute } = require('../src/stats.js');

test('seven rows: only the two closed trades contribute to realized statistics', () => {
 const rows = [
  {result:'WIN', rr:2, gain_pct:2},
  {result:'LOSS', rr:-1, gain_pct:-1},
  ...Array.from({length:5},()=>({result:'OPEN',rr:2,gain_pct:2}))
 ];
 const x=compute(rows,'rr');
 assert.equal(x.tradeCount,7);
 assert.equal(x.closedCount,2);
 assert.equal(x.openCount,5);
 assert.equal(x.winRate,50);
 assert.equal(x.totalR,1);
 assert.equal(x.averageR,.5);
 assert.equal(x.averageWinR,2);
 assert.equal(x.totalGain,1);
});

test('BE rows count as closed but not for Win Rate denominator',()=>{
 const s=compute([
   {result:'WIN',rr:3,gain_pct:3},
   {result:'LOSS',rr:-1,gain_pct:-1},
   {result:'BE',rr:0,gain_pct:0},
   {result:'OPEN',rr:40,gain_pct:40}
 ],'rr');
 assert.equal(s.winRate,50);
 assert.equal(s.closedCount,3);
 assert.equal(s.totalR,2);
 assert.ok(Math.abs(s.averageR-2/3)<1e-10);
 assert.equal(s.totalGain,2);
 assert.equal(s.beCount,1);
});

test('both views use the same shared statistics and flag inconsistent results',()=>{
 const trades=[
  {result:'WIN',r_multiple:2,gain_pct:2},
  {result:'LOSS',r_multiple:-1,gain_pct:-1},
  {result:'OPEN',r_multiple:5,gain_pct:25}
 ];
 const j=compute(trades,'r_multiple');
 const b=compute(trades.map(({r_multiple,...rest})=>({...rest,rr:r_multiple})),'rr');
 assert.equal(j.winRate,b.winRate);
 assert.equal(j.totalGain,b.totalGain);
 assert.equal(j.averageR,b.averageR);
 const conflict=compute([{result:'WIN',rr:-1,gain_pct:-1}],'rr');
 assert.equal(conflict.conflicting.length,1);
});
