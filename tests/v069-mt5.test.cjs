const test = require('node:test');
const assert = require('node:assert/strict');
const {compute}=require('../src/stats.js');
const {cumulative,curvePath}=require('../src/notion-charts.js');
test('unpriced MT5 trades count towards Win Rate but not fictitious equity',()=>{
 const a=[
  {result:'WIN',gain_pct:0,r_multiple:0,percent_known:0,r_known:0,source:'mt5'},
  {result:'LOSS',gain_pct:0,r_multiple:0,percent_known:0,r_known:0,source:'mt5'},
  {result:'WIN',gain_pct:3,r_multiple:3,source:'manual'}
 ];
 const s=compute(a,'r_multiple');
 assert.equal(s.winRate,100*2/3);
 assert.equal(s.totalGain,3);
 assert.equal(s.pricedCount,1);
 assert.equal(s.unpricedCount,2);
 assert.equal(s.winsWithKnownR,1);
 assert.equal(s.averageWinR,3);
 assert.deepEqual(cumulative(a).values,[0,3]);
});
test('monotone curve keeps x order and handles close points',()=>{
 const path=curvePath([{x:74,y:190},{x:85,y:180},{x:95,y:200},{x:105,y:185}]);
 assert.match(path,/^M /);
 assert.doesNotMatch(path,/NaN|Infinity/);
});
