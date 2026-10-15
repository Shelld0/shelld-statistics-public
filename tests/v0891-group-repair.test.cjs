'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {emptyDuplicateIds}=require('../src/account-duplicates');
const file=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const acc=(id,overrides={})=>({id,label:'Fundingpips',broker:'Fundingpips',currency:'EUR',trades_count:0,plans_count:0,weeks_count:0,backtests_count:0,group_count:0,studio_images_count:0,mt5_login:'',mt5_server:'',archived_at:null,...overrides});

test('Repeated empty accounts are detected; active profile is never deleted',()=>{
 const rows=[acc(1),acc(2),acc(3),acc(4)];
 assert.deepEqual(emptyDuplicateIds(rows,4),[1,2,3]);
 assert.deepEqual(emptyDuplicateIds(rows,1),[2,3,4]);
});
test('Do not touch accounts with history, attached images, group memberships, MT5 or archive',()=>{
 const rows=[acc(1,{trades_count:8}),acc(2,{plans_count:1}),acc(3,{backtests_count:2}),acc(4,{weeks_count:2}),acc(5,{studio_images_count:1}),acc(6,{group_count:1}),acc(7,{mt5_login:'777'}),acc(8,{mt5_server:'FTMO'}),acc(9,{archived_at:'2026-10-01'}),acc(10),acc(11)];
 assert.deepEqual(emptyDuplicateIds(rows,10),[11]);
});
test('Unrelated broker names and currencies are not considered duplicates',()=>{
 const rows=[acc(1),acc(2,{broker:'FTMO'}),acc(3,{currency:'USD'}),acc(4,{label:'Different'})];
 assert.deepEqual(emptyDuplicateIds(rows,2),[]);
});
test('Account insert obtains ID before sql.js persist and returns a valid profile',()=>{
 const main=file('src/main.js');
 const from=main.indexOf("ipcMain.handle('accounts:create'");
 const to=main.indexOf("ipcMain.handle('accounts:update'",from);
 const body=main.slice(from,to);
 assert.ok(from>0&&to>from);
 assert.match(body,/const createdId=Number\(run\('SELECT last_insert_rowid\(\) AS id'/);
 assert.ok(body.indexOf('const createdId=Number(')<body.indexOf('persist();'));
 assert.match(body,/return accountProfile\(createdId\)/);
 assert.match(body,/Счёт с таким названием уже есть/);
});
test('Group mode keeps MT5, Plans, Backtest and Notion available to selected work account',()=>{
 const accountUi=file('src/account-ui.js'),renderer=file('src/renderer.js'),notion=file('src/notion-import-ui.js'),main=file('src/main.js');
 assert.match(main,/ipcMain\.handle\('groups:add-member'/);
 assert.match(accountUi,/useGroupWorkAccount/);
 assert.match(accountUi,/mt5Button\.disabled=false/);
 assert.match(accountUi,/button\.disabled=false/);
 assert.match(renderer,/window\.shelldGroupViewId\?\.\(\)\?window\.shelld\.listGroupTrades/);
 assert.doesNotMatch(renderer,/Для планов, бектестов и экспорта выбери отдельный счёт/);
 assert.doesNotMatch(notion,/if\(window\.shelldReadOnlyPortfolio\)/);
 assert.match(main,/ipcMain\.handle\('notion:preview'/);
});
test('Group work controls remain in account manager; group gear only controls label visibility',()=>{
 const html=file('src/index.html'),accountUi=file('src/account-ui.js'),css=file('src/portfolio-notion.css');
 for(const id of ['groupSettingsBtn','groupSettingsPopover','groupSettingsHolder','groupManagerControls','groupWorkAccount','groupConnectMt5Btn','groupJoinAccount','groupShowAccountLabels','cleanupEmptyDuplicatesBtn']){
   assert.ok(html.includes(`id="${id}"`),id);
 }
 assert.doesNotMatch(html,/id="groupWorkspace"/);
 assert.match(html,/id="groupSettingsPopover"[\s\S]*?id="groupShowAccountLabels"[^>]*role="switch"/);
 assert.match(accountUi,/groupNoticeTimer=setTimeout/);
 assert.match(accountUi,/},8000\)/);
 assert.match(accountUi,/setSetting\('group_account_labels'/);
 assert.match(accountUi,/group_account_labels_default_off_v0812/);
 assert.match(css,/\.portfolio-asset-stack\{display:inline-flex;flex-direction:column;align-items:center/);
 assert.match(css,/\.group-settings-popover/);
});
test('Empty-duplicate deletion is backed up, requires explicit click, and cannot delete normal history',()=>{
 const main=file('src/main.js'),ui=file('src/account-ui.js');
 assert.match(main,/before-empty-duplicate-cleanup-/);
 assert.match(main,/ipcMain\.handle\('accounts:duplicate-preview'/);
 assert.match(main,/ipcMain\.handle\('accounts:cleanup-empty-duplicates'/);
 assert.match(main,/emptyDuplicateIds\(rows,activeAccountId\(\)\)/);
 assert.match(ui,/if\(!confirm\(`Удалить/);
});
