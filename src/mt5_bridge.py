"""Read-only MetaTrader 5 bridge. Receives credentials via stdin, writes only JSON to stdout.

Requires Windows and an installed MetaTrader 5 terminal for live syncing.
The Public Beta installer embeds this module and Python, so end users install neither.
Never submits orders, never writes credentials to disk, never prints the password.
"""
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta


def as_dict(deal):
    if isinstance(deal, dict):
        return deal
    if hasattr(deal, '_asdict'):
        return deal._asdict()
    return dict(deal)


def iso_local(epoch):
    return datetime.fromtimestamp(int(epoch), timezone.utc).astimezone().strftime('%Y-%m-%dT%H:%M')


def aggregate_closed_positions(deals, account_login, server, currency):
    """Import complete, closed positions only; avoid guessing partial/reversal risk data."""
    grouped = defaultdict(list)
    for item in deals:
        d = as_dict(item)
        pid = int(d.get('position_id') or 0)
        if pid and d.get('symbol'):
            grouped[(pid, str(d['symbol']))].append(d)
    out = []
    partial = 0
    missing_entry = 0
    reversed_positions = 0
    for (pid, symbol), items in grouped.items():
        items.sort(key=lambda d: (int(d.get('time_msc', int(d.get('time', 0)) * 1000)), int(d.get('ticket', 0))))
        if any(int(d.get('entry', -1)) == 2 for d in items):
            reversed_positions += 1
            continue
        entries = [d for d in items if int(d.get('entry', -1)) == 0]
        exits = [d for d in items if int(d.get('entry', -1)) in (1, 3)]
        if not entries:
            missing_entry += 1
            continue
        if not exits:
            continue
        in_vol = sum(float(d.get('volume', 0)) for d in entries)
        out_vol = sum(float(d.get('volume', 0)) for d in exits)
        # A position with remaining volume has an unrealized component and is not a closed trade.
        if in_vol - out_vol > max(1e-7, in_vol * 1e-5):
            partial += 1
            continue
        if out_vol - in_vol > max(1e-7, in_vol * 1e-5):
            reversed_positions += 1
            continue
        trade_type = int(entries[0].get('type', -1))
        if trade_type not in (0, 1):
            continue
        money = sum(sum(float(d.get(k, 0) or 0) for k in ('profit', 'commission', 'swap', 'fee')) for d in items)
        total_entry_vol = sum(float(d.get('volume', 0)) for d in entries)
        total_exit_vol = sum(float(d.get('volume', 0)) for d in exits)
        def weighted(ds, vol):
            return sum(float(d.get('price', 0)) * float(d.get('volume', 0)) for d in ds) / vol if vol else 0
        opened = min(int(d.get('time', 0)) for d in entries)
        closed = max(int(d.get('time', 0)) for d in exits)
        if not opened or not closed or closed < opened:
            continue
        out.append({
            'external_key': f"MT5:{server}:{account_login}:{pid}:{symbol}",
            'position_id': pid, 'symbol': symbol,
            'direction': 'LONG' if trade_type == 0 else 'SHORT',
            'opened_at': iso_local(opened), 'closed_at': iso_local(closed),
            'volume': round(in_vol, 8),
            'open_price': weighted(entries, total_entry_vol),
            'close_price': weighted(exits, total_exit_vol),
            'profit_money': round(money, 8), 'profit_currency': currency,
            'result': 'WIN' if money > 1e-9 else ('LOSS' if money < -1e-9 else 'BE'),
        })
    out.sort(key=lambda r: (r['closed_at'], r['position_id'], r['symbol']))
    return {'trades': out, 'skipped_partial': partial, 'skipped_missing_entry': missing_entry,
            'skipped_reversal': reversed_positions}



