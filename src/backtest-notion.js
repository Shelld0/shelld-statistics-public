/* Offline Notion ZIP / CSV -> isolated Shelld Statistics Backtest projects.
 * Does not touch live Trading Journal. No invented times or unknown P&L.
 */
'use strict';
const crypto=require('node:crypto');
const {parseCSV,positiveCapital}=require('./import-utils');
const {sourceTableId}=require('./notion-zip');
function safeYear(value){const n=Number(value);return Number.isInteger(n)&&n>=2000&&n<=2100?n:null;}
function tidyStyle(value){return /scalp/i.test(value)?'Scalping':/intra/i.test(value)?'Intraday':'Swing';}
function yearOf(row,fallbackYear){
 const v=String(row.opened_at||'');
 const matched=/^(\d{4})-\d{2}-\d{2}/.exec(v);
 return matched?safeYear(matched[1]):safeYear(fallbackYear);
}
function groupNotionBacktests(analysis,{fallbackYear,filename='Notion.zip'}={}){
 if(!analysis||!Array.isArray(analysis.valid))throw new Error('Нет данных для импорта');
 const groups=new Map();
 const tableNames=Array.isArray(analysis.files)&&analysis.files.length?analysis.files:[filename];
 const tableId=sourceTableId(tableNames[0]);
 for(const trade of analysis.valid){
   const year=yearOf(trade,fallbackYear);
   if(!year)throw new Error('Для сделок без даты укажи год бектеста');
   const asset=(trade.asset||'НЕ УКАЗАН').toUpperCase().slice(0,32);
   const style=tidyStyle(trade.trade_type);
   const key=[style,asset,year].join('|');
   if(!groups.has(key)){
     const signature=crypto.createHash('sha256').update(JSON.stringify([tableId,style,asset,year])).digest('hex');
     groups.set(key,{asset,style,year,title:`${style} · ${asset} · ${year}`,collectionKey:'NOTION-BT:'+signature,trades:[]});
   }
   const original=String(trade.notes||'');
   const rawSelect=/^Select:\s*(.*)$/mi.exec(original);
   const rawTags=/^Tags:\s*(.*)$/mi.exec(original);
   const tags=(rawSelect?.[1]||rawTags?.[1]||'').trim().slice(0,900);
   groups.get(key).trades.push({
     ...trade, tags,
     risk_pct:trade.risk_pct>0?trade.risk_pct:0,
     opened_at:trade.opened_at||'',closed_at:trade.closed_at||'',
     result:trade.result||'UNKNOWN',
     rr:trade.r_known?Number(trade.r_multiple):0,
     gain_pct:trade.percent_known?Number(trade.gain_pct):0,
     notes:original.slice(0,20000),source_key:trade.external_key
   });
 }
 return [...groups.values()].sort((a,b)=>a.year-b.year||a.asset.localeCompare(b.asset));
}
function analyzeRowsFromNotionFiles(analysis, options){
 return groupNotionBacktests(analysis,options);
}
module.exports={groupNotionBacktests,analyzeRowsFromNotionFiles,yearOf,tidyStyle};
