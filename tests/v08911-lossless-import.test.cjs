const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {analyzeNotionCSV,parseDate,normalizedRow}=require('../src/import-utils');
const root=path.join(__dirname,'..');
const source=f=>fs.readFileSync(path.join(root,f),'utf8');

test('Every nonempty CSV row is importable even with entirely absent required fields',()=>{
 const csv='Date,Pair,Direction,Result,Notes,Custom Notion field\n'+
  '05.10.2026 11:30,EURUSD,Long,WIN,note,Tag Alpha\n'+
  ',GBPUSD,Short,LOSS,,Tag Beta\n'+
  '05.10.2026 12:30,XAUUSD,,Unrecognized result,,Tag Gamma\n'+
  ',,,,Everything missing is preserved,\n';
 const result=analyzeNotionCSV(csv,24);
 assert.equal(result.total,4);assert.equal(result.valid.length,4);assert.equal(result.invalid.length,0);
 assert.equal(result.incomplete,4);
 assert.equal(result.valid[1].opened_at,'');
 assert.equal(result.valid[2].result,'UNKNOWN');
 assert.equal(result.valid[2].direction,'UNKNOWN');
 assert.equal(result.valid[3].asset,'');
 assert.equal(result.valid[3].result,'UNKNOWN');
 assert.match(result.valid[2].notes,/Custom Notion field: Tag Gamma/);
 assert.match(result.valid[3].notes,/Everything missing is preserved/);
});

test('Unknown status is not turned into OPEN or BE and numeric percentages are not invented',()=>{
 const sample=normalizedRow({'Start - End Date':'13.10.2026 13:00','Pair':'EURUSD','Direction':'Long','Result':'?','Risk':1,'RR':'','Gain (%)':''});
 assert.equal(sample.result,'UNKNOWN');assert.equal(sample.percent_known,0);assert.equal(sample.r_known,0);
 assert.equal(sample.gain_pct,0);assert.equal(sample.r_multiple,0);
 assert.match(sample.notes,/Не заполнено после импорта:.*Дата закрытия.*Статус.*Проценты.*R/);
 const open=normalizedRow({Date:'13.10.2026 13:00',Result:'In Progress'});
 assert.equal(open.result,'OPEN');
});

test('Missing close time does not block WIN/LOSS, and full CSV values are in notes',()=>{
 const sample=normalizedRow({Date:'13.10.2026 13:00',Pair:'EURUSD',Direction:'Short',Result:'Take',RR:'2', 'Extra column':'H4 retest'});
 assert.equal(sample.result,'WIN');assert.equal(sample.closed_at,null);
 assert.equal(sample.r_known,1);assert.equal(sample.r_multiple,2);
 assert.equal(sample.percent_known,0);
 assert.match(sample.notes,/Extra column: H4 retest/);
});

test('Repeated import same file/account has identical source keys, other account uses different keys',()=>{
 const sample='Date,Pair,Result\n,GBPUSD,unverified';
 const a=analyzeNotionCSV(sample,1).valid[0];
 const b=analyzeNotionCSV(sample,1).valid[0];
 const c=analyzeNotionCSV(sample,2).valid[0];
 assert.equal(a.external_key,b.external_key);
 assert.notEqual(a.external_key,c.external_key);
});

test('Date parsing accepts common Notion locale formats without inventing invalid dates',()=>{
 assert.equal(parseDate('Oct 14, 2026 7:15 PM'),'2026-10-14 19:15');
 assert.equal(parseDate('2026-10-14 13:20'),'2026-10-14 13:20');
 assert.equal(parseDate('31.02.2026 13:20'),'');
 assert.equal(parseDate(''),'');
});

test('Unknown imported trade remains editable with empty dates and numeric placeholders',()=>{
 const backend=source('src/main.js');const render=source('src/renderer.js');const html=source('src/index.html');
 assert.match(backend,/allowIncomplete:before\.source==='notion'/);
 assert.match(backend,/Number\(t\.percent_known\)===0\?0:1/);
 assert.match(backend,/Number\(t\.r_known\)===0\?0:1/);
 assert.match(render,/unknownNumber\?'':/);
 assert.match(render,/const imported=editingTradeId!=null/);
 assert.match(html,/<option value="UNKNOWN">Не определён \(импорт\)<\/option>/);
 assert.match(html,/Не указан \(импорт\)/);
 const stats=require('../src/stats.js');
 const s=stats.compute([{result:'UNKNOWN',percent_known:0,source:'notion'}]);
 assert.equal(s.closedCount,0);assert.equal(s.openCount,0);assert.equal(s.unknownCount,1);
});