def reconcile_tracked_positions(report, tracked, live_positions, mt5, account_login, server, currency):
    """Recheck missing OPEN journal positions using MT5's full per-position history.

    A date-scoped history query may omit an entry deal, or return no history for a
    recently closed position. Only an independently confirmed full exit is merged.
    An unresolved position is reported but NEVER silently marked LOSS or BE.
    """
    live_keys = {
        (int(getattr(p, 'identifier', getattr(p, 'ticket', 0))), str(getattr(p, 'symbol', '')))
        for p in live_positions
    }
    known_keys = {
        (int(t['position_id']), str(t['symbol']))
        for t in report['trades']
    }
    checked = set()
    rechecked = 0
    unresolved = 0
    recovered = 0
    for raw in (tracked or [])[:200]:
        try:
            pid = int(raw.get('position_id') or 0)
            symbol = str(raw.get('symbol') or '').strip()
        except (AttributeError, TypeError, ValueError):
            continue
        key = (pid, symbol)
        if pid <= 0 or not symbol or key in checked or key in live_keys or key in known_keys:
            continue
        checked.add(key)
        rechecked += 1
        # MT5 API supports history_deals_get(position=POSITION_ID).
        position_history = mt5.history_deals_get(position=pid)
        if position_history is None:
            unresolved += 1
            continue
        history_report = aggregate_closed_positions(position_history, account_login, server, currency)
        match = next((t for t in history_report['trades']
                      if (int(t['position_id']), str(t['symbol'])) == key), None)
        if match:
            report['trades'].append(match)
            known_keys.add(key)
            recovered += 1
        else:
            unresolved += 1
    report['trades'].sort(key=lambda t: (t.get('closed_at') or '9999', t['position_id'], t['symbol']))
    report['rechecked_positions'] = rechecked
    report['recovered_positions'] = recovered
    report['unresolved_positions'] = unresolved
    return report


def mt5_sync(options):
    try:
        import MetaTrader5 as mt5
    except ImportError as exc:
        raise RuntimeError('Не найден компонент MetaTrader5 во встроенном модуле. Переустанови Shelld Statistics или проверь выбранный вручную Python') from exc
    login = int(options['login'])
    password = str(options.get('password') or '')
    server = str(options.get('server') or '').strip()
    terminal = str(options.get('terminal') or '').strip()
    days = max(1, min(3650, int(options.get('days') or 365)))
    kwargs = {'login': login, 'password': password, 'timeout': 25000}
    if server:
        kwargs['server'] = server
    try:
        ok = mt5.initialize(terminal, **kwargs) if terminal else mt5.initialize(**kwargs)
        if not ok:
            raise RuntimeError(f'Не удалось подключиться к MT5: {mt5.last_error()}. Проверь логин, сервер, пароль и терминал.')
        account = mt5.account_info()
        if account is None:
            raise RuntimeError('MT5 не вернул данные счёта')
        if int(account.login) != login:
            raise RuntimeError('Подключён другой торговый счёт MT5')
        now = datetime.now(timezone.utc)
        history = mt5.history_deals_get(now - timedelta(days=days), now + timedelta(minutes=2))
        if history is None:
            raise RuntimeError(f'MT5 не вернул историю исполнений: {mt5.last_error()}')
        actual_server=str(getattr(account, 'server', server))
        currency=str(account.currency)
        report = aggregate_closed_positions(history, login, actual_server, currency)
        live=mt5.positions_get()
        if live is None:
            raise RuntimeError(f'Не удалось получить открытые позиции MT5: {mt5.last_error()}. Повтори синхронизацию.')
        live_count=0
        known={row['external_key'] for row in report['trades']}
        for p in live:
            pid=int(getattr(p,'identifier',getattr(p,'ticket',0)))
            symbol=str(getattr(p,'symbol',''))
            position_key=f'MT5:{actual_server}:{login}:{pid}:{symbol}'
            if not pid or not symbol or position_key in known:
                continue
            opened=int(getattr(p,'time',0))
            if opened<=0:
                continue
            report['trades'].append({
                'external_key':position_key,'position_id':pid,'symbol':symbol,
                'direction':'LONG' if int(getattr(p,'type',0))==0 else 'SHORT',
                'opened_at':iso_local(opened),'closed_at':None,
                'volume':float(getattr(p,'volume',0)),
                'open_price':float(getattr(p,'price_open',0)),
                'close_price':None,
                'profit_money':round(float(getattr(p,'profit',0))+float(getattr(p,'swap',0)),8),
                'profit_currency':currency, 'result':'OPEN'
            })
            live_count+=1
        reconcile_tracked_positions(report, options.get('tracked_positions'), live, mt5,
                                    login, actual_server, currency)
        report.update({'account_login': login, 'account_server': actual_server,
                       'currency': currency, 'deal_count': len(history),'open_positions':live_count})
        return report
    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass


def main():
    if sys.argv[1:] == ['--self-test']:
        try:
            import MetaTrader5 as mt5
            print(json.dumps({'ok': True, 'mode': 'self-test', 'module': 'MetaTrader5',
                              'version': str(getattr(mt5, '__version__', 'unknown'))}))
            return
        except Exception as exc:
            print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False))
            sys.exit(1)
    try:
        request = json.loads(sys.stdin.read())
        result = mt5_sync(request)
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False))
        sys.exit(1)

if __name__ == '__main__':
    main()
