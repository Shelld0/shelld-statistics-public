/* Pure data preparation for Export Studio. Nothing networked or account-sensitive is persisted in artwork. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ShelldExportCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const CLOSED=new Set(['WIN','LOSS','BE']);
  const configs=Object.freeze({
    telegram:{width:1080,height:1350,label:'Telegram Post'},
    square:{width:1080,height:1080,label:'Square'}
  });
  function finite(v){const s=String(v??'').replace(',','.');return s.trim()!==''&&Number.isFinite(Number(s));}
  function isKnown(row,type){
    const flag=type==='r'?'r_known':'percent_known';
    const field=type==='r'?'r_multiple':'gain_pct';
    return row[flag]!==0&&row[flag]!=='0'&&finite(row[field]);
  }
  function dateOf(row){const d=new Date(row.closed_at||row.opened_at||0);return Number.isNaN(+d)?0:+d;}
  function sortChrono(rows){return [...rows].sort((a,b)=>dateOf(a)-dateOf(b)||Number(a.id||0)-Number(b.id||0));}
  function filterPeriod(rows,period,now=new Date()){
    const current=new Date(now);
    if(!Number.isFinite(+current))return [];
    if(period==='all')return [...rows];
    let start, end=Infinity;
    if(['7','30','90'].includes(String(period))){start=+current-Number(period)*86400000;}
    else if(period==='month')start=+new Date(current.getFullYear(),current.getMonth(),1);
    else if(period==='previous_month'){
      start=+new Date(current.getFullYear(),current.getMonth()-1,1);
      end=+new Date(current.getFullYear(),current.getMonth(),1);
    }
    else if(period==='quarter')start=+new Date(current.getFullYear(),Math.floor(current.getMonth()/3)*3,1);
    else return [...rows];
    return rows.filter(t=>dateOf(t)>=start&&dateOf(t)<end);
  }
  function normalizeClosed(rows,effective){
    const interpret=typeof effective==='function'?effective:t=>t.result;
    return sortChrono(rows).map(t=>({...t,result:String(interpret(t)||t.result||'').toUpperCase()})).filter(t=>CLOSED.has(t.result));
  }
  function summarize(rows,effective){
    const closed=normalizeClosed(rows,effective);
    const known=closed.filter(t=>isKnown(t,'pct'));
    const win=closed.filter(t=>t.result==='WIN');
    const loss=closed.filter(t=>t.result==='LOSS');
    const winR=win.filter(t=>isKnown(t,'r'));
    let cumulative=0;
    const curve=[{index:0,total:0}];
    known.forEach((row,i)=>{cumulative+=Number(row.gain_pct);curve.push({index:i+1,total:cumulative});});
    return {
      closed:closed.length,wins:win.length,losses:loss.length,be:closed.length-win.length-loss.length,
      winRate:win.length+loss.length?100*win.length/(win.length+loss.length):null,
      gain:known.length?cumulative:null,knownProfit:known.length,missingProfit:closed.length-known.length,
      avgWinningR:winR.length?winR.reduce((a,t)=>a+Number(t.r_multiple),0)/winR.length:null,
      knownWinningR:winR.length,curve,
      assets:[...new Set(closed.map(t=>String(t.asset||'').toUpperCase()).filter(Boolean))].slice(0,5),
      firstClose:closed.length?closed[0].closed_at||closed[0].opened_at:'',
      lastClose:closed.length?closed[closed.length-1].closed_at||closed[closed.length-1].opened_at:''
    };
  }
  function getTrade(rows,id,effective){return normalizeClosed(rows,effective).find(t=>String(t.id)===String(id))||null;}
  function safeText(value,max=80){return String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
  function disclosure(options,account){
    return {
      account:options.showAccount?safeText(account?.label||'',45):'',
      assets:options.showAssets===true,
      dates:options.showDates===true
    };
  }
  function formatSigned(value,suffix='%',digits=1){
    if(value===null||value===undefined||!Number.isFinite(Number(value)))return '—';
    const n=Number(value);return `${n>0?'+':''}${n.toFixed(digits)}${suffix}`;
  }
  function buildCaption(summary,options,account){
    const title=safeText(options.title||'Результаты торговли',64);
    const handle=safeText(options.handle||'',44);
    const lines=[title,safeText(options.style||'Swing',24),`Закрытых сделок: ${summary.closed}`,
      `Результат: ${formatSigned(summary.gain)}`,
      `Win Rate: ${summary.winRate===null?'—':summary.winRate.toFixed(1)+'%'}`,
      `Average Winning Trade: ${formatSigned(summary.avgWinningR,'R',2)}`];
    if(options.asset&&options.asset!=='all')lines.push(`Актив: ${safeText(options.asset,32)}`);
    if(summary.missingProfit)lines.push(`Без подтверждённого %: ${summary.missingProfit}`);
    if(handle)lines.push(handle);
    return lines.filter(Boolean).join('\n');
  }
  function tradeCaption(trade,options){
    const lines=[safeText(options.title||'Разбор сделки',64),safeText(options.style||'Swing',24),
      `Актив: ${safeText(trade.asset||'—',30)}`,
      `Результат: ${formatSigned(isKnown(trade,'pct')?Number(trade.gain_pct):null)}`,
      `Статус: ${safeText(trade.result||'—',14)}`,
      `Направление: ${safeText(trade.direction||'—',14)}`];
    const handle=safeText(options.handle||'',44);if(handle)lines.push(handle);
    return lines.filter(Boolean).join('\n');
  }
  return {configs,finite,isKnown,dateOf,sortChrono,filterPeriod,normalizeClosed,summarize,getTrade,safeText,disclosure,formatSigned,buildCaption,tradeCaption};
});
