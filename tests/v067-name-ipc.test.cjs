const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../src/main.js'),'utf8');
const begin=source.indexOf("ipcMain.handle('backtests:rename'");
const end=source.indexOf("ipcMain.handle('backtests:delete'",begin);
assert.ok(begin>0&&end>begin);
const chunk=source.slice(begin,end);
function rename(title){
 const handlers={};let updated=null;
 const project={id:7,title:'Original'};
 const sandbox={
   ipcMain:{handle:(key,fn)=>handlers[key]=fn},
   requireBacktest:id=>id===7?project:null,
   exec:(sql,args)=>{updated={sql,args};project.title=args[0];},
   String,Number,Error
 };
 vm.runInNewContext(chunk,sandbox);
 const result=handlers['backtests:rename'](null,7,title);
 return {result,updated};
}
test('Backtest rename persists title and preserves project ID',()=>{
 const {result,updated}=rename('London FVG • EURUSD 2026');
 assert.equal(result.id,7);
 assert.equal(result.title,'London FVG • EURUSD 2026');
 assert.match(updated.sql,/UPDATE backtests SET title/);
 assert.deepEqual([...updated.args],['London FVG • EURUSD 2026',7]);
});
test('Blank or 1 character title is rejected',()=>{
 assert.throws(()=>rename(' '),/от 2 до 150/);
 assert.throws(()=>rename('A'),/от 2 до 150/);
});
