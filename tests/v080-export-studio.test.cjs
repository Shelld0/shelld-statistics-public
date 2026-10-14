'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../src/export-studio-core.js');
const T=(id,date,result,gain,known=true,r=1,rKnown=true)=>({id,opened_at:date,closed_at:date,result,gain_pct:gain,r_multiple:r,percent_known:known?1:0,r_known:rKnown?1:0,asset:'EURUSD'});
const fixtures=[
 T(1,'2026-09-03T12:00','LOSS',-1),
 T(2,'2026-09-10T12:00','WIN',2,true,2),
 T(3,'2026-09-11T12:00','WIN',0,false,0,false),
 T(4,'2026-09-12T12:00','BE',-0.05,true,0),
 {...T(5,'2026-09-13T12:00','OPEN',55),closed_at:null},
];
test('export platform dimensions are consistent',()=>{
 assert.deepEqual(E.configs.telegram,{width:1080,height:1350,label:'Telegram Post'});
 assert.deepEqual(E.configs.square,{width:1080,height:1080,label:'Square'});
 assert.equal(E.configs.youtube,undefined); // removed in v0.8.1; Telegram and Square only
});
test('summary excludes OPEN P&L and unknown percent, includes BE P&L',()=>{
 const s=E.summarize(fixtures);
 assert.equal(s.closed,4);assert.equal(s.wins,2);assert.equal(s.losses,1);assert.equal(s.be,1);
 assert.equal(s.knownProfit,3);assert.equal(s.missingProfit,1);assert.equal(s.gain,0.95);
 assert.equal(s.winRate,200/3);
 assert.equal(s.avgWinningR,2);
 assert.equal(s.curve.length,4);
});
test('BE reclassification can be passed to summary',()=>{
 const s=E.summarize(fixtures,t=>t.id===2?'BE':t.result);
 assert.equal(s.wins,1);assert.equal(s.losses,1);assert.equal(s.be,2);
});
test('relative and calendar time periods filter closes correctly',()=>{
 const now=new Date('2026-09-15T00:00:00');
 assert.equal(E.filterPeriod(fixtures,'7',now).length,4);
 assert.equal(E.filterPeriod(fixtures,'month',now).length,5);
 assert.equal(E.filterPeriod(fixtures,'previous_month',now).length,0);
 assert.equal(E.filterPeriod(fixtures,'all',now).length,5);
});
test('account and ticker privacy are opt in',()=>{
 const a={label:'PRIVATE FTMO',mt5_login:'SECRET_LOGIN',mt5_server:'SECRET_SERVER'};
 const hidden=E.disclosure({showAccount:false,showAssets:false,showDates:false},a);
 assert.deepEqual(hidden,{account:'',assets:false,dates:false});
 const summary=E.summarize(fixtures);
 const caption=E.buildCaption(summary,{title:'Weekly recap',handle:'@shelld',showAccount:false},a);
 for(const secret of ['PRIVATE FTMO','SECRET_LOGIN','SECRET_SERVER'])assert.equal(caption.includes(secret),false);
 assert.ok(caption.includes('Weekly recap'));
 assert.ok(caption.includes('@shelld'));
});
test('trade select excludes OPEN and IDs match account-scoped trade data',()=>{
 assert.equal(E.getTrade(fixtures,2)?.id,2);
 assert.equal(E.getTrade(fixtures,5),null);
});
test('zero values remain valid, while unknown metrics use dash',()=>{
 assert.equal(E.isKnown(T(3,'2026-09-01T00:00','BE',0), 'pct'),true);
 assert.equal(E.formatSigned(null),'—');
 assert.equal(E.formatSigned(-2.5),'-2.5%');
 assert.equal(E.formatSigned(2.5,'R',2),'+2.50R');
});
