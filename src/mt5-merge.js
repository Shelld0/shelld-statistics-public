/* The server owns execution data; the trader owns journal annotations and edits.
 * These pure helpers let us test the conflict policy without Electron or SQLite. */
const MANUAL_MT5_FIELDS = ['opened_at','closed_at','asset','direction','result','gain_pct'];
function decodeLocks(raw) {
  try { const fields=JSON.parse(raw||'[]'); return new Set(Array.isArray(fields)?fields.filter(f=>MANUAL_MT5_FIELDS.includes(f)):[]); }
  catch {return new Set();}
}
function newLocks(before, edited) {
  const locks=decodeLocks(before.mt5_manual_fields);
  for(const field of MANUAL_MT5_FIELDS){
    if(String(before[field]??'')!==String(edited[field]??''))locks.add(field);
  }
  return [...locks].sort();
}
function mt5Patch(before, updates) {
  if(before.source!=='mt5') return {};
  const locks=decodeLocks(before.mt5_manual_fields);
  // OPEN means the brokerage position has not been fully reconciled yet.
  // A locally edited close timestamp must never pin a still-OPEN MT5 row forever.
  const wasLive=!before.closed_at || before.result==='OPEN';
  if(!wasLive)return {}; // completed historical position: user edits are authoritative
  const confirmedClose=Boolean(updates.closed_at) && updates.result!=='OPEN';
  const patch={};
  for(const [field,value] of Object.entries(updates)){
    const userLocked=MANUAL_MT5_FIELDS.includes(field)&&locks.has(field);
    // Closing is a broker fact, not a subjective journal annotation.
    // Honor a manually chosen WIN/LOSS/BE, but do not preserve stale OPEN.
    const brokerCloseField=confirmedClose && (
      (field==='closed_at' && !before.closed_at) ||
      (field==='result' && before.result==='OPEN')
    );
    if(userLocked&&!brokerCloseField)continue;
    if(String(before[field]??'')!==String(value??''))patch[field]=value;
  }
  return patch;
}
module.exports={MANUAL_MT5_FIELDS, decodeLocks,newLocks,mt5Patch};
