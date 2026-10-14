const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=path.resolve(__dirname,'../src');
const load=name=>fs.readFileSync(path.join(src,name),'utf8');
const ui=load('renderer.js'), html=load('index.html'),main=load('main.js'),preload=load('preload.js'),css=load('ui-v069.css');

test('backtest offers an editable asset and explicitly validates custom names',()=>{
 assert.match(html,/id="btNewAssetSelect"/);
 assert.match(html,/value="CUSTOM"/);
 assert.match(html,/id="btNewAssetCustom"/);
 assert.match(ui,/project\.asset=name/);
 assert.match(ui,/\$\('#btNewAssetCustom'\)\.value\.trim\(\)\.toUpperCase\(\)/);
});

test('escape closes just the topmost modal; backdrop does not discard a trade',()=>{
 assert.match(ui,/const modalStack=\[\]/);
 assert.match(ui,/function closeTopModal\(/);
 assert.match(ui,/e\.key==='Escape'.*stopImmediatePropagation/);
 assert.match(ui,/\$\('#imageClose'\)\.addEventListener\('click',closeTopModal\)/);
 assert.doesNotMatch(ui,/if\(e\.target===m\)closeModals/);
 assert.match(load('mt5-ui.js'),/window\.openModal\('mt5Modal'\)/);
});

test('extra trade photos use a separate SQLite BLOB table and stay with backups',()=>{
 assert.match(main,/CREATE TABLE IF NOT EXISTS trade_extra_screenshots/);
 assert.match(main,/screenshots-extra:list/);
 assert.match(main,/screenshots-extra:add/);
 assert.match(main,/screenshots-extra:delete/);
 assert.match(main,/DELETE FROM trade_extra_screenshots WHERE trade_id=/);
 assert.match(preload,/listExtraScreenshots/);
 assert.match(preload,/addExtraScreenshot/);
 assert.match(ui,/listExtraScreenshots\(tradeId\)/);
 assert.match(ui,/renderScreenshots\(tradeId\)/);
 assert.match(ui,/addExtraScreenshot\(detailTradeId,tf\)/);
 assert.match(html,/id="tradeExtraScreenshotGrid"/);
});

test('journal shows newest trades first without reversing the equity curve',()=>{
 assert.match(html,/<option>200<\/option>/);
 assert.match(ui,/const orderedJournalTrades=\(\) =>/);
 assert.match(ui,/Date\.parse\(ac\?a\.closed_at:a\.opened_at\)/);
 assert.match(ui,/return orderedJournalTrades\(\)\.reverse\(\)\.filter/);
 assert.match(ui,/rowsHtml\(orderedJournalTrades\(\)\.slice\(-7\)\.reverse\(\)\)/);
 assert.match(ui,/const ordered=chrono\(closedTrades\(dealList\)\)/);
 assert.match(ui,/const tradeNumber = id => orderedJournalTrades\(\)\.findIndex/);
});

test('MT5 model is not written into the strategy field; R survives future sync',()=>{
 assert.match(main,/t\.opened_at,t\.closed_at,t\.symbol,t\.direction,'',t\.result/);
 assert.match(main,/existing\.model==='MT5'/);
 assert.match(main,/UPDATE trades SET model='' WHERE id=\?/);
 assert.match(main,/before\.source==='mt5'/);
 assert.match(main,/rChanged\?1:Number\(before\.r_known\)/);
 assert.match(main,/mt5_manual_fields/);
 assert.match(ui,/s\.winsWithKnownR\?\x60\$\{s\.avgWin/);
});

test('telegram export uses a minimalist transparent PNG and contains no samurai',()=>{
 assert.match(ui,/ctx\.clearRect\(0,0,width,height\)/);
 assert.match(ui,/roundedExportRect\(ctx,margin,margin/);
 assert.match(ui,/rgba\(8,10,15,\.96\)/);
 assert.match(ui,/canvas\.toDataURL\('image\/png'\)/);
 assert.doesNotMatch(ui,/ShelldExportArt|samurai/);
 assert.ok(!fs.existsSync(path.join(src,'assets/samurai-export.svg')));
 assert.doesNotMatch(html,/src="export-art.js"/);
});

test('backtest duration cell no longer has a different background',()=>{
 assert.match(css,/#backtestWorkspace \.backtest-table \.bt-holding-time/);
 assert.match(css,/background:transparent!important/);
});
