'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const {selectMt5Bridge}=require('../src/mt5-runtime');
const script='C:\\Program Files\\Shelld\\mt5_bridge.py';
const resources='C:\\Program Files\\Shelld\\resources';
test('Windows installer uses its bundled MT5 executable with no external Python needed',()=>{
  let checked=null;
  const selected=selectMt5Bridge({packaged:true,resourcesPath:resources,bridgeScript:script,python:'',existsSync:file=>{checked=file;return true;}});
  assert.equal(selected.mode,'bundled');
  assert.equal(selected.executable,checked);
  assert.match(checked,/shelld-mt5-bridge\.exe$/);
  assert.deepEqual(selected.args,[]);
  assert.deepEqual(selectMt5Bridge({packaged:true,resourcesPath:resources,bridgeScript:script,python:'py',existsSync:()=>true}),selected);
});
test('Packaged MT5 reports actionable error if its embedded bridge is missing',()=>{
  assert.throws(()=>selectMt5Bridge({packaged:true,resourcesPath:resources,bridgeScript:script,python:'',existsSync:()=>false}),/Переустанови Shelld Statistics/);
});
test('Explicit Python path still works for developers / compatibility',()=>{
  const p=selectMt5Bridge({packaged:true,resourcesPath:resources,bridgeScript:script,python:'C:\\Python312\\python.exe',existsSync:()=>false});
  assert.equal(p.mode,'external');
  assert.deepEqual(p.args,[script]);
});
test('Unpackaged development mode retains py launcher behavior',()=>{
  const p=selectMt5Bridge({packaged:false,resourcesPath:resources,bridgeScript:script,python:''});
  assert.equal(p.executable,'py');
  assert.deepEqual(p.args,['-3',script]);
});
test('Packaging includes bridge in resources and Windows CI invokes build',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.version,'1.0.1');
  assert.equal(pkg.build.extraResources[0].to,'mt5/shelld-mt5-bridge.exe');
  assert.match(pkg.scripts.dist,/prepare:bridge/);
  assert.match(fs.readFileSync(path.join(root,'src','main.js'),'utf8'),/selectMt5Bridge/);
  assert.match(fs.readFileSync(path.join(root,'src','mt5_bridge.py'),'utf8'),/--self-test/);
});
