const test=require('node:test');
const assert=require('node:assert/strict');
const charts=require('../src/notion-charts.js');

test('Cumulative excludes OPEN trades and includes BE (realized zero)',()=>{
 const records=[
 {id:1,result:'WIN',gain_pct:2},
 {id:2,result:'LOSS',gain_pct:-1},
 {id:3,result:'OPEN',gain_pct:100},
 {id:4,result:'BE',gain_pct:0},
 {id:5,result:'WIN',gain_pct:1.5}
 ];
 const r=charts.cumulative(records);
 assert.equal(r.closed.length,4);
 assert.deepEqual(r.values,[0,2,1,1,2.5]);
 assert.equal(r.total,2.5);
});
test('Curve uses original points with mild rounding and no NaNs',()=>{
 const pts=[{x:66,y:230},{x:200,y:205},{x:330,y:240},{x:640,y:100}];
 const path=charts.curvePath(pts);
 assert.match(path,/^M 66\.000 230\.000 C /);
 assert.match(path,/640\.000 100\.000$/);
 assert.doesNotMatch(path,/NaN|Infinity/);
});
test('Auto range includes zero and every point, supports all positive or negative',()=>{
 for(const values of [[0,4,10,-3,25],[0,-1,-3,-11],[0,2,7,80],[0]]){
   const {ymin,ymax,step}=charts.rangeFor(values);
   assert.ok(ymin<0 && ymax>0 && step>0);
   assert.ok(Math.min(...values)>=ymin && Math.max(...values)<=ymax);
 }
});
test('150 trades cumulative value preserves full history',()=>{
 const rows=Array.from({length:150},(_,id)=>({id:id+1,result:id%2?'LOSS':'WIN',gain_pct:id%2?-1:2}));
 const r=charts.cumulative(rows);
 assert.equal(r.closed.length,150);
 assert.equal(r.values.length,151);
 assert.equal(r.total,75);
});
