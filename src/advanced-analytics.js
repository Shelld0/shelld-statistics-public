/* Advanced performance analytics. Additive percentage points, closed positions only.
 * Imported trades without known R or % are excluded from those metrics, never treated as zeros. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  root.ShelldAnalytics=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const val=x=>Number.isFinite(Number(x))?Number(x):0;
 const known=(row,field)=>row[field]!==0&&row[field]!=='0';
 const isClosed=t=>['WIN','LOSS','BE'].includes(t.result);
 const keyDate=t=>String(t.closed_at||t.opened_at||'').slice(0,10);
 const summaries=(rows,key)=>{
   const groups=new Map();
   for(const t of rows){
     const k=key(t);if(!k)continue;
     const group=groups.get(k)||{name:k,trades:0,wins:0,losses:0,be:0,profit:0,knownProfit:0,rSum:0,knownR:0};
     group.trades++;
     if(t.result==='WIN')group.wins++;else if(t.result==='LOSS')group.losses++;else if(t.result==='BE')group.be++;
     if(known(t,'percent_known')){group.profit+=val(t.gain_pct);group.knownProfit++;}
     if(known(t,'r_known')){group.rSum+=val(t.r_multiple);group.knownR++;}
     groups.set(k,group);
   }
   return [...groups.values()].map(g=>({...g,winRate:g.wins+g.losses?100*g.wins/(g.wins+g.losses):0,avgR:g.knownR?g.rSum/g.knownR:null}));
 };
 function calculate(rows,opts={}){
   const rules=opts.rules||{};
   const effective=opts.effectiveResult||((t)=>t.result);
   const all=(Array.isArray(rows)?rows:[]).map(t=>({...t,result:effective(t,rules)}));
   const closed=all.filter(isClosed).sort((a,b)=>String(a.closed_at||a.opened_at).localeCompare(String(b.closed_at||b.opened_at))||Number(a.id)-Number(b.id));
   const priced=closed.filter(t=>known(t,'percent_known'));
   const valuedR=closed.filter(t=>known(t,'r_known'));
   const wins=closed.filter(t=>t.result==='WIN');
   const losses=closed.filter(t=>t.result==='LOSS');
   let grossProfit=0,grossLoss=0,sumGain=0,peak=0,cumulative=0,drawdown=0;
   const curve=[{trade:0,profit:0}];
   priced.forEach((t,i)=>{
     const p=val(t.gain_pct);sumGain+=p;cumulative+=p;
     grossProfit+=Math.max(0,p);grossLoss+=Math.max(0,-p);
     peak=Math.max(peak,cumulative);drawdown=Math.max(drawdown,peak-cumulative);
     curve.push({trade:i+1,profit:Number(cumulative.toFixed(8)),id:t.id});
   });
   const avgWin=wins.filter(t=>known(t,'r_known'));
   const months=summaries(closed,t=>keyDate(t).slice(0,7));
   const assets=summaries(closed,t=>String(t.asset||'').toUpperCase());
   const models=summaries(closed,t=>String(t.model||'Без модели').trim()||'Без модели');
   const weekdays=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
   const weekday=summaries(closed,t=>{const d=new Date(keyDate(t)+'T12:00:00');return Number.isNaN(+d)?'':weekdays[d.getDay()];});
   const totalR=valuedR.reduce((sum,t)=>sum+val(t.r_multiple),0);
   return {
     allCount:all.length,closedCount:closed.length,openCount:all.length-closed.length,
     pricedCount:priced.length,unpricedCount:closed.length-priced.length,knownRCount:valuedR.length,
     wins:wins.length,losses:losses.length,be:closed.filter(t=>t.result==='BE').length,
     winRate:wins.length+losses.length?100*wins.length/(wins.length+losses.length):0,
     totalGain:sumGain,totalR,avgWinningR:avgWin.length?avgWin.reduce((a,t)=>a+val(t.r_multiple),0)/avgWin.length:null,
     expectancyR:valuedR.length?totalR/valuedR.length:null,
     avgLossR:losses.filter(t=>known(t,'r_known')).length?
       losses.filter(t=>known(t,'r_known')).reduce((a,t)=>a+val(t.r_multiple),0)/losses.filter(t=>known(t,'r_known')).length:null,
     profitFactor:grossLoss>0?grossProfit/grossLoss:grossProfit>0?Infinity:null,
     grossProfit,grossLoss,maxDrawdown:drawdown,curve,months,assets,models,weekday
   };
 }
 return {calculate,summaries};
});
