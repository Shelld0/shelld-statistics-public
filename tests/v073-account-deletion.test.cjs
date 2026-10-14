'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {deletionSteps}=require('../src/account-removal');
const base=path.join(__dirname,'../src');
const main=fs.readFileSync(path.join(base,'main.js'),'utf8');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const ui=fs.readFileSync(path.join(base,'account-ui.js'),'utf8');
const preload=fs.readFileSync(path.join(base,'preload.js'),'utf8');
const start=main.indexOf("ipcMain.handle('accounts:delete'");
const end=main.indexOf("ipcMain.handle('accounts:forget-secret'",start);
assert.ok(start>=0&&end>start);
const handlerSource=main.slice(start,end);
function createEnv(options={}){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'shelld-account-delete-'));
  const calls=[];let stopped=false;
  const handlers={};
  const env={
    ipcMain:{handle:(name,fn)=>handlers[name]=fn},
    mt5Busy:!!options.busy,
    accountProfile:id=>({id:Number(id),label:'My Account'}),
    activeAccountId:()=>options.activeId??1,
    run:()=> options.last? [] : [{id:2}],
    db:{export:()=>new Uint8Array([0x53,0x51,0x4c,0x69,0x74,0x65]),run:(sql,params)=>calls.push({sql,params})},
    app:{getPath:()=>tmp},fs,path,Buffer,Date,
    stopMt5:()=>{stopped=true;},persist:()=>{},deletionSteps,
    secretPath:id=>path.join(tmp,`mt5-secret-${id}.bin`),
    Number,String,Error,Math
  };
  vm.runInNewContext(handlerSource,env,{filename:'main.js/accounts:delete'});
  return {handler:handlers['accounts:delete'],tmp,calls,stopped:()=>stopped,cleanup:()=>fs.rmSync(tmp,{recursive:true,force:true})};
}
test('account deletion only targets account-owned rows and all dependent images',()=>{
  const statements=deletionSteps(7);
  const affected=statements.map(x=>x[0]).join(' | ');
  for(const table of ['trade_screenshots','trade_extra_screenshots','trades','plan_images','weekly_plan_assets','weekly_plans','plans','backtest_images','backtest_trades','backtests','accounts'])
    assert.match(affected,new RegExp('DELETE FROM '+table+'(?: |\\|)'));
  for(const [,params] of statements)assert.equal(params[0],7);
  assert.throws(()=>deletionSteps(0),/ID/);
  assert.throws(()=>deletionSteps(-1),/ID/);
});
test('reject last-account deletion or wrong confirmation before any write',()=>{
  const env=createEnv({last:true});
  try{
    assert.throws(()=>env.handler(null,1,'My Account'),/последний профиль/);
    assert.throws(()=>env.handler(null,1,'Different Name'),/точное название/);
    assert.equal(env.calls.length,0);
    assert.equal(env.stopped(),false);
    assert.equal(fs.existsSync(path.join(env.tmp,'account-backups')),false);
  }finally{env.cleanup();}
});
test('deleting selected account backs up data, switches to another profile and removes only selected secret',()=>{
  const env=createEnv({activeId:1});
  try{
    const file1=path.join(env.tmp,'mt5-secret-1.bin');
    const file2=path.join(env.tmp,'mt5-secret-2.bin');
    fs.writeFileSync(file1,'encrypted account 1');
    fs.writeFileSync(file2,'encrypted account 2');
    const result=env.handler(null,1,'My Account');
    assert.equal(result.deleted,true);
    assert.equal(result.id,1);assert.equal(result.switchedTo,2);
    assert.equal(result.secretRemoved,true);
    assert.equal(fs.existsSync(result.backupPath),true);
    assert.equal(fs.readFileSync(result.backupPath).toString('utf8'),'SQLite');
    assert.equal(fs.existsSync(file1),false);
    assert.equal(fs.existsSync(file2),true);
    assert.equal(env.stopped(),true);
    const sql=env.calls.map(x=>x.sql).join('\n');
    assert.match(sql,/BEGIN TRANSACTION/);
    assert.match(sql,/UPDATE settings SET value=\?/);
    assert.match(sql,/DELETE FROM trade_extra_screenshots/);
    assert.match(sql,/DELETE FROM accounts WHERE id=\?/);
    assert.match(sql,/COMMIT/);
  }finally{env.cleanup();}
});
test('deleting inactive profile leaves current MT5 session running',()=>{
  const env=createEnv({activeId:2});
  try{
    const result=env.handler(null,1,'My Account');
    assert.equal(result.switchedTo,null);
    assert.equal(env.stopped(),false);
    assert.equal(env.calls.some(({sql})=>sql.includes('UPDATE settings SET value=')),false);
  }finally{env.cleanup();}
});
test('MT5 busy blocks deletion before backup or any change',()=>{
  const env=createEnv({busy:true});
  try{
    assert.throws(()=>env.handler(null,1,'My Account'),/синхронизации MT5/);
    assert.equal(env.calls.length,0);
    assert.equal(env.stopped(),false);
  }finally{env.cleanup();}
});
test('UI exposes accessible deletion and typed confirmation; both bridge methods are available',()=>{
  for(const id of ['accountDeleteModal','accountDeleteForm','accountDeleteNameInput','confirmDeleteAccountBtn','accountDeleteBackup','deleteSelectedAccountBtn'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(preload,/deleteAccount:\s*\(id,label\)/);
  assert.match(ui,/data-delete-account/);
  assert.match(ui,/entered!==account\.label/);
  assert.match(ui,/accountDeleteBackupPath/);
  assert.match(ui,/window\.resetShelldAfterAccountSwitch\(\)/);
});
