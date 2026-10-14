const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
const index=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
test('No legacy automatic destructive trade or plan migrations remain',()=>{
 const init=main.slice(main.indexOf('async function initDb()'),main.indexOf('function createWindow()'));
 assert.doesNotMatch(init,/resetAllTradeRowsV066Once\s*\(/);
 assert.doesNotMatch(init,/resetTradingJournalOnce\s*\(/);
 assert.doesNotMatch(init,/clearTestPlansOnce\s*\(/);
});
test('New chart, rename and custom date modal are shipped together',()=>{
 for(const element of ['backtestEquityChart','backtestRenameInput','btDateCalendar','btHourInput','btMinuteInput','newBacktestTitle']){
   assert.match(index,new RegExp('id="'+element+'"'));
 }
 assert.match(index,/src="notion-charts\.js"/);
});
