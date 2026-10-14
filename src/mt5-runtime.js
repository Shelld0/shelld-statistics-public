'use strict';
// Pure launch selection. No credentials are stored here or exposed as command-line args.
const fs=require('node:fs');
const path=require('node:path');
function selectMt5Bridge({packaged,resourcesPath,bridgeScript,python,existsSync=fs.existsSync}){
  const configured=String(python||'').trim();
  const wantsBundled=!configured || /^(py|bundled|встроенный)$/i.test(configured);
  if(packaged && wantsBundled){
    const executable=path.join(resourcesPath,'mt5','shelld-mt5-bridge.exe');
    if(!existsSync(executable))throw new Error('Не найден встроенный модуль MT5. Установщик может быть повреждён. Переустанови Shelld Statistics из официального релиза.');
    return {executable,args:[],mode:'bundled'};
  }
  const executable=configured||'py';
  const args=executable.toLowerCase()==='py'?['-3',bridgeScript]:[bridgeScript];
  return {executable,args,mode:'external'};
}
module.exports={selectMt5Bridge};
