const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const { newLocks, mt5Patch,decodeLocks }=require('../src/mt5-merge');
const BE=require('../src/be-rules');
const {compute}=require('../src/stats');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('MT5 manual BE is protected from the next 60s synchronization',()=>{
 const old={source:'mt5',result:'LOSS',gain_pct:-0.2,closed_at:'2026-10-01T18:00',
   opened_at:'2026-10-01T12:00',mt5_manual_fields:'[]'};
 const edited={...old,result:'BE'};
 const locks=newLocks(old,edited);
 assert.deepEqual(locks,['result']);
 const existing={...edited,mt5_manual_fields:JSON.stringify(locks)};
 const patch=mt5Patch(existing,{result:'LOSS',gain_pct:-0.2,closed_at:'2026-10-01T18:00'});
 assert.deepEqual(patch,{});
});

test('open MT5 positions still update floating P&L and transition to closed',()=>{
 const old={source:'mt5',opened_at:'2026-10-01T10:00',closed_at:null,result:'OPEN',gain_pct:-0.1,
  profit_money:-10,mt5_manual_fields:'[]'};
 const patch=mt5Patch(old,{result:'OPEN',gain_pct:-0.3,profit_money:-30,closed_at:null});
 assert.equal(patch.gain_pct,-0.3);
 assert.equal(patch.profit_money,-30);
 const complete=mt5Patch(old,{result:'WIN',gain_pct:1.2,closed_at:'2026-10-02T10:00'});
 assert.equal(complete.result,'WIN');
 assert.equal(complete.closed_at,'2026-10-02T10:00');
});

test('a manually modified OPEN MT5 gain is protected while close timestamp can still sync',()=>{
 const old={source:'mt5',closed_at:null,result:'OPEN',gain_pct:0,mt5_manual_fields:'[]'};
 const locked={...old,gain_pct:-0.2,mt5_manual_fields:JSON.stringify(newLocks(old,{...old,gain_pct:-0.2}))};
 assert.deepEqual([...decodeLocks(locked.mt5_manual_fields)],['gain_pct']);
 const patch=mt5Patch(locked,{gain_pct:0.8,result:'WIN',closed_at:'2026-10-02T10:00'});
 assert.equal(patch.gain_pct,undefined);
 assert.equal(patch.result,'WIN');
 assert.equal(patch.closed_at,'2026-10-02T10:00');
});

test('BE between bounds excludes that trade from win rate and does not interrupt streak',()=>{
 const cfg={enabled:true,unit:'percent',min:-0.2,max:0.2};
 const rows=[
  {id:1,opened_at:'2026-01-01',closed_at:'2026-01-01',result:'WIN',gain_pct:2,r_multiple:2},
  {id:2,opened_at:'2026-01-02',closed_at:'2026-01-02',result:'LOSS',gain_pct:-0.1,r_multiple:-0.1},
  {id:3,opened_at:'2026-01-03',closed_at:'2026-01-03',result:'WIN',gain_pct:1,r_multiple:1},
  {id:4,opened_at:'2026-01-04',closed_at:'2026-01-04',result:'LOSS',gain_pct:-1,r_multiple:-1}
 ];
 const s=compute(rows,'r_multiple',cfg);
 assert.equal(s.beCount,1);
 assert.equal(s.winCount,2);
 assert.equal(s.lossCount,1);
 assert.equal(s.maxWin,2);
 assert.equal(s.maxLoss,1);
 assert.equal(s.totalGain,1.9);
 assert.ok(Math.abs(s.winRate-66.6666667)<0.0001);
});

test('cash BE range only applies when a real monetary result is known',()=>{
 const cfg={enabled:true,unit:'money',min:-5,max:5};
 assert.equal(BE.effectiveResult({result:'LOSS',gain_pct:-1,profit_money:-2},cfg),'BE');
 assert.equal(BE.effectiveResult({result:'LOSS',gain_pct:-1,profit_money:null},cfg),'LOSS');
 assert.equal(BE.effectiveResult({result:'BE',gain_pct:-2},{}),'BE');
 assert.throws(()=>BE.validate({min:2,max:-2,enabled:true}));
});

test('migration keeps old screenshot BLOBs and adds timeframe to unlimited images',()=>{
 const main=read('src/main.js');
 assert.match(main,/PRAGMA table_info\(trade_extra_screenshots\)/);
 assert.match(main,/ALTER TABLE trade_extra_screenshots ADD COLUMN timeframe/);
 assert.match(main,/trade_extra_screenshots SET timeframe=/);
 assert.match(main,/INSERT INTO trade_extra_screenshots\(trade_id,timeframe,mime,image\)/);
 assert.match(main,/screenshots:move/);
 assert.match(main,/backtest-images:move/);
});

test('front-end renders arbitrary timeframe controls without hard-coded 1W/1D/4H slots',()=>{
 const renderer=read('src/renderer.js'),html=read('src/index.html');
 assert.match(renderer,/function timeframeOptions/);
 assert.match(renderer,/function screenshotCard/);
 assert.match(renderer,/function renderBacktestImages/);
 assert.match(renderer,/addBacktestImage\(selectedBacktestRowId,tf\)/);
 assert.match(renderer,/addExtraScreenshot\(detailTradeId,tf\)/);
 assert.match(html,/id="screenshotTfModal"/);
 assert.match(html,/id="beSettingsModal"/);
});
