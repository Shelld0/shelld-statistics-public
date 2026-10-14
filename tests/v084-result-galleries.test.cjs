'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=path.join(__dirname,'../src');
const main=fs.readFileSync(path.join(source,'main.js'),'utf8');
const renderer=fs.readFileSync(path.join(source,'renderer.js'),'utf8');
const html=fs.readFileSync(path.join(source,'index.html'),'utf8');
const preload=fs.readFileSync(path.join(source,'preload.js'),'utf8');
const deletion=require('../src/account-removal').deletionSteps;
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScjCRQAAAABJRU5ErkJggg==','base64');
const png='data:image/png;base64,'+bytes.toString('base64');
const st=main.indexOf("ipcMain.handle('result-images:clipboard'");
const end=main.indexOf('const validTimeframe =',st);
assert.ok(st>0&&end>st,'Result Gallery IPC handlers are present');
function envSetup(){
 let account=1, nextId=1;
 const rows={trade:[],backtest:[]};
 const handlers={};
 const requireCurrentTrade=id=>{if(account!==1||Number(id)!==6)throw new Error('Чужая сделка');};
 const requireBacktestTrade=id=>{if(account!==1||Number(id)!==9)throw new Error('Чужая запись бектеста');};
 const validateImageDataURL=url=>{if(url!==png)throw new Error('Некорректное изображение');return {mime:'image/png',bytes:new Uint8Array(bytes)}};
 const store={
   ipcMain:{handle:(name,handler)=>handlers[name]=handler},
   clipboard:{readImage:()=>({isEmpty:()=>true})},
   validateImageDataURL, requireCurrentTrade,requireBacktestTrade,
   imageData:row=>({id:row.id,dataUrl:png,mime:row.mime}),
   run:(sql,args)=>{
     const kind=sql.includes('backtest_result_images')?'backtest':'trade';
     const imageList=rows[kind];
     if(sql.includes('WHERE id=?'))return imageList.filter(row=>row.id===Number(args[0])).map(row=>({id:row.id,trade_id:row.owner,backtest_trade_id:row.owner}));
     return imageList.filter(row=>row.owner===Number(args[0]));
   },
   exec:(sql,args)=>{
     const kind=sql.includes('backtest_result_images')?'backtest':'trade';
     if(sql.startsWith('INSERT'))rows[kind].push({id:nextId++,owner:Number(args[0]),mime:args[1],image:args[2]});
     if(sql.startsWith('DELETE'))rows[kind]=rows[kind].filter(row=>row.id!==Number(args[0]));
   },
   Buffer,Number,String,Error
 };
 vm.runInNewContext(main.slice(st,end),store,{filename:'main.js/result-images'});
 return {handlers,rows,switchAccount:n=>account=n};
}
test('journal and backtest Result albums accept multiple images without replacing existing ones',()=>{
 const env=envSetup();
 const add=env.handlers['result-images:add'];
 add(null,'trade',6,png);add(null,'trade',6,png);add(null,'trade',6,png);
 add(null,'backtest',9,png);add(null,'backtest',9,png);
 assert.equal(env.handlers['result-images:list'](null,'trade',6).length,3);
 assert.equal(env.handlers['result-images:list'](null,'backtest',9).length,2);
 assert.notEqual(env.rows.trade[0].id,env.rows.trade[1].id);
 assert.deepEqual(Buffer.from(env.rows.trade[1].image),bytes);
});
test('images cannot be listed, added or deleted from a different trading account',()=>{
 const env=envSetup();
 env.handlers['result-images:add'](null,'trade',6,png);
 const first=env.rows.trade[0].id;
 env.switchAccount(2);
 assert.throws(()=>env.handlers['result-images:list'](null,'trade',6),/Чужая сделка/);
 assert.throws(()=>env.handlers['result-images:add'](null,'backtest',9,png),/Чужая запись/);
 assert.throws(()=>env.handlers['result-images:delete'](null,'trade',first),/Чужая сделка/);
 assert.equal(env.rows.trade.length,1);
});
test('individual screenshot deletion never deletes the other result gallery',()=>{
 const env=envSetup();
 env.handlers['result-images:add'](null,'trade',6,png);
 env.handlers['result-images:add'](null,'backtest',9,png);
 const tradeId=env.rows.trade[0].id;
 env.handlers['result-images:delete'](null,'trade',tradeId);
 assert.equal(env.rows.trade.length,0);
 assert.equal(env.rows.backtest.length,1);
});
test('new SQLite tables are additive, included in trade and account deletion and backup DB',()=>{
 for(const table of ['trade_result_images','backtest_result_images']){
   assert.match(main,new RegExp('CREATE TABLE IF NOT EXISTS '+table));
   assert.match(deletion(8).map(x=>x[0]).join(' '),new RegExp('DELETE FROM '+table+' WHERE'));
 }
 assert.match(main,/DELETE FROM trade_result_images WHERE trade_id=\?/);
 assert.match(main,/DELETE FROM backtest_result_images WHERE backtest_trade_id=\?/);
 assert.match(main,/const bytes = db\.export\(\)/);
 assert.match(main,/CREATE TABLE IF NOT EXISTS trade_extra_screenshots/);
});
test('Edit Trade, Trade Details and Backtest each expose a separate Result section',()=>{
 for(const id of ['tradeResultGrid','tradeResultCount','detailResultGrid','detailResultCount','btResultGrid','btResultCount','resultImageFileInput'])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.equal((html.match(/<h3>Результат:<\/h3>/g)||[]).length,3);
 for(const method of ['listResultImages','addResultImage','deleteResultImage','readClipboardImage'])
   assert.match(preload,new RegExp(method+':'));
 assert.match(renderer,/pendingTradeResultImages\.push\(/);
 assert.match(renderer,/while\(pendingTradeResultImages\.length\)/);
 assert.match(renderer,/ClipboardEvent|document\.addEventListener\('paste'/);
 assert.match(renderer,/pasteDestination\(element\)/);
});
