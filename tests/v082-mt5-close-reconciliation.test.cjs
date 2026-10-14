'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {mt5Patch,newLocks}=require('../src/mt5-merge');

test('an MT5 stop-loss closes an OPEN row and updates its realized loss',()=>{
 const before={source:'mt5',closed_at:null,result:'OPEN',gain_pct:0.7,profit_money:70,
   percent_known:1,mt5_manual_fields:'[]'};
 const patch=mt5Patch(before,{closed_at:'2026-10-14T13:10',result:'LOSS',gain_pct:-0.6,
   profit_money:-60,percent_known:1});
 assert.deepEqual(patch,{closed_at:'2026-10-14T13:10',result:'LOSS',gain_pct:-0.6,profit_money:-60});
});

test('even a manually-locked stale OPEN result must become broker-confirmed LOSS',()=>{
 const before={source:'mt5',result:'OPEN',closed_at:null,gain_pct:0.7,
   mt5_manual_fields:JSON.stringify(['result','gain_pct'])};
 const patch=mt5Patch(before,{closed_at:'2026-10-14T15:06',result:'LOSS',gain_pct:-1.2});
 assert.equal(patch.result,'LOSS');
 assert.equal(patch.closed_at,'2026-10-14T15:06');
 assert.equal(patch.gain_pct,undefined); // manually changed percent remains protected
});

test('manually selected BE survives the closing tick of the position',()=>{
 const before={source:'mt5',result:'BE',closed_at:null,gain_pct:-0.2,
   mt5_manual_fields:'["result"]'};
 const patch=mt5Patch(before,{closed_at:'2026-10-14T15:06',result:'LOSS',gain_pct:-0.7});
 assert.equal(patch.closed_at,'2026-10-14T15:06');
 assert.equal(patch.result,undefined);
 assert.equal(patch.gain_pct,-0.7);
});

test('an OPEN marker is reconciled even if someone manually entered a close timestamp',()=>{
 const before={source:'mt5',result:'OPEN',closed_at:'2026-10-14T15:01',mt5_manual_fields:'[]'};
 const patch=mt5Patch(before,{closed_at:'2026-10-14T15:06',result:'LOSS'});
 assert.equal(patch.closed_at,'2026-10-14T15:06');
 assert.equal(patch.result,'LOSS');
});

test('completed historical MT5 entries and user BE remain unchanged',()=>{
 const before={source:'mt5',result:'BE',closed_at:'2026-10-14T15:06',gain_pct:-0.4,
   mt5_manual_fields:'["result"]'};
 assert.deepEqual(mt5Patch(before,{result:'LOSS',gain_pct:-0.8,closed_at:'2026-10-14T15:06'}),{});
});

test('bridge receives tracked OPEN position IDs from the active account',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
 assert.match(main,/tracked_positions:pending\.map/);
 assert.match(main,/WHERE account_id=\? AND source='mt5' AND \(closed_at IS NULL OR result='OPEN'\)/);
 assert.match(main,/rechecked_positions:data\.rechecked_positions/);
});
