const test=require('node:test');
const assert=require('node:assert/strict');
const {formatMinutes,holdingTime}=require('../src/duration.js');

test('duration rolls minutes into hours and days without ever showing 60m',()=>{
  assert.equal(formatMinutes(0),'0м');
  assert.equal(formatMinutes(1),'1м');
  assert.equal(formatMinutes(59),'59м');
  assert.equal(formatMinutes(60),'1ч');
  assert.equal(formatMinutes(61),'1ч 1м');
  assert.equal(formatMinutes(917),'15ч 17м');
  assert.equal(formatMinutes(1877),'1д 7ч 17м');
  assert.equal(formatMinutes(2879),'1д 23ч 59м');
  assert.equal(formatMinutes(2880),'2д');
});

test('journal and backtest share same duration for real timestamps',()=>{
  assert.equal(holdingTime('2026-10-08T22:46','2026-10-09T14:03'),'15ч 17м');
  assert.equal(holdingTime('2026-09-21T09:58','2026-09-22T12:52'),'1д 2ч 54м');
  assert.equal(holdingTime('2026-10-08T06:48','2026-10-09T14:05'),'1д 7ч 17м');
});

test('unclosed and invalid dates are not shown as fake durations',()=>{
  assert.equal(holdingTime('2026-10-08T22:46',null),'—');
  assert.equal(holdingTime(null,null),'—');
  assert.equal(holdingTime('2026-10-10T22:46','2026-10-09T22:46'),'Дата?');
  assert.equal(holdingTime('bad-date','2026-10-09T14:03'),'Дата?');
});

test('renderer uses the shared formatter for both journal and backtest',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const code=fs.readFileSync(path.join(__dirname,'../src/renderer.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
  assert.match(code,/journal-duration.*holdingTime\(t\.opened_at,t\.closed_at\)/);
  assert.match(code,/bt-holding-time.*holdingTime\(t\.opened_at,t\.closed_at\)/);
  assert.match(code,/window\.ShelldDuration\.holdingTime\(opened,closed\)/);
  assert.ok(html.indexOf('duration.js')<html.indexOf('renderer.js'));
});

test('backtest title and edit button have separated responsive layout',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'../src/ui-v069.css'),'utf8');
  assert.match(html,/class="bt-heading-stack"/);
  assert.match(css,/#backtestWorkspace \.bt-heading-stack/);
  assert.match(css,/#backtestWorkspace #backtestWorkspaceTitle/);
});
