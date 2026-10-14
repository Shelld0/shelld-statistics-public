'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=path.resolve(__dirname,'../src');
const read=file=>fs.readFileSync(path.join(src,file),'utf8');
const html=read('index.html');
const renderer=read('renderer.js');
const studio=read('export-studio.js');
const css=read('ui-scrollbars.css');
const main=read('main.js');
const preload=read('preload.js');

test('Export Studio contains exactly four settings groups and no screenshot upload section',()=>{
 const view=html.slice(html.indexOf('<section class="page" id="studio"'),html.indexOf('</main>',html.indexOf('<section class="page" id="studio"')));
 assert.equal((view.match(/class="studio-section(?: |")/g)||[]).length,4);
 for(const id of ['studioPasteZone','studioResultImages','studioImageFiles','studioResultCount'])assert.doesNotMatch(view,new RegExp(id));
 assert.match(view,/data-studio-format="telegram"/);
 assert.match(view,/data-studio-format="square"/);
 assert.doesNotMatch(view,/data-studio-format="youtube"/);
 assert.match(html,/id="btResultGrid"/);
 assert.match(html,/id="tradeResultGrid"/);
});
test('Export Studio output returns to one PNG and preserves the old SQLite album for historical backups',()=>{
 assert.match(studio,/window\.shelld\.saveImageExport\(/);
 assert.doesNotMatch(studio,/window\.shelld\.saveResultAlbum\(/);
 assert.match(main,/CREATE TABLE IF NOT EXISTS studio_result_images/);
});
test('hover-targeted paste does not default to Result and offers timeframe selection on Add',()=>{
 assert.match(renderer,/function pasteDestination\(element\)/);
 assert.match(renderer,/function currentPasteDestination\(\)/);
 assert.match(renderer,/document\.elementFromPoint\(pointerPasteX,pointerPasteY\)/);
 assert.match(renderer,/stagedCapturePaste=\{place:destination\.place,images\}/);
 assert.match(renderer,/if\(destination\.kind==='result'\)/);
 assert.match(renderer,/if\(destination\.kind==='capture-picker'\)/);
 assert.match(renderer,/else if\(destination\.kind==='weekly'\)/);
 assert.doesNotMatch(renderer,/resultPlace=.*tradeEditor/);
});
test('Ctrl+V text remains a normal paste rather than being redirected to a screenshot gallery',()=>{
 assert.match(renderer,/types\.includes\('text\/plain'\)/);
 assert.match(renderer,/if\(!destination\)return;/);
 assert.match(renderer,/event\.preventDefault\(\);\s*safe\(\(\)=>importClipboardTo/);
});
test('scrollbars have a transparent track and lightweight handle for dark and light themes',()=>{
 assert.match(html,/href="ui-scrollbars\.css"/);
 assert.match(css,/scrollbar-width:thin/);
 assert.match(css,/scrollbar-color:var\(--shelld-scroll-thumb\) transparent/);
 assert.match(css,/::-webkit-scrollbar-track/);
 assert.match(css,/background:transparent/);
 assert.match(css,/:root\.light/);
});
test('Studio preferences have immediate local drafts, debounced SQLite writes and final flush on quit',()=>{
 assert.match(studio,/localStorage\.setItem\(draftKey\(id\)/);
 assert.match(studio,/saveTimer=setTimeout/);
 assert.match(studio,/window\.addEventListener\('beforeunload'/);
 assert.match(studio,/flushStudioPreferences\?\.\(/);
 assert.match(preload,/flushStudioPreferences:/);
 assert.match(main,/ipcMain\.on\('studio:prefs-flush'/);
});
test('final synchronous persistence saves an account-scoped, validated draft',()=>{
 const start=main.indexOf("ipcMain.on('studio:prefs-flush'");
 const end=main.indexOf("ipcMain.handle('backup:export'",start);
 assert.ok(end>start);
 const handlers={},writes=[];
 const sandbox={
   ipcMain:{on:(name,handler)=>handlers[name]=handler},
   Number,String,JSON,Error,
   run:(query,args)=>Number(args[0])===1?[{id:1}]:[],
   exec:(query,args)=>writes.push({query,args})
 };
 vm.runInNewContext(main.slice(start,end),sandbox);
 const flush=handlers['studio:prefs-flush'];
 assert.equal(typeof flush,'function');
 let event={};flush(event,1,'{"title":"Мой план","mode":"trade"}');
 assert.equal(event.returnValue,true);
 assert.equal(writes.length,1);
 assert.equal(writes[0].args[0],'export_studio_v1_account_1');
 event={};flush(event,2,'{"title":"Other"}');
 assert.equal(event.returnValue,false);
 assert.equal(writes.length,1);
 event={};flush(event,1,'{INVALID}');
 assert.equal(event.returnValue,false);
 event={};flush(event,1,'x'.repeat(8193));
 assert.equal(event.returnValue,false);
});
