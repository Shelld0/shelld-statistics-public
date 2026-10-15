'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {notionZipCSVs,analyzeNotionExportZip,analyzeNotionExportCsv}=require('../src/notion-zip');
const {parseDate,normalizedRow}=require('../src/import-utils');
const root=path.resolve(__dirname,'..');
const buffer=fs.readFileSync(path.join(__dirname,'fixtures/example-notion-export.zip'));
test('ZIP contains two differently ordered duplicates and yields three unique trades',()=>{
 const csvs=notionZipCSVs(buffer);
 assert.equal(csvs.length,2);
 const result=analyzeNotionExportZip(buffer,11,{riskPct:1});
 assert.equal(result.total,3);
 assert.equal(result.duplicateRows,3);
 assert.equal(result.incomplete,3);
 assert.deepEqual(result.valid.map(t=>t.result),['WIN','LOSS','WIN']);
 assert.deepEqual(result.valid.map(t=>t.gain_pct),[2,-1,2.5]);
 assert.deepEqual(result.valid.map(t=>t.r_multiple),[2,-1,2.5]);
 assert.deepEqual(result.valid.map(t=>t.opened_at),['2026-01-02','2026-01-06','2026-07-14']);
 assert.deepEqual(result.valid.map(t=>t.model),['fvg','fvg','девиация']);
 assert.match(result.valid[0].notes,/4H вход/);
 assert.match(result.valid[0].notes,/Время открытия/);
 assert.match(result.valid[0].notes,/Дата закрытия/);
});
test('Risk 0.5 and empty risk have sensible different percentages',()=>{
 const half=analyzeNotionExportZip(buffer,11,{riskPct:'0,5'});
 assert.deepEqual(half.valid.map(t=>t.gain_pct),[1,-.5,1.25]);
 const unknown=analyzeNotionExportZip(buffer,11,{});
 assert.equal(unknown.valid.every(t=>t.percent_known===0),true);
 assert.equal(unknown.valid.every(t=>t.r_known===1),true);
 assert.throws(()=>analyzeNotionExportZip(buffer,11,{riskPct:-2}),/риск/i);
});
test('ZIP and direct CSV produce the same Notion stable keys, regardless of column order',()=>{
 const csv=notionZipCSVs(buffer)[0];
 const direct=analyzeNotionExportCsv(csv.text,11,{filename:csv.filename,riskPct:1});
 const fromZip=analyzeNotionExportZip(buffer,11,{riskPct:1});
 assert.deepEqual(new Set(direct.valid.map(t=>t.external_key)),new Set(fromZip.valid.map(t=>t.external_key)));
 assert.notEqual(fromZip.valid[0].external_key,analyzeNotionExportZip(buffer,12,{riskPct:1}).valid[0].external_key);
 assert.equal(fromZip.valid[0].external_key,analyzeNotionExportZip(buffer,11,{riskPct:1}).valid[0].external_key);
});
test('Day-first English format is parsed, with unknown time preserved',()=>{
 assert.equal(parseDate('2 January 2026'),'2026-01-02');
 assert.equal(parseDate('2 January 2026 6:30 PM'),'2026-01-02 18:30');
 assert.equal(parseDate('31 February 2026'),'');
 assert.equal(normalizedRow({Opened:'2 January 2026',Ticker:'EUR',RR:'2',Result:'Take'},{riskPct:1}).opened_at,'2026-01-02');
});
test('Reject corrupt archive, invalid CRC and ZIP without trading CSV',()=>{
 assert.throws(()=>notionZipCSVs(Buffer.from('not a zip')),/zip/i);
 const altered=Buffer.from(buffer);altered[altered.length-35]^=0xff;
 assert.throws(()=>notionZipCSVs(altered),/ZIP|CSV|целостност|список/i);
});
test('Main UI lets user select ZIP or CSV and change risk before importing',()=>{
 const main=fs.readFileSync(path.join(root,'src/main.js'),'utf8');
 const ui=fs.readFileSync(path.join(root,'src/notion-import-ui.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'src/index.html'),'utf8');
 assert.match(main,/extensions:\['zip','csv'\]/);
 assert.match(main,/notion:recalculate/);
 assert.match(main,/createAutoBackup\(true\)/);
 assert.match(main,/sameOriginalNotionRow/);
 assert.match(ui,/recalculateNotionImport/);
 assert.match(html,/id="notionRiskPct"/);
 assert.match(html,/Notion ZIP \/ CSV/);
});
