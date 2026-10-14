/* Offline backup policy, shared with tests. No Electron dependencies. */
'use strict';
const MAX_SNAPSHOTS = Object.freeze([7,14,30]);
function retention(value){const n=Number(value);return MAX_SNAPSHOTS.includes(n)?n:14;}
function enabled(value){return value!=='0'&&value!==false;}
function dayStamp(date=new Date()){
  const n=x=>String(x).padStart(2,'0');
  return `${date.getFullYear()}-${n(date.getMonth()+1)}-${n(date.getDate())}`;
}
function autoFilename(date=new Date()){
  const n=x=>String(x).padStart(2,'0');
  return `auto-${dayStamp(date)}-${n(date.getHours())}${n(date.getMinutes())}${n(date.getSeconds())}-${String(date.getMilliseconds()).padStart(3,'0')}.sqlite`;
}
function isBackupName(name){return /^auto-\d{4}-\d{2}-\d{2}-\d{6}(?:-\d{3})?\.sqlite$/.test(name);}
function alreadyBackedUpToday(names,date=new Date()){
  const prefix=`auto-${dayStamp(date)}-`;
  return names.some(x=>isBackupName(x)&&x.startsWith(prefix));
}
function retentionPlan(names,keep=14){return names.filter(isBackupName).sort().reverse().slice(retention(keep));}
module.exports={retention,enabled,dayStamp,autoFilename,isBackupName,alreadyBackedUpToday,retentionPlan};
