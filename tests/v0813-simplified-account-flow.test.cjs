'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(base,f),'utf8');
const section=(s,start,end)=>s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)+start.length));

test('New account only asks for name, currency and initial capital',()=>{
  const html=read('src/index.html');
  const create=section(html,'<div class="modal-backdrop" id="newAccountModal">','<div class="modal-backdrop" id="notionImportModal">');
  for(const id of ['newAccountLabel','newAccountCurrency','newAccountBasis'])assert.match(create,new RegExp('id="'+id+'"'));
  for(const id of ['newAccountBroker','newAccountServer','newAccountLogin','newAccountPassword','newAccountTerminal'])assert.doesNotMatch(create,new RegExp('id="'+id+'"'));
  assert.match(create,/id="newAccountBasis"[^>]*required/);
  assert.match(create,/MT5 Connect/);
});

test('Account profile editing never includes or sends MT5 login/server/terminal/broker',()=>{
  const html=read('src/index.html'),ui=read('src/account-ui.js');
  const edit=section(html,'<form id="accountEditForm"','<div class="account-secret-notice">');
  for(const id of ['accountLabel','accountCurrency','accountBasis'])assert.match(edit,new RegExp('id="'+id+'"'));
  for(const id of ['accountBroker','accountLogin','accountServer','accountPython','accountTerminal'])assert.doesNotMatch(edit,new RegExp('id="'+id+'"'));
  assert.match(ui,/const inputs=\{label:'accountLabel',currency:'accountCurrency',mt5_basis:'accountBasis'\}/);
  assert.doesNotMatch(ui,/newAccountBroker/);
  assert.match(ui,/await window\.shelld\.updateAccount\(profile\)/);
});

test('MT5 Connect owns login, broker and server, and auto-fills capital/currency from account',()=>{
  const html=read('src/index.html'),ui=read('src/mt5-ui.js'),main=read('src/main.js');
  const modal=section(html,'<div class="modal-backdrop" id="mt5Modal"','<div class="modal-backdrop" id="'); // first occurrence may equal next
  for(const id of ['mt5Broker','mt5Login','mt5Server','mt5Password','mt5Terminal','mt5Basis','mt5CurrencyNote'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(ui,/by\('mt5Basis'\)\.value=Number\(a\.mt5_basis\)>0\?String\(a\.mt5_basis\):''/);
  assert.match(ui,/by\('mt5CurrencyNote'\)\.textContent/);
  assert.match(ui,/broker:by\('mt5Broker'\)\.value\.trim\(\)/);
  assert.match(main,/updateProfile\(id,\{broker:String\(config\.broker\|\|profile\.broker\)/);
  assert.match(main,/positiveCapital\(config\?\.basis,\{allowZero:false\}\)/);
});

test('Account creation uses positive capital, unique label and never pre-saves MT5 credentials',()=>{
  const main=read('src/main.js');
  const create=section(main,"ipcMain.handle('accounts:create'","ipcMain.handle('accounts:update'");
  assert.match(create,/positiveCapital\(p\?\.mt5_basis,\{allowZero:false\}\)/);
  assert.match(create,/INSERT INTO accounts\(label,broker,currency,mt5_basis\)/);
  assert.doesNotMatch(create,/INSERT INTO accounts\(label,broker,currency,mt5_basis,mt5_login/);
  assert.match(create,/SELECT last_insert_rowid\(\) AS id/);
  assert.ok(create.indexOf('const createdId=')<create.indexOf('persist();'));
});

test('Existing FTMO profile stays on personal userData and connection fields are not erased',()=>{
  const main=read('src/main.js');
  const update=section(main,'function updateProfile(id,p){','// Explicitly requested clean start');
  assert.match(update,/p\.mt5_login\?\?before\.mt5_login/);
  assert.match(update,/p\.mt5_server\?\?before\.mt5_server/);
  assert.match(update,/p\.mt5_python\?\?before\.mt5_python/);
  assert.match(update,/p\.mt5_terminal\?\?before\.mt5_terminal/);
  assert.doesNotMatch(main,/app\.setPath\('userData',publicDataRoot\)/);
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.build.appId,'com.shelld.statistics.publicbeta');
});
