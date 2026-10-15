'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');

test('Public Beta uses a distinct Electron app ID and starts with a blank manual profile',()=>{
 const pkg=JSON.parse(read('package.json'));
 const main=read('src/main.js');
 assert.equal(pkg.build.appId,'com.shelld.statistics.publicbeta');
 assert.equal(pkg.build.productName,'Shelld Statistics Public Beta');
 assert.match(main,/\['Мой счёт','Manual','','','','',0,'EUR'\]/);
 // Data is separated through Electron's distinct productName and appId.
 assert.match(main,/app\.getPath\('userData'\)/);
});

test('Public UI keeps optional MT5 Connect with empty credentials',()=>{
 const html=read('src/index.html');
 assert.match(html,/id="mt5OpenBtn"/);
 for(const id of ['mt5Login','mt5Server','mt5Python','mt5Terminal','mt5Basis']){
   assert.match(html,new RegExp('id="'+id+'"'));
 }
 const main=read('src/main.js');
 assert.match(main,/mt5_login TEXT NOT NULL DEFAULT ''/);
 assert.match(main,/mt5_server TEXT NOT NULL DEFAULT ''/);
});

test('Windows workflow distributes installer EXE, not source ZIP',()=>{
 const yml=read('.github/workflows/windows-release.yml');
 assert.match(yml,/runs-on: windows-2022/);
 assert.match(yml,/npm run dist/);
 assert.match(yml,/release\/\*\.exe/);
 assert.match(yml,/actions\/upload-artifact/);
 assert.match(yml,/softprops\/action-gh-release/);
});

test('No personal presets ship in the Public Edition',()=>{
 assert.ok(!fs.existsSync(path.join(base,'FTMO_PRESET.txt')));
 assert.ok(!fs.existsSync(path.join(base,'PRIVATE_BUILD_NOTICE.txt')));
 assert.ok(!fs.existsSync(path.join(__dirname,'ftmo-preset.test.cjs')));
});

for(const f of ['example-notion-export.zip','notion-with-screenshots.zip','notion-untitled-short-id.zip']){
 test('CI includes Notion fixture '+f,()=>{
  assert.ok(fs.statSync(path.join(__dirname,'fixtures',f)).size>0);
 });
}
