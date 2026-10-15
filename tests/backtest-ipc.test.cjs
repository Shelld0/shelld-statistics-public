const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const main=fs.readFileSync(require('node:path').join(__dirname,'../src/main.js'),'utf8');
const begin=main.indexOf("ipcMain.handle('backtest-trades:field'");
const end=main.indexOf("ipcMain.handle('backtest-trades:delete'",begin);
assert.ok(begin>0&&end>begin,'Real IPC handler exists');
const handlerCode=main.slice(begin,end);
function runUpdate(row,key,value){
 const updates=[]; const handlers={};
 const context={
  ipcMain:{handle:(name,handler)=>{handlers[name]=handler}},
  allowedBtColumns:['opened_at','closed_at','direction','model','result','risk_pct','rr','gain_pct','tags','notes'],
  requireBacktestTrade:()=>row,
  db:{run:(sql,values)=>updates.push({sql,values})},
  run:()=>[{}],persist:()=>{},Number,Math,Error,String,Array
 };
 vm.runInNewContext(handlerCode,context);
 handlers['backtest-trades:field'](null,11,key,value);
 return updates;
}
test('changing result uses signed RR and recalculates Gain from risk',()=>{
 const row={id:11, result:'WIN',rr:2,risk_pct:1,gain_pct:2};
 const op=runUpdate(row,'result','LOSS')[0];
 assert.deepEqual([...op.values],['LOSS',-2,-2,1,1,11]);
});
test('changing realized Gain synchronizes status and RR',()=>{
 const row={id:11,result:'WIN',rr:2,risk_pct:2,gain_pct:4};
 const op=runUpdate(row,'gain_pct',-3)[0];
 assert.deepEqual([...op.values],[-3,-1.5,'LOSS',1,11]);
});
test('OPEN may keep planned RR but must never accrue a realized Gain',()=>{
 const row={id:11,result:'OPEN',rr:2,risk_pct:1,gain_pct:0};
 const op=runUpdate(row,'rr',3)[0];
 assert.deepEqual([...op.values],[3,0,1,11]);
 assert.throws(()=>runUpdate(row,'gain_pct',2),/Сначала закрой/);
});
test('editing risk recomputes Gain only on closed trades',()=>{
 const a={id:11,result:'WIN',rr:2,risk_pct:1,gain_pct:2};
 const b={id:11,result:'OPEN',rr:2,risk_pct:1,gain_pct:0};
 assert.deepEqual([...runUpdate(a,'risk_pct',1.5)[0].values],[1.5,3,1,11]);
 assert.deepEqual([...runUpdate(b,'risk_pct',1.5)[0].values],[1.5,0,1,11]);
});
test('BE resets realized RR/Gain',()=>{
 const row={id:11,result:'LOSS',rr:-1,risk_pct:1,gain_pct:-1};
 assert.deepEqual([...runUpdate(row,'result','BE')[0].values],['BE',0,0,1,1,11]);
});
