'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const os=require('node:os');
const base=path.join(__dirname,'../src');
const main=fs.readFileSync(path.join(base,'main.js'),'utf8');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const studio=fs.readFileSync(path.join(base,'export-studio.js'),'utf8');
const renderer=fs.readFileSync(path.join(base,'renderer.js'),'utf8');
const preload=fs.readFileSync(path.join(base,'preload.js'),'utf8');
const deletion=require('../src/account-removal').deletionSteps;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOa0GrcAAAAASUVORK5CYII=','base64');
const dataURL='data:image/png;base64,'+png.toString('base64');
const start=main.indexOf('function validateImageDataURL(');
const stop=main.indexOf('const imageData =',start);
assert.ok(stop>start);
const ctx={Buffer,Error,Math,Number,Uint8Array,String};
vm.runInNewContext(main.slice(start,stop)+'\nthis.validate=validateImageDataURL;',ctx);
test('pasted screenshots preserve original PNG bytes, not recompressed',()=>{
 const image=ctx.validate(dataURL);
 assert.equal(image.mime,'image/png');
 assert.deepEqual(Buffer.from(image.bytes),png);
});
test('reject mislabeled bytes, nonimages, and giant images',()=>{
 assert.throws(()=>ctx.validate('data:image/jpeg;base64,'+png.toString('base64')),/Повреждённый/);
 assert.throws(()=>ctx.validate('data:text/html;base64,YQ=='),/Вставь скриншот/);
 assert.throws(()=>ctx.validate('data:image/png;base64,'+'A'.repeat(24*1024*1024)),/Максимальный размер/);
});
const blockStart=main.indexOf('function studioScope(');
const blockStop=main.indexOf("ipcMain.handle('exports:save-image'",blockStart);
assert.ok(blockStart>=0&&blockStop>blockStart);
function setup(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shelld083-album-'));
 let account=1; const calls=[];const handlers={};
 const env={
   ipcMain:{handle:(name,handler)=>handlers[name]=handler},
   activeAccountId:()=>account,requireCurrentTrade:id=>{if(Number(id)!==7)throw new Error('Чужая сделка');},
   validateImageDataURL:ctx.validate,
   run:(sql,args)=>{
     if(sql.includes('SELECT id FROM studio_result_images WHERE id='))return account===1?[{id:11}]:[];
     if(sql.includes('FROM studio_result_images'))return [{id:11,mime:'image/png',image:png}];
     return [];
   },
   exec:(sql,args)=>calls.push({sql,args}),
   imageData:row=>({id:row.id,mime:row.mime,dataUrl:'data:'+row.mime+';base64,'+Buffer.from(row.image).toString('base64')}),
   dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[dir]})},
   Buffer,Date,Number,String,Math,Error,fs,path
 };
 vm.runInNewContext(main.slice(blockStart,blockStop),env,{filename:'main.js/studio-images'});
 return {handlers,calls,dir,account:id=>account=id,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('album images are saved to active account only and reject changed-account uploads',()=>{
 const testEnv=setup();
 try{
   testEnv.handlers['studio-images:add'](null,'summary',null,dataURL,1);
   assert.match(testEnv.calls[0].sql,/INSERT INTO studio_result_images/);
   assert.equal(testEnv.calls[0].args[0],1);
   testEnv.account(2);
   assert.throws(()=>testEnv.handlers['studio-images:add'](null,'summary',null,dataURL,1),/Аккаунт переключился/);
   assert.equal(testEnv.calls.length,1);
 }finally{testEnv.cleanup();}
});
test('album mode trade requires a selected trade belonging to the active account',()=>{
 const env=setup();try{
   assert.throws(()=>env.handlers['studio-images:list'](null,'trade',999,1),/Чужая сделка/);
   assert.throws(()=>env.handlers['studio-images:list'](null,'trade',null,1),/Выбери сделку/);
   assert.equal(env.handlers['studio-images:list'](null,'trade',7,1)[0].id,11);
 }finally{env.cleanup();}
});
test('export folder includes cover and every result in unmodified bytes',async()=>{
 const env=setup();try{
   const result=await env.handlers['exports:save-result-album'](null,dataURL,'summary',null,1);
   assert.equal(result.canceled,false);
   assert.equal(result.count,2);
   const files=fs.readdirSync(result.folder).sort();
   assert.deepEqual(files,['01-card.png','02-result.png']);
   for(const file of files)assert.deepEqual(fs.readFileSync(path.join(result.folder,file)),png);
 }finally{env.cleanup();}
});
test('account deletion also erases that account export-result images',()=>{
 assert.match(deletion(12).map(([sql])=>sql).join(' '),/DELETE FROM studio_result_images WHERE account_id=\?/);
});
test('Export Studio offers Telegram / Square without its former section 05 gallery',()=>{
 for(const id of ['studioStyle','studioTransparent'])assert.match(html,new RegExp('id="'+id+'"'));
 for(const id of ['studioResultImages','studioImageFiles','studioPasteZone'])assert.doesNotMatch(html,new RegExp('id="'+id+'"'));
 assert.doesNotMatch(html,/data-studio-format="youtube"/);
 assert.doesNotMatch(html,/studio-count">05<\/span>/);
 assert.match(studio,/brand\.src='assets\/logo\.svg'/);
 assert.doesNotMatch(studio,/TRADING INTELLIGENCE|SHELLD  \/  TRADING JOURNAL|PERFORMANCE REPORT/);
 assert.match(studio,/saveImageExport/);
 assert.doesNotMatch(studio,/saveResultAlbum/);
});
test('Ctrl+V hooks and SQLite IPC methods are wired for all image galleries',()=>{
 assert.match(renderer,/document\.addEventListener\('paste'/);
 for(const method of ['pasteExtraScreenshot','pasteBacktestImage','pastePlanImage']){
  assert.match(preload,new RegExp(method+'\\s*:'));
  assert.match(renderer,new RegExp('shelld\\.'+method+'\\('));
 }
 for(const method of ['listStudioImages','pasteStudioImage','deleteStudioImage','saveResultAlbum']){
  assert.match(preload,new RegExp(method+'\\s*:'));
 }
});
