'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {positiveCapital,parseCSV,analyzeNotionCSV,parseDate,normalizedRow}=require('../src/import-utils');
const file=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Account basis input supports comma, dot, spaces, zero for manual, rejects invalid strings',()=>{
 assert.equal(positiveCapital('10 000,50'),10000.5);
 assert.equal(positiveCapital('10000.25'),10000.25);
 assert.equal(positiveCapital(0),0);
 assert.throws(()=>positiveCapital(0,{allowZero:false}),/больше нуля/);
 for(const invalid of ['abc','-1','10000e7','1/2','Infinity'])assert.throws(()=>positiveCapital(invalid));
});
test('Notion CSV parses escaped quotes, embedded newlines and semicolon delimiters',()=>{
 const parsed=parseCSV('Start - End Date;Pair;Direction;Notes\r\n"17/09/2026 19:56 → 22/09/2026 12:52";EURUSD;Long;"note; with ""quotes""\nand a newline"\r\n');
 assert.equal(parsed.rows.length,1);
 assert.equal(parsed.rows[0].Notes,'note; with "quotes"\nand a newline');
 assert.equal(parsed.columns.length,4);
});
test('Notion entry preserves results, R and percent, without guessing blanks',()=>{
 const text='Start - End Date,Pair,Direction,Result,RR,Profit,Model,Notes\n'+
 '"17/09/2026 19:56 → 22/09/2026 12:52",EURUSD,Short,Lose,-1,-1%,4H FVG,"a,b"\n'+
 '05.10.2026 12:30,GBPUSD,Long,In Progress,,,OB,\n'+
 '05.10.2026 12:30,XAUUSD,Long,BE,0,"-0,2%",H4,\n';
 const parsed=analyzeNotionCSV(text,7);
 assert.equal(parsed.total,3);assert.equal(parsed.valid.length,3);
 assert.equal(parsed.valid[0].closed_at,'2026-09-22 12:52');
 assert.equal(parsed.valid[0].result,'LOSS');assert.equal(parsed.valid[0].gain_pct,-1);
 assert.equal(parsed.valid[1].result,'OPEN');assert.equal(parsed.valid[1].percent_known,0);
 assert.equal(parsed.valid[1].r_known,0);
 assert.equal(parsed.valid[2].result,'BE');assert.equal(parsed.valid[2].gain_pct,-0.2);
 assert.notEqual(parsed.valid[0].external_key,analyzeNotionCSV(text,8).valid[0].external_key);
 assert.equal(parsed.valid[0].external_key,analyzeNotionCSV(text,7).valid[0].external_key);
});
test('Notion import preserves rows with missing dates and directions for later editing',()=>{
 const a=analyzeNotionCSV('Date,Pair,Direction,Result\n05.10.2026 09:00,GER40,SHORT,WIN\n,EURUSD,LONG,LOSS\n05.10.2026 10:00,GBPUSD,,WIN',3);
 assert.equal(a.valid.length,3);assert.equal(a.invalid.length,0);
 assert.equal(a.valid[1].opened_at,'');assert.equal(a.valid[2].direction,'UNKNOWN');
 assert.equal(a.incomplete,3);
 assert.equal(a.valid[0].asset,'GER40');assert.equal(parseDate('05.10.2026 09:00'),'2026-10-05 09:00');
});
test('Backend preserves account phases, protects archiving and historical percentages',()=>{
 const main=file('src/main.js');
 for(const part of ["ipcMain.handle('groups:create'","ipcMain.handle('groups:trades'","ipcMain.handle('notion:preview'","ipcMain.handle('notion:import'","ipcMain.handle('accounts:archive'",'positiveCapital(config?.basis,{allowZero:false})','AND source=\'mt5\' AND profit_money IS NOT NULL','account_group_members','createAutoBackup(true)']) assert.ok(main.includes(part),part);
 assert.match(main,/WHERE m.group_id=\?/);
 assert.match(main,/if\(profile\.archived_at\)throw/);
});
test('Public UI has dedicated account creation, group toggles and Notion preview, no number arrows',()=>{
 const html=file('src/index.html');
 for(const id of ['newAccountModal','newAccountForm','newAccountBasis','accountBasis','portfolioGroupForm','portfolioGroupsList','notionImportModal','notionImportBtn','notionPreview','notionImportConfirm','portfolioModeNotice']) assert.ok(html.includes(`id="${id}"`),id);
 assert.match(html,/id="accountBasis" type="text" inputmode="decimal"/);
 assert.match(html,/id="newAccountBasis" type="text" inputmode="decimal"/);
 assert.match(html,/id="mt5Basis" type="text"[^>]+required/);
});
test('Portfolio analytics combines closed trades from two phases while respecting unknown percent',()=>{
 const S=require('../src/stats.js');
 const base={opened_at:'2026-10-10 10:00',closed_at:'2026-10-11 10:00',r_known:0,r_multiple:0};
 const rows=[
  {...base,id:11,account_id:1,result:'WIN',asset:'EURUSD',gain_pct:2,percent_known:1},
  {...base,id:29,account_id:2,result:'LOSS',asset:'GBPUSD',gain_pct:-1,percent_known:1},
  {...base,id:30,account_id:2,result:'WIN',asset:'XAUUSD',gain_pct:0,percent_known:0},
  {...base,id:31,account_id:2,result:'OPEN',asset:'GER40',gain_pct:4,percent_known:1}
 ];
 const all=S.compute(rows,'r_multiple',{enabled:false});
 assert.equal(all.tradeCount,4);assert.equal(all.closedCount,3);assert.equal(all.totalGain,1);
 assert.equal(all.pricedCount,2);assert.equal(all.unpricedCount,1);
 assert.equal(S.compute(rows.filter(t=>t.account_id===1),'r_multiple',{enabled:false}).totalGain,2);
 assert.equal(S.compute(rows.filter(t=>t.account_id===2),'r_multiple',{enabled:false}).totalGain,-1);
});
