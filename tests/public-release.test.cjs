'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
test('Public Beta uses separate SQLite user data and clean default profile',()=>{
 const main=read('src/main.js');
 assert.match(main,/app\.setPath\('userData',publicDataRoot\)/);
 assert.match(main,/Shelld Statistics Public Beta/);
 assert.match(main,/\['Мой счёт','Manual','','','','',0,'EUR'\]/);
 // The profile starts with no login, server, Python path or terminal path.
});
test('Public HTML has blank login and user paths, optional MT5 and working first-run choice',()=>{
 const html=read('src/index.html'),js=read('src/public-onboarding.js');
 assert.match(html,/id="mt5Login"[^>]*value=""/);
 assert.match(html,/id="mt5Server"[^>]*value=""/);
 assert.match(html,/id="mt5Python"[^>]*value=""/);
 assert.match(html,/id="mt5Terminal"[^>]*value=""/);
 assert.match(html,/id="mt5Basis"[^>]*value=""/);
 assert.match(html,/id="publicWelcomeManual"/);
 assert.match(html,/id="publicWelcomeMt5"/);
 assert.match(js,/window\.shelld\.setSetting\(KEY,'1'\)/);
});
test('Only the requested new Analytics features appear alongside legacy model analysis',()=>{
 const html=read('src/index.html');
 for(const id of ['analyticsDirectionCompare','analyticsDrawdowns','analyticsModels'])assert.ok(html.includes('id="'+id+'"'));
 for(const id of ['analyticsHeatmap','analyticsRHistogram','analyticsModelCompare','analyticsRiskCoverage'])assert.ok(!html.includes('id="'+id+'"'));
});
test('GitHub Actions workflow distributes installer EXE, not source ZIP as installed app',()=>{
 const yml=read('.github/workflows/windows-release.yml');
 assert.match(yml,/runs-on: windows-2022/);
 assert.match(yml,/npm run dist/);
 assert.match(yml,/release\/\*\.exe/);
 assert.match(yml,/actions\/upload-artifact/);
 assert.match(yml,/softprops\/action-gh-release/);
});
test('No personal preset or private notice files shipped in public edition',()=>{
 assert.ok(!fs.existsSync(path.join(base,'FTMO_PRESET.txt')));
 assert.ok(!fs.existsSync(path.join(base,'PRIVATE_BUILD_NOTICE.txt')));
 assert.ok(!fs.existsSync(path.join(__dirname,'ftmo-preset.test.cjs')));
});
