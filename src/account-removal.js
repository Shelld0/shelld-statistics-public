'use strict';
/**
 * Deletes only descendants of the specified account. Order matters because
 * SQLite files upgraded from older versions may not have FK cascade enabled.
 * This module intentionally has no access to filesystem or the user's secrets.
 */
function deletionSteps(accountId) {
  const id=Number(accountId);
  if(!Number.isSafeInteger(id) || id<1)throw new Error('Некорректный ID счёта');
  return [
    ['DELETE FROM studio_result_images WHERE account_id=?',[id]],
    ['DELETE FROM trade_screenshots WHERE trade_id IN (SELECT id FROM trades WHERE account_id=?)',[id]],
    ['DELETE FROM trade_result_images WHERE trade_id IN (SELECT id FROM trades WHERE account_id=?)',[id]],
    ['DELETE FROM trade_extra_screenshots WHERE trade_id IN (SELECT id FROM trades WHERE account_id=?)',[id]],
    ['DELETE FROM trades WHERE account_id=?',[id]],
    ['DELETE FROM plan_images WHERE plan_id IN (SELECT id FROM weekly_plans WHERE account_id=?)',[id]],
    ['DELETE FROM weekly_plan_assets WHERE plan_id IN (SELECT id FROM weekly_plans WHERE account_id=?)',[id]],
    ['DELETE FROM weekly_plans WHERE account_id=?',[id]],
    ['DELETE FROM plans WHERE account_id=?',[id]],
    ['DELETE FROM backtest_result_images WHERE backtest_trade_id IN (SELECT t.id FROM backtest_trades t JOIN backtests b ON b.id=t.backtest_id WHERE b.account_id=?)',[id]],
    ['DELETE FROM backtest_images WHERE backtest_trade_id IN (SELECT t.id FROM backtest_trades t JOIN backtests b ON b.id=t.backtest_id WHERE b.account_id=?)',[id]],
    ['DELETE FROM backtest_trades WHERE backtest_id IN (SELECT id FROM backtests WHERE account_id=?)',[id]],
    ['DELETE FROM backtests WHERE account_id=?',[id]],
    ['DELETE FROM accounts WHERE id=?',[id]]
  ];
}
module.exports={deletionSteps};
