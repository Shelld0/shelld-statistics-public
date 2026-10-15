'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {analyzeNotionExportZip,assignNotionImages,pageProperties}=require('../src/notion-zip');
const bytes=fs.readFileSync(path.join(__dirname,'fixtures/notion-untitled-short-id.zip'));
const analyze=()=>analyzeNotionExportZip(bytes,99,{riskPct:1});
test('Untitled short-id pages resolve by page Number and sibling media folder, without ordering guesses',()=>{
 const result=analyze();
 assert.equal(result.total,3);
 assert.equal(result.imagesInZip,5);
 assert.equal(result.matchedImages,3);
 assert.equal(result.unmatchedImages,2);
 assert.deepEqual(result.valid.map(t=>t.notionImages?.length||0),[2,1,0]);
 assert.match(result.valid[0].notionImages[0].filename,/3b19-00de/);
 assert.match(result.valid[1].notionImages[0].filename,/3b19-00ef/);
 assert.ok(result.unmatchedFiles.some(x=>x.includes('3b19-00ff')));
 assert.equal(result.previewTrades[2].number,'3');
});
test('Manual mapping can assign orphan image to exact chosen source key without affecting other trades',()=>{
 const result=analyze();
 const path=result.unmatchedFiles.find(x=>x.includes('3b19-00ff'));
 assert.equal(assignNotionImages(result,[{filename:path,key:result.previewTrades[2].key}]),1);
 assert.equal(result.valid[2].notionImages.length,1);
 assert.ok(!result.valid[0].notionImages.some(x=>x.filename===path));
 assert.equal(assignNotionImages(result,[{filename:path,key:result.previewTrades[2].key}]),1);
 assert.equal(result.valid[2].notionImages.length,1);
});
test('Manual assignments validate owner and file paths, no row-order fallback',()=>{
 const result=analyze();
 assert.throws(()=>assignNotionImages(result,[{filename:'unknown.png',key:result.previewTrades[0].key}]),/привязка/);
 assert.throws(()=>assignNotionImages(result,[{filename:result.unmatchedFiles[0],key:'NOTION:unknown'}]),/привязка/);
 assert.throws(()=>assignNotionImages(result, [{filename:result.unmatchedFiles[0],key:result.previewTrades[0].key},{filename:result.unmatchedFiles[0],key:result.previewTrades[1].key}]),/привязка/);
});
test('Read Notion Markdown property variants and reject accidental duplicate-number links',()=>{
 for(const text of ['Number: 11','- **Number:** 11','| Number | 11 |','**Number**: 11'])assert.equal(pageProperties(text).number,'11');
 const result=analyze();
 const image=result.unmatchedFiles.find(x=>x.includes('Unknown'));
 assert.ok(image);
});
test('Same ZIP can be imported again without changing keys or auto attachment placement',()=>{
 const a=analyze(),b=analyze();
 assert.deepEqual(a.valid.map(x=>x.external_key),b.valid.map(x=>x.external_key));
 assert.deepEqual(a.valid.map(x=>x.notionImages?.map(y=>y.filename)),b.valid.map(x=>x.notionImages?.map(y=>y.filename)));
});
