const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const base=path.join(__dirname,'..','src');
const load=f=>fs.readFileSync(path.join(base,f),'utf8');
const main=load('main.js');
const begin=main.indexOf("ipcMain.handle('backtest-trades:field'");
const end=main.indexOf("ipcMain.handle('backtest-trades:delete'",begin);
assert.ok(begin>=0&&end>begin);
function change(column,value,row={id:7,result:'WIN',rr:2,risk_pct:1,gain_pct:2}){
  const handlers={},updates=[];
  const context={
    ipcMain:{handle:(key,fn)=>handlers[key]=fn},
    allowedBtColumns:['opened_at','closed_at','direction','model','result','risk_pct','rr','gain_pct','tags','notes'],
    requireBacktestTrade:()=>row,
    db:{run:(sql,args)=>updates.push({sql,args})},
    run:()=>[{}],persist:()=>{},Number,Math,Error,String
  };
  vm.runInNewContext(main.slice(begin,end),context);
  handlers['backtest-trades:field'](null,7,column,value);
  return updates[0];
}
test('Backtest decimal fields accept comma, dot and signed values',()=>{
  const risk=change('risk_pct','1,5');
  assert.deepEqual([...risk.args],[1.5,3,7]);
  const loss=change('gain_pct','-0,7');
  assert.deepEqual([...loss.args],[-0.7,-0.7,'LOSS',7]);
  const minus=change('gain_pct','−0,5');
  assert.deepEqual([...minus.args],[-0.5,-0.5,'LOSS',7]);
  assert.throws(()=>change('risk_pct',''),/Введите число/);
  assert.throws(()=>change('risk_pct','-10'),/Риск должен быть/);
  assert.throws(()=>change('rr','abc'),/Введите число/);
});
test('Backtest table has thirteen columns, decimal text boxes and no note column',()=>{
  const html=load('index.html'),js=load('renderer.js');
  const table=html.match(/<table class="backtest-table">([\s\S]*?)<\/table>/)?.[1];
  assert.ok(table);
  assert.equal((table.match(/<th>/g)||[]).length,13);
  assert.doesNotMatch(table,/<th>Заметки<\/th>/);
  assert.match(js,/class="bt-decimal-input"[^>]*type="text" inputmode="decimal"/);
  assert.doesNotMatch(js,/class="bt-inline-notes"/);
  assert.match(html,/id="btRowNotes"/);
});
test('Timeframe picker lists from monthly to minute in a natural order',()=>{
  const html=load('index.html'), js=load('renderer.js');
  const items=[...html.matchAll(/<option value="(1MN|1W|1D|12H|8H|6H|4H|2H|1H|30M|15M|5M|1M)"/g)].map(m=>m[1]);
  assert.deepEqual(items.slice(-13),['1MN','1W','1D','12H','8H','6H','4H','2H','1H','30M','15M','5M','1M']);
  assert.match(js,/const standardTimeframes=\['1MN','1W','1D'/);
});
test('Inline title editing replaces fragile modal and retains persisted rename',()=>{
  const html=load('index.html'),js=load('renderer.js');
  assert.match(html,/id="backtestInlineTitleInput"/);
  assert.match(js,/function setBacktestInlineRename\(open\)/);
  assert.match(js,/saveBacktestInlineName/);
  assert.match(js,/renameBacktest\(selectedBacktestId,title\)/);
});
