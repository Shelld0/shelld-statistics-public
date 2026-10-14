'use strict';
/**
 * Percentage shown for both closed and live MT5 positions, relative to an
 * explicitly provided account capital baseline in the SAME currency as P&L.
 * Returns null if there is no trustworthy baseline: do not invent 0%.
 */
function percentFromCapital(profitMoney, capitalBasis) {
  const profit = Number(profitMoney);
  const capital = Number(capitalBasis);
  if (profitMoney === null || profitMoney === undefined || profitMoney === '' ||
      capitalBasis === null || capitalBasis === undefined || capitalBasis === '' ||
      !Number.isFinite(profit) || !Number.isFinite(capital) || capital <= 0) return null;
  return Number((profit / capital * 100).toFixed(8));
}
module.exports = { percentFromCapital };
