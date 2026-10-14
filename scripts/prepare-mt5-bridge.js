'use strict';
// Build-time ONLY. A final end user never runs Python or npm.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
if(process.platform!=='win32'){
  console.error('The MT5 bridge must be built on Windows x64. Use the included GitHub Actions workflow.');
  process.exit(1);
}
const project=path.resolve(__dirname,'..');
function call(exe,args,{allowFailure=false}={}){
  const result=spawnSync(exe,args,{cwd:project,encoding:'utf8',maxBuffer:4*1024*1024,windowsHide:true,stdio:allowFailure?'pipe':'inherit'});
  if(result.error||result.status!==0){
    if(allowFailure)return null;
    console.error(result.error?.message||`Failed with exit code ${result.status}: ${exe}`);
    process.exit(1);
  }
  return result;
}
const candidates=[];
if(process.env.SHELLD_BUILD_PYTHON)candidates.push([process.env.SHELLD_BUILD_PYTHON,[]]);
candidates.push(['py',['-3.12']],['python',[]]);
let interpreter=null;
for(const [exe,prefix] of candidates){
  const trial=call(exe,[...prefix,'-c','import sys,struct; print(sys.version_info[:2],struct.calcsize("P")*8)'],{allowFailure:true});
  if(trial && /\(3, 12\) 64/.test(trial.stdout||'')){interpreter={exe,prefix};break;}
}
if(!interpreter){
  console.error('BUILD ERROR: The builder needs Python 3.12 x64. End users do not need Python. GitHub Actions installs it automatically.');
  process.exit(1);
}
const py=[...interpreter.prefix];
// Dependencies installed on the trusted build machine only.
call(interpreter.exe,[...py,'-m','pip','install','--disable-pip-version-check','--no-input','--prefer-binary',
  'pyinstaller>=6.12,<7','MetaTrader5==5.0.6231']);
const vendor=path.join(project,'vendor','mt5-bridge');
fs.mkdirSync(vendor,{recursive:true});
call(interpreter.exe,[...py,'-m','PyInstaller','--noconfirm','--clean','--onefile','--console',
  '--name','shelld-mt5-bridge','--distpath',vendor,
  '--workpath',path.join(project,'.build','pyinstaller'),
  '--specpath',path.join(project,'.build'),
  '--collect-all','MetaTrader5','--collect-all','numpy',
  path.join(project,'src','mt5_bridge.py')]);
const exe=path.join(vendor,'shelld-mt5-bridge.exe');
if(!fs.existsSync(exe)||fs.statSync(exe).size<100000){throw new Error('PyInstaller did not produce the MT5 bridge executable');}
// Confirm that the bundled executable can import MetaTrader5 without opening a terminal.
const probe=spawnSync(exe,['--self-test'],{
  encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:3*1024*1024});
let payload=null;
try{payload=JSON.parse((probe.stdout||'').trim().split(/\r?\n/).at(-1));}catch{}
if(probe.error||probe.status!==0||payload?.ok!==true||payload?.mode!=='self-test'){
  throw new Error(`Bundled MT5 module failed smoke test: ${(probe.stderr||probe.stdout||probe.error?.message||'').slice(0,700)}`);
}
console.log(`Bundled MT5 bridge verified: ${exe}`);
