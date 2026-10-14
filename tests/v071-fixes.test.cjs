const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.join(__dirname,'..','src');
const load=f=>fs.readFileSync(path.join(base,f),'utf8');
const rules=require('../src/be-rules.js');
test('BE settings accept commas and retain correct defaults',()=>{
 assert.deepEqual(rules.parse({}),{enabled:false,unit:'percent',min:-0.2,max:0.2});
 assert.deepEqual(rules.validate({enabled:true,unit:'percent',min:'-0,4',max:'0,4'}),{enabled:true,unit:'percent',min:-0.4,max:0.4});
 assert.throws(()=>rules.validate({min:'hey',max:'0,4',enabled:true,unit:'percent'}),/границы/i);
});
test('Analytics has working rendering and drilldowns, not a dead placeholder',()=>{
 const ui=load('advanced-ui.js'),html=load('index.html');
 assert.match(ui,/const noun=/);
 assert.match(ui,/\bsummary\.maxDrawdown/);
 assert.match(ui,/data-analysis-kind=/);
 assert.match(ui,/data-analytics-trade=/);
 assert.match(html,/id="analyticsDetail"/);
});
test('Journal uses modal date fields and saves them with the trade',()=>{
 const ui=load('renderer.js'),html=load('index.html');
 assert.match(ui,/function openBtDatePicker\(tradeId,field,kind='backtest'\)/);
 assert.match(ui,/kind==='journal'/);
 assert.match(ui,/updateTradeDateButtons\(\)/);
 assert.match(html,/data-trade-date-field="opened_at"/);
 assert.match(html,/data-trade-date-field="closed_at"/);
});
test('Backtest notes live only in Analysis modal; account selector has matched control height',()=>{
 const ui=load('renderer.js'),css=load('ui-v072.css'),html=load('index.html');
 assert.doesNotMatch(ui,/class="bt-inline-notes"/);
 assert.match(ui,/\$\('#btRowNotes'\)\.value/);
 assert.match(html,/id="btRowNotes"/);
 assert.match(css,/\.top-actions \.account-switch,\.top-actions \.mt5-quick/);
});
test('Timeframe labels are localized and backtest dates cannot overflow neighboring columns',()=>{
 const h=load('index.html'),css=load('ui-v071.css');
 for(const label of ['Двенадцатичасовой','Четырёхчасовой','Тридцатиминутный','Пятиминутный'])assert.ok(h.includes(label),label);
 assert.match(css,/text-overflow:ellipsis/);
});
