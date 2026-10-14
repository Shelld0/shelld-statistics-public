/* Shared performance calculations for Trading Journal and Backtests.
 * P&L is additive percentage points, not compounded returns. OPEN rows are
 * un-realized; BE rows count as closed trades but not W/L decisions.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ShelldStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const value = n => Number.isFinite(Number(n)) ? Number(n) : 0;
  const BE = (typeof globalThis!=='undefined'&&globalThis.ShelldBE) || (typeof require==='function'?require('./be-rules'):null);
  const isClosed = t => ['WIN','LOSS','BE'].includes(String(t.result).toUpperCase());
  function compute(rows, riskField='r_multiple', settings) {
    const all = BE?.resolvedRows(Array.isArray(rows)?rows:[],settings) || (Array.isArray(rows)?rows:[]);
    const closed = all.filter(isClosed);
    const wins = closed.filter(t => t.result==='WIN');
    const losses = closed.filter(t => t.result==='LOSS');
    const breakEven = closed.filter(t => t.result==='BE');
    const sum = (items,field) => items.reduce((acc,t)=>acc+value(t[field]),0);
    const priced=closed.filter(t=>t.percent_known!==0&&t.percent_known!=='0');
    const withR=closed.filter(t=>t.r_known!==0&&t.r_known!=='0');
    const winsWithR=wins.filter(t=>t.r_known!==0&&t.r_known!=='0');
    const totalGain = sum(priced,'gain_pct');
    const totalR = sum(withR,riskField);
    const decisionCount = wins.length+losses.length;
    const averageR = withR.length ? totalR/withR.length : 0;
    const averageWinR = winsWithR.length ? sum(winsWithR,riskField)/winsWithR.length : 0;
    const winRate = decisionCount ? 100*wins.length/decisionCount : 0;
    const grossProfit=priced.reduce((s,t)=>s+Math.max(0,value(t.gain_pct)),0);
    const grossLoss=priced.reduce((s,t)=>s+Math.abs(Math.min(0,value(t.gain_pct))),0);
    const profitFactor=grossLoss ? grossProfit/grossLoss : (grossProfit ? Infinity : 0);
    const conflicting=closed.filter(t => (t.percent_known!==0&&t.percent_known!=='0'&&t.r_known!==0&&t.r_known!=='0') && (
      (t.result==='WIN' && (value(t[riskField])<=0 || value(t.gain_pct)<=0)) ||
      (t.result==='LOSS' && (value(t[riskField])>=0 || value(t.gain_pct)>=0)) ||
      (t.result==='BE' && !BE?.parse(settings).enabled && (value(t[riskField])!==0 || value(t.gain_pct)!==0))
    ));
    const runs=BE?BE.streaks(Array.isArray(rows)?rows:[],settings):{maxWin:0,maxLoss:0};
    return {
      ...runs,rows:all, closed, wins, losses, breakEven,
      tradeCount:all.length, closedCount:closed.length, openCount:all.length-closed.length,
      pricedCount:priced.length, unpricedCount:closed.length-priced.length,
      rKnownCount:withR.length, winsWithKnownR:winsWithR.length,
      winCount:wins.length, lossCount:losses.length, beCount:breakEven.length,
      decisionCount, totalGain, totalR, averageR, averageWinR, winRate,
      grossProfit, grossLoss, profitFactor, conflicting
    };
  }
  return { compute, isClosed };
});
