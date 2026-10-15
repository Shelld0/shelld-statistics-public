'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {notionZipContents,notionZipCSVs,analyzeNotionExportZip,matchNotionImages}=require('../src/notion-zip');
const bytes=fs.readFileSync(path.join(__dirname,'fixtures/notion-with-screenshots.zip'));
const files=()=>analyzeNotionExportZip(bytes,19,{riskPct:1});
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
test('Notion ZIP reads images without discarding both duplicate CSV views',()=>{
 const entries=notionZipContents(bytes);
 assert.equal(entries.csvs.length,2);
 assert.equal(entries.images.length,3);
 assert.equal(entries.markdown.length,1);
 assert.equal(notionZipCSVs(bytes).length,2);
 const result=files();
 assert.equal(result.total,2);
 assert.equal(result.duplicateRows,2);
 assert.equal(result.imagesInZip,3);
 assert.equal(result.matchedImages,2);
 assert.equal(result.unmatchedImages,1);
 assert.deepEqual(result.valid.map(v=>v.notionImages?.length),[1,1]);
});
test('Matching uses explicit CSV file reference or associated Notion Markdown, not arbitrary row order',()=>{
 const [one,two]=files().valid;
 assert.match(one.notionImages[0].filename,/setup\.png$/);
 assert.match(two.notionImages[0].filename,/chart2\.png$/);
 assert.ok(one.notionImages[0].bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
 assert.ok(![...one.notionImages,...two.notionImages].some(x=>/orphan/.test(x.filename)));
 assert.equal(one.gain_pct,2);
 assert.equal(two.gain_pct,-1);
});
test('Same ZIP has stable trade keys and image assignments on repeated reads',()=>{
 const a=files(),b=files();
 assert.deepEqual(a.valid.map(x=>x.external_key),b.valid.map(x=>x.external_key));
 assert.deepEqual(a.valid.map(x=>x.notionImages.map(v=>v.filename)),b.valid.map(x=>x.notionImages.map(v=>v.filename)));
});
test('No images in an ordinary ZIP and ZIP without images still imports',()=>{
 const old=fs.readFileSync(path.join(__dirname,'fixtures/example-notion-export.zip'));
 const analysis=analyzeNotionExportZip(old,19,{riskPct:1});
 assert.equal(analysis.total,3);
 assert.equal(analysis.imagesInZip,0);
 assert.equal(analysis.matchedImages,0);
 assert.equal(analysis.unmatchedImages,0);
});
test('Journal and Backtest imports attach images in a transaction and avoid duplicate BLOBs',()=>{
 const code=read('src/main.js');
 assert.match(code,/function saveNotionAttachments\(kind,ownerId,entry\)/);
 assert.match(code,/trade_result_images/);
 assert.match(code,/backtest_result_images/);
 assert.match(code,/crypto\.createHash\('sha256'\)/);
 assert.match(code,/const added=saveNotionAttachments\('trade',tradeId,t\)/);
 assert.match(code,/const attached=saveNotionAttachments\('backtest',rowId,t\)/);
 assert.match(code,/imagesAdded,imagesDuplicates,unmatchedImages:Math.max\(0,unmatchedImages-manualCount\),backup/);
 assert.match(code,/imagesAdded,imagesDuplicates,unmatchedImages:Math.max\(0,unmatchedImages-manualCount\),backup,created,projectIds/);
 assert.match(code,/createAutoBackup\(true\)/);
});
test('Both dialogs close after successful import and show count of trades and screenshots',()=>{
 const a=read('src/notion-import-ui.js'),b=read('src/backtest-notion-ui.js');
 for(const [ui,id] of [[a,'notionImportModal'],[b,'notionBacktestModal']]){
   assert.match(ui,new RegExp(`shelldCloseModal\\?\\.\\('${id}'\\)`));
   assert.match(ui,/result\.imported/);
   assert.match(ui,/result\.imagesAdded/);
   assert.match(ui,/result\.unmatchedImages/);
   assert.match(ui,/shelldToast/);
   assert.match(ui,/8000/);
 }
 assert.match(read('src/renderer.js'),/window\.shelldCloseModal=closeSpecificModal/);
});

test('Ambiguous duplicate image basenames are not attached to the wrong trade',()=>{
 const trades=[{asset:'EUR',notionImages:undefined}];
 const media={images:[
  {filename:'A/shared.png',mime:'image/png',bytes:Buffer.from('one')},
  {filename:'B/shared.png',mime:'image/png',bytes:Buffer.from('two')}],markdown:[]};
 const linked=matchNotionImages(trades,[{Image:'shared.png',Number:'1'}],media);
 assert.equal(linked.imagesInZip,2);assert.equal(linked.matchedImages,0);
 assert.equal(linked.unmatchedImages,2);assert.equal(trades[0].notionImages,undefined);
});
