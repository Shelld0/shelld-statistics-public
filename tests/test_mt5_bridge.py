import unittest
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from mt5_bridge import aggregate_closed_positions, mt5_sync, reconcile_tracked_positions


def d(pid, ticket, time, entry, side, volume, profit=0, commission=0, symbol='EURUSD', price=1.1):
    return dict(position_id=pid,ticket=ticket,time=time,time_msc=time*1000,entry=entry,type=side,
                volume=volume,profit=profit,commission=commission,swap=0,fee=0,symbol=symbol,price=price)

class MT5BridgeTests(unittest.TestCase):
    def test_closed_and_partial(self):
        deals=[d(101,1,1600000000,0,0,1,commission=-1),d(101,2,1600005000,1,1,1,profit=110,commission=-2),
               d(102,3,1600000000,0,0,1),d(102,4,1600005000,1,1,.4,profit=20)]
        r=aggregate_closed_positions(deals,123,'Broker-Demo','USD')
        self.assertEqual(len(r['trades']),1)
        self.assertEqual(r['skipped_partial'],1)
        self.assertEqual(r['trades'][0]['profit_money'],107)
        self.assertEqual(r['trades'][0]['direction'],'LONG')
    def test_partial_fills_net_position(self):
        deals=[d(101,1,1600000000,0,1,.5),d(101,2,1600001000,0,1,.5),
               d(101,3,1600010000,1,0,.4,profit=-40),d(101,4,1600020000,1,0,.6,profit=-60)]
        r=aggregate_closed_positions(deals,123,'Broker-Real','EUR')
        self.assertEqual(len(r['trades']),1)
        self.assertEqual(r['trades'][0]['profit_money'],-100)
        self.assertEqual(r['trades'][0]['direction'],'SHORT')
    def test_reversal_excluded(self):
        deals=[d(101,1,1600000000,0,0,1),d(101,2,1600005000,2,1,2,profit=100)]
        r=aggregate_closed_positions(deals,123,'Broker','USD')
        self.assertEqual(len(r['trades']),0)
        self.assertEqual(r['skipped_reversal'],1)
    def test_rechecks_local_open_position_closed_outside_date_scoped_history(self):
        # Seen OPEN in SQLite; terminal has no live position and date-filtered deals
        # missed it. The specific position lookup must resolve the completed stop.
        closed=[d(901,1,1771000000,0,0,.2),
                d(901,2,1771003000,1,1,.2,profit=-90)]
        fake=SimpleNamespace(
            initialize=lambda **kwargs:True,
            account_info=lambda:SimpleNamespace(login=321,server='Broker-Test',currency='EUR'),
            history_deals_get=lambda *args,**kwargs:closed if kwargs.get('position')==901 else [],
            positions_get=lambda:[],shutdown=lambda:None)
        with patch.dict(sys.modules,{'MetaTrader5':fake}):
            r=mt5_sync({'login':321,'password':'demo','server':'Broker-Test','days':365,
                        'tracked_positions':[{'position_id':901,'symbol':'EURUSD'}]})
        self.assertEqual(r['rechecked_positions'],1)
        self.assertEqual(r['recovered_positions'],1)
        self.assertEqual(r['unresolved_positions'],0)
        self.assertEqual(len(r['trades']),1)
        self.assertEqual(r['trades'][0]['result'],'LOSS')
        self.assertEqual(r['trades'][0]['profit_money'],-90)
        self.assertIsNotNone(r['trades'][0]['closed_at'])

    def test_open_position_does_not_get_falsely_closed_by_targeted_check(self):
        live=SimpleNamespace(identifier=901,symbol='EURUSD',type=0,time=1771000000,
                             volume=.2,price_open=1.12,profit=-15,swap=0)
        fake=SimpleNamespace(
            initialize=lambda **kwargs:True,
            account_info=lambda:SimpleNamespace(login=321,server='Broker-Test',currency='EUR'),
            history_deals_get=lambda *args,**kwargs:[],
            positions_get=lambda:[live],shutdown=lambda:None)
        with patch.dict(sys.modules,{'MetaTrader5':fake}):
            r=mt5_sync({'login':321,'password':'demo','server':'Broker-Test','days':365,
                        'tracked_positions':[{'position_id':901,'symbol':'EURUSD'}]})
        self.assertEqual(r['rechecked_positions'],0)
        self.assertEqual(r['trades'][0]['result'],'OPEN')

    def test_absent_position_without_confirming_close_is_reported_not_fabricated(self):
        fake=SimpleNamespace(
            initialize=lambda **kwargs:True,
            account_info=lambda:SimpleNamespace(login=321,server='Broker-Test',currency='EUR'),
            history_deals_get=lambda *args,**kwargs:[],
            positions_get=lambda:[],shutdown=lambda:None)
        with patch.dict(sys.modules,{'MetaTrader5':fake}):
            r=mt5_sync({'login':321,'password':'demo','server':'Broker-Test','days':365,
                        'tracked_positions':[{'position_id':901,'symbol':'EURUSD'}]})
        self.assertEqual(r['unresolved_positions'],1)
        self.assertEqual(r['trades'],[])

    def test_positions_get_failure_aborts_sync_instead_of_fabricating_close(self):
        fake=SimpleNamespace(
            initialize=lambda **kwargs:True, last_error=lambda:(-1,'terminal unavailable'),
            account_info=lambda:SimpleNamespace(login=321,server='Broker-Test',currency='EUR'),
            history_deals_get=lambda *args,**kwargs:[],
            positions_get=lambda:None,shutdown=lambda:None)
        with patch.dict(sys.modules,{'MetaTrader5':fake}):
            with self.assertRaisesRegex(RuntimeError,'открытые позиции MT5'):
                mt5_sync({'login':321,'password':'demo','server':'Broker-Test','days':365})

    def test_real_sync_returns_closed_and_open_without_password(self):
        closed=[d(101,1,1600000000,0,0,1),d(101,2,1600005000,1,1,1,profit=50)]
        position=SimpleNamespace(identifier=202,symbol='GBPUSD',type=1,time=1600001000,
                                 volume=.3,price_open=1.24,profit=-12.5,swap=-.5)
        fake=SimpleNamespace(initialize=lambda **kwargs:True,
                             account_info=lambda:SimpleNamespace(login=321,server='Broker-Test',currency='USD'),
                             history_deals_get=lambda _a,_b:closed,
                             positions_get=lambda:[position],shutdown=lambda:None)
        with patch.dict(sys.modules, {'MetaTrader5':fake}):
            result=mt5_sync({'login':321,'password':'do-not-leak','server':'Broker-Test','days':365})
        self.assertEqual(result['open_positions'],1)
        self.assertEqual(len(result['trades']),2)
        self.assertEqual(result['trades'][1]['result'],'OPEN')
        self.assertEqual(result['trades'][1]['closed_at'],None)
        self.assertNotIn('do-not-leak',repr(result))

if __name__=='__main__':unittest.main()
