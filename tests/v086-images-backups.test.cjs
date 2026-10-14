'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const imageOrder=require('../src/image-order');
const backup=require('../src/backup-policy');
const src=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
const main=src('main.js'),html=src('index.html'),preload=src('preload.js');
const editor=src('image-workspace.js'),css=src('image-workspace.css');

test('ordering: saved keys merge with newly added images and stale keys are ignored',()=>{
  assert.deepEqual(imageOrder.mergeSavedOrder(['id:2','id:3','id:5'],['id:5','id:2','id:1']),['id:5','id:2','id:3']);
  assert.deepEqual(imageOrder.moveKey(['id:1','id:2','id:3'],'id:1','id:3'),['id:2','id:3','id:1']);
  assert.equal(imageOrder.sameImageSet(['id:2','id:1'],['id:1','id:2']),true);
  assert.equal(imageOrder.sameImageSet(['id:2','id:2'],['id:1','id:2']),false);
  assert.equal(imageOrder.sameImageSet(['id:999','id:1'],['id:1','id:2']),false);
  assert.equal(imageOrder.sameImageSet(['legacy:1W','extra:21'],['legacy:1W','extra:21']),true);
});
test('ordering: a malicious or cross-gallery key cannot be saved',()=>{
  assert.equal(imageOrder.validKeys(['id:1','extra:2','legacy:4H']),true);
  for(const invalid of [['id:1','id:1'],['id:-1'],['../secret'],['id:3;DROP TABLE'],['pending:1'],'abc']){
    assert.equal(imageOrder.validKeys(invalid),false);
  }
  assert.equal(imageOrder.validKeys(new Array(2001).fill('id:1')),false);
});
test('daily backup policy runs at most once per day, supports 7/14/30 slots',()=>{
  const day=new Date(2026,9,14,12,31,2);
  assert.equal(backup.dayStamp(day),'2026-10-14');
  const name=backup.autoFilename(day);
  assert.match(name,/^auto-2026-10-14-123102-000\.sqlite$/);
  assert.equal(backup.isBackupName(name),true);
  assert.equal(backup.alreadyBackedUpToday([name],day),true);
  assert.equal(backup.alreadyBackedUpToday([name],new Date(2026,9,15)),false);
  assert.equal(backup.enabled(undefined),true);
  assert.equal(backup.enabled('0'),false);
  assert.equal(backup.retention(999),14);
  assert.equal(backup.retention(30),30);
});
test('daily backup retention leaves newest copies and never removes unrelated files',()=>{
  const files=Array.from({length:24},(_,i)=>backup.autoFilename(new Date(2026,8,i+1,8,0,0)));
  const result=backup.retentionPlan(['personal.sqlite','settings.json',...files],7);
  assert.equal(result.length,17);
  assert.deepEqual(result,[...result].sort().reverse());
  assert.equal(result.includes('settings.json'),false);
});
test('image ordering IPC guards active ownership and entire image set',()=>{
  const handlers={},deletes=[];
  const start=main.indexOf('function liveOrderKeys('),end=main.indexOf('// Windows clipboard fallback',start);
  assert.ok(start>-1&&end>start);
  const registered={};
  const sandbox={
    ipcMain:{handle:(name,fn)=>{registered[name]=fn;}},
    imageOrder,Number,Error,
    requireCurrentTrade:id=>{if(id!==12)throw Error('not current account');},
    requireBacktestTrade:id=>{if(id!==5)throw Error('no backtest');},
    requireAsset:id=>{if(id!==20)throw Error('wrong asset');},
    run:(query,params)=>{
      if(query.includes('trade_screenshots'))return [{timeframe:'1W'}];
      if(query.includes('trade_extra_screenshots'))return [{id:3}];
      if(query.includes('image_orders'))return [];
      if(query.includes('backtest_images'))return [{id:10},{id:11}];
      if(query.includes('backtest_result_images'))return [{id:20}];
      if(query.includes('trade_result_images'))return [{id:3},{id:4}];
      if(query.includes('plan_images'))return [{id:6}];
      return [];
    },
    db:{run:(q,v)=>deletes.push([q,v])},persist:()=>{}
  };
  vm.runInNewContext(main.slice(start,end),sandbox);
  assert.throws(()=>registered['image-orders:save'](null,'trade-captures',13,['legacy:1W','extra:3']),/not current account/);
  assert.throws(()=>registered['image-orders:save'](null,'trade-captures',12,['legacy:1W','extra:999']),/Список скриншотов изменился/);
  assert.equal(registered['image-orders:save'](null,'trade-captures',12,['extra:3','legacy:1W']),true);
  assert.ok(deletes.some(([sql])=>sql.startsWith('INSERT INTO image_orders')));
});
test('image editor is additive and backed up, with accessible controls',()=>{
  for(const id of ['imageEditorModal','imageEditTool','imageEditColor','imageEditWidth','imageEditText','imageEditCanvas','imageEditSave','backupModal','autoBackupEnabled','autoBackupKeep'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(editor,/pasteExtraScreenshot/);
  assert.match(editor,/pasteBacktestImage/);
  assert.match(editor,/addResultImage/);
  assert.match(editor,/pastePlanImage/);
  assert.match(editor,/drawActions\.forEach/);
  assert.match(editor,/canvas\.toDataURL\('image\/png'\)/);
  assert.match(css,/\.image-drop-target/);
  assert.match(html,/src="image-workspace\.js"/);
  assert.match(preload,/saveImageOrder/);
  assert.match(main,/CREATE TABLE IF NOT EXISTS image_orders/);
  assert.match(main,/function createAutoBackup/);
  assert.match(main,/backup:run-auto/);
});

test('automatic backups copy the database atomically, are limited to one per day and rotate old files',()=>{
  const os=require('node:os');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shelld-backup-v086-'));
  try{
    const source=path.join(root,'shelld-statistics.sqlite');
    const payload=Buffer.alloc(420);Buffer.from('SQLite format 3\u0000','ascii').copy(payload);
    fs.writeFileSync(source,payload);
    const autoDir=path.join(root,'auto-backups');fs.mkdirSync(autoDir);
    for(let i=1;i<=20;i++){
      const d=new Date(2026,8,i,8,0,0);
      fs.writeFileSync(path.join(autoDir,backup.autoFilename(d)),payload);
    }
    const begin=main.indexOf('let lastAutoBackupError=null;'),end=main.indexOf('function createWindow()',begin);
    assert.ok(begin>-1&&end>begin);
    const sandbox={
      app:{getPath:()=>root},path,fs,Buffer,Date,Error,console,db:{},dbPath:source,
      backupPolicy:backup,persist:()=>{},
      run:(sql)=>sql.includes('auto_backup_keep')?[{value:'7'}]:sql.includes('auto_backup_enabled')?[{value:'1'}]:[]
    };
    vm.runInNewContext(main.slice(begin,end),sandbox);
    const result=sandbox.createAutoBackup(false);
    assert.equal(result.skipped,false);
    assert.equal(Buffer.compare(fs.readFileSync(result.filePath),payload),0);
    assert.equal(sandbox.createAutoBackup(false).skipped,true);
    assert.equal(fs.readdirSync(autoDir).filter(backup.isBackupName).length,7);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
