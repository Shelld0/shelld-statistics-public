'use strict';
/** Decide which duplicated EMPTY profiles may be removed without touching history. */
const text=v=>String(v??'').trim().toLowerCase();
const hasData=a=>['trades_count','plans_count','weeks_count','backtests_count','studio_images_count','group_count'].some(k=>Number(a[k]||0)>0);
function emptyDuplicateIds(rows,activeId){
  const groups=new Map();
  for(const a of [...(rows||[])].sort((a,b)=>Number(a.id)-Number(b.id))){
    const id=Number(a.id);
    if(!Number.isSafeInteger(id)||id<1)continue;
    const key=[text(a.label),text(a.broker),text(a.currency)].join('\x1f');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(a);
  }
  const candidates=[];
  for(const same of groups.values()){
    if(same.length<2)continue;
    const safe=a=>!hasData(a)&&!String(a.mt5_login||'').trim()&&!String(a.mt5_server||'').trim()&&!a.archived_at;
    const anchor=same.find(a=>Number(a.id)===Number(activeId))||same.find(a=>!safe(a))||same[0];
    for(const a of same)if(a!==anchor&&safe(a)&&Number(a.id)!==Number(activeId))candidates.push(Number(a.id));
  }
  return candidates;
}
module.exports={emptyDuplicateIds};
