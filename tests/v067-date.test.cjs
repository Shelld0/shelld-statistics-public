const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/renderer.js'),'utf8');
const begin=source.indexOf('const pad2=n=>');
const end=source.indexOf('function renderBtCalendar(){',begin);
assert.ok(begin>0&&end>begin);
const context={Date,Number,String};
vm.runInNewContext(source.slice(begin,end),context);
const parse=s=>vm.runInNewContext('parsedTextDate('+JSON.stringify(s)+')',context);
const display=s=>vm.runInNewContext('dateDisplay('+JSON.stringify(s)+')',context);
test('Manual date input validates leap days',()=>{
 assert.equal(parse('31.02.2026'),null);
 assert.equal(parse('29.02.2024').day,29);
 assert.equal(parse('29.02.2026'),null);
 assert.equal(parse('10.10.2026').month,10);
});
test('Calendar formatting shows local HH:MM and blank placeholder',()=>{
 assert.equal(display('2026-10-12T09:35'),'12.10.2026  09:35');
 assert.equal(display(''),'Выбрать дату и время');
});
