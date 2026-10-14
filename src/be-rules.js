/* Neutral outcome rules. Display-only classification preserves original P&L. */
const defaults = Object.freeze({enabled:false,unit:'percent',min:-0.2,max:0.2});
function parse(raw){
  let v=raw;
  if(typeof raw==='string'){try{v=JSON.parse(raw);}catch{v={};}}
  if(!v||typeof v!=='object')v={};
  const toNumber=x=>{const raw=String(x??'').trim().replace(',', '.');return raw===''?NaN:Number(raw);};
  const min=toNumber(v.min),max=toNumber(v.max);
  return {
    enabled:v.enabled===true,
    unit:v.unit==='money'?'money':'percent',
    min:Number.isFinite(min)?min:defaults.min,
    max:Number.isFinite(max)?max:defaults.max
  };
}
function validate(c){
  const rule=parse(c);
  if(!String(c?.min??'').trim()||!String(c?.max??'').trim()||!Number.isFinite(Number(String(c.min).trim().replace(',', '.')))||!Number.isFinite(Number(String(c.max).trim().replace(',', '.')))||rule.min>rule.max)throw new Error('Границы BE должны быть числами: от ≤ до');
  return rule;
}
function effectiveResult(row,settings){
  const result=String(row.result||'OPEN').toUpperCase();
  if(result==='BE'||result==='OPEN'||!['WIN','LOSS'].includes(result))return result;
  const rule=parse(settings);
  if(!rule.enabled)return result;
  let amount;
  if(rule.unit==='money'){
    // Cash-denominated BE is only available when a true cash result is known.
    if(row.profit_money===null||row.profit_money===undefined||row.profit_money==='')return result;
    amount=Number(row.profit_money);
  } else {
    if(row.percent_known===0||row.percent_known==='0')return result;
    amount=Number(row.gain_pct);
  }
  return Number.isFinite(amount)&&amount>=rule.min&&amount<=rule.max?'BE':result;
}
function resolvedRows(rows, settings){return rows.map(row=>({...row,result:effectiveResult(row,settings)}));}
function streaks(rows,settings){
  let win=0,loss=0,maxWin=0,maxLoss=0;
  const byClose=[...rows].filter(r=>['WIN','LOSS','BE'].includes(String(r.result).toUpperCase())).sort((a,b)=>new Date(a.closed_at||a.opened_at)-new Date(b.closed_at||b.opened_at)||Number(a.id||0)-Number(b.id||0));
  for(const row of byClose){
    const status=effectiveResult(row,settings);
    if(status==='BE')continue; // BE does not increase OR break the current streak.
    if(status==='WIN'){win++;loss=0;maxWin=Math.max(maxWin,win);}
    else if(status==='LOSS'){loss++;win=0;maxLoss=Math.max(maxLoss,loss);}
  }
  return {maxWin,maxLoss};
}
const api={defaults,parse,validate,effectiveResult,resolvedRows,streaks};
if(typeof module==='object'&&module.exports)module.exports=api;
if(typeof globalThis!=='undefined')globalThis.ShelldBE=api;
