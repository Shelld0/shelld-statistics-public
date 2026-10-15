/* Portable CSV and MT5 capital helpers. No third-party services, no credentials. */
'use strict';
const crypto=require('node:crypto');
function positiveCapital(value,{allowZero=true}={}){
  const text=String(value??'').trim().replace(/\s+/g,'').replace(/\u00a0/g,'').replace(',','.');
  if(!text){if(allowZero)return 0;throw new Error('Укажи базу капитала для MT5');}
  if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))throw new Error('Капитал: введи положительное число, например 10000 или 10000,50');
  const v=Number(text);
  if(!Number.isFinite(v)||v>1e12||v<0||(!allowZero&&v===0))throw new Error('Капитал должен быть больше нуля');
  return v;
}
function parseCSV(text){
  const source=String(text||'').replace(/^\uFEFF/,'');
  if(!source.trim())throw new Error('CSV пустой');
  let delimiter=',';
  const first=(source.split(/\r?\n/,1)[0]||'');
  const counts=[',',';','\t'].map(sep=>({sep,count:first.split(sep).length-1})).sort((a,b)=>b.count-a.count);
  if(counts[0].count>0)delimiter=counts[0].sep;
  const rows=[];let cells=[],field='',quoted=false;
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quoted){if(c==='"'&&source[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;continue;}
    if(c==='"'&&!field){quoted=true;continue;}
    if(c===delimiter){cells.push(field);field='';continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&source[i+1]==='\n')i++;cells.push(field);field='';if(cells.some(x=>x.trim()))rows.push(cells);cells=[];if(rows.length>50001)throw new Error('Для одного импорта поддерживается до 50 000 строк');continue;}
    field+=c;
  }
  if(quoted)throw new Error('В CSV не закрыта кавычка');
  cells.push(field);if(cells.some(x=>x.trim()))rows.push(cells);
  const columns=(rows.shift()||[]).map(x=>x.trim());
  if(!columns.length)throw new Error('Нет заголовков CSV');
  return {columns,rows:rows.map(c=>Object.fromEntries(columns.map((name,i)=>[name,String(c[i]??'').trim()])))};
}
const simplify=s=>String(s??'').trim().toLowerCase().replace(/[^a-zа-яё0-9%]+/gi,'');
function value(row,aliases){
  const keys=Object.keys(row);
  for(const name of aliases){const match=keys.find(key=>simplify(key)===simplify(name));if(match)return row[match];}
  return '';
}
function signedNumber(raw){
  let s=String(raw??'').trim().replace(/\u2212/g,'-').replace(/\s|\u00a0|%|€|\$|£/g,'');
  if(!s||s==='—'||s==='–'||s==='-')return null;
  if(s.includes(',')&&s.includes('.')){
    s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
  }else s=s.replace(',','.');
  const n=Number(s);return Number.isFinite(n)?n:null;
}
function parseDate(raw){
  // Missing or unparseable dates stay UNKNOWN: never fabricate a timestamp.
  const s=String(raw||'').trim();if(!s||s==='—'||s==='–')return '';
  const valid=(year,month,day,hour=0,minute=0)=>{
    const y=Number(year),m=Number(month),d=Number(day),h=Number(hour),n=Number(minute);
    const check=new Date(Date.UTC(y,m-1,d,h,n));
    if(y<1970||y>2100||check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d||h>23||n>59)return '';
    const pad=x=>String(x).padStart(2,'0');
    return `${y}-${pad(m)}-${pad(d)} ${pad(h)}:${pad(n)}`;
  };
  const iso=/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if(iso)return valid(iso[1],iso[2],iso[3],iso[4]||0,iso[5]||0);
  const eu=/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s*,?\s*(\d{1,2}):(\d{2}))?/.exec(s);
  if(eu)return valid(eu[3],eu[2],eu[1],eu[4]||0,eu[5]||0);
  const us=/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if(us)return valid(us[3],us[1],us[2],us[4]||0,us[5]||0);
  // Notion English-language exports commonly use 'Sep 17, 2026 7:56 PM'.
  const english=/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i.exec(s);
  if(english){
    const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(english[1].slice(0,3).toLowerCase())+1;
    let hour=Number(english[4]||0);const suffix=String(english[6]||'').toUpperCase();
    if(suffix==='PM'&&hour<12)hour+=12;if(suffix==='AM'&&hour===12)hour=0;
    return valid(english[3],month,english[2],hour,english[5]||0);
  }
  // Notion's default English dates often put the day before the month:
  // e.g. '2 January 2026' from a database Date property.
  const dayFirst=/^(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?$/i.exec(s);
  if(dayFirst){
    const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(dayFirst[2].slice(0,3).toLowerCase())+1;
    let hour=Number(dayFirst[4]||0);const suffix=String(dayFirst[6]||'').toUpperCase();
    if(suffix==='PM'&&hour<12)hour+=12;if(suffix==='AM'&&hour===12)hour=0;
    const parsed=valid(dayFirst[3],month,dayFirst[1],hour,dayFirst[5]||0);
    // Day-only entries must remain day-only, without invented 00:00.
    return parsed&&dayFirst[4]?parsed:parsed.slice(0,10);
  }
  return '';
}
function normalizedRow(row,{riskPct=null}={}){ 
  const combinedDate=value(row,['Start - End Date','Start-End Date','Дата','Date','Открытие','Opened','Open Date','Start Date','Entry Date']);
  const parts=combinedDate.split(/\s*(?:→|->| — | – )\s*/);
  const opened=parseDate(parts[0]);
  const closeRaw=value(row,['Close Date','Closed','Закрытие','End Date','Exit Date']);
  const closed=parseDate(closeRaw||parts[1]||'');
  const assetRaw=value(row,['Pair','Ticker','Symbol','Asset','Instrument','Инструмент','Актив','Валютная пара']);
  const asset=(String(assetRaw).match(/(?:[A-Z]{3,6}[/._-]?[A-Z]{3,6}|XAUUSD|GER40|NAS100|US100|DE40|XAGUSD|BTCUSD|ETHUSD)/i)||[])[0]||String(assetRaw).replace(/^[^a-zа-я0-9]+/gi,'').trim().slice(0,48);
  const dirText=value(row,['Direction','Direct','Side','Направление']);
  const direction=/short|sell|продаж|шорт/i.test(dirText)?'SHORT':/long|buy|покуп|лонг/i.test(dirText)?'LONG':'UNKNOWN';
  const statusRaw=value(row,['Result','Status','Outcome','Результат']);
  const gain=signedNumber(value(row,['Profit','Profit (%)','Gain (%)','Gain','P&L (%)','PnL %','Return','Доходность','Результат (%)']));
  const rr=signedNumber(value(row,['RR','Realized RR','Result R','R Multiple','R','РР','Результат (R)']));
  // Treat an unrecognized result as unknown, never assume a past trade is still open.
  const raw=String(statusRaw||'').trim();
  const result=/\b(?:loss|lose|losing|stop|sl)\b|убыт|стоп/i.test(raw)?'LOSS':
    /\b(?:win|winning|take|tp|profit|target)\b|прибыл|тейк/i.test(raw)?'WIN':
    /^(?:be|breakeven|break[ -]?even|бу|neutral)$/i.test(raw)?'BE':
    /\b(?:open|progress|running|pending)\b|открыт|в работе/i.test(raw)?'OPEN':'UNKNOWN';
  const risk=signedNumber(value(row,['Risk','Risk (%)','Risk %','Риск','Риск (%)']));
  const configuredRisk=riskPct===null||riskPct===undefined||riskPct===''?null:signedNumber(riskPct);
  if(configuredRisk!==null&&(!Number.isFinite(configuredRisk)||configuredRisk<=0||configuredRisk>100))
    throw new Error('Укажи риск на сделку от 0 до 100%');
  const effectiveRisk=risk!==null&&risk>0?risk:configuredRisk;
  const calculatedGain=gain===null&&rr!==null&&effectiveRisk!==null?Number((rr*effectiveRisk).toFixed(8)):null;
  const finalGain=gain??calculatedGain;
  const model=value(row,['Model','Strategy','Setup','Модель']);
  const note=value(row,['Notes','Comment','Comments','Description','Заметки','Комментарий']);
  const tags=value(row,['Tags','Теги','Select']);
  const tradeType=value(row,['Type','Style','Тип торговли']);
  const missing=[];
  if(!opened)missing.push('Дата открытия');
  if(!closed)missing.push('Дата закрытия');
  if(!asset)missing.push('Актив');
  if(direction==='UNKNOWN')missing.push('Направление');
  if(result==='UNKNOWN')missing.push('Статус');
  if(finalGain===null)missing.push('Проценты');
  if(opened&&/^\d{4}-\d{2}-\d{2}$/.test(opened))missing.push('Время открытия');
  if(rr===null)missing.push('R');
  // The full row is saved for traceability, including unrecognized Notion columns.
  const original=Object.entries(row).filter(([key,v])=>String(v??'').trim()).map(([key,v])=>`${key}: ${String(v).trim()}`).join('\n');
  const notes=[note,tags?`Теги Notion: ${tags}`:'',calculatedGain!==null?`Процент рассчитан при импорте: ${rr}R × ${effectiveRisk}% риска = ${calculatedGain}%`:'',missing.length?`Не заполнено после импорта: ${missing.join(', ')}`:'',original?`Исходная запись Notion CSV:\n${original}`:''].filter(Boolean).join('\n\n').slice(0,20000);
  return {opened_at:opened,closed_at:closed||null,asset:String(asset).toUpperCase(),direction,model:String(model).slice(0,200),result,
    gain_pct:finalGain??0,percent_known:finalGain===null?0:1,r_multiple:rr??0,r_known:rr===null?0:1,
    risk_pct:effectiveRisk,trade_type:/intra/i.test(tradeType)?'Intraday':'Swing',notes,missing};
}
function analyzeNotionCSV(text,accountId,options={}){
 const csv=parseCSV(text);
 const valid=[],invalid=[];
 csv.rows.forEach((row,i)=>{
   // parseCSV already removes empty lines. Every nonempty row is recoverable.
   const data=normalizedRow(row,options);
   const fingerprint=crypto.createHash('sha256').update(JSON.stringify({row,accountId,index:i})).digest('hex');
   valid.push({...data,external_key:'NOTION:'+accountId+':'+fingerprint});
 });
 return {columns:csv.columns,valid,invalid,total:csv.rows.length,incomplete:valid.filter(r=>r.missing.length).length};
}
module.exports={positiveCapital,parseCSV,signedNumber,parseDate,normalizedRow,analyzeNotionCSV};
