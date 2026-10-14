# How to synchronize MetaTrader 5 with Shelld Statistics

**Status:** Proposed design, **not implemented** in v0.6.7. The integration would work on the same Windows 11 PC without uploading journal data to an external service.

## Recommended architecture

```
Windows 11
  ├── MT5 terminal (logged in to your broker or demo account)
  ├── Read-only built-in Python bridge using the official MetaTrader5 package (bundled with the Windows Setup.exe)
  │    ├── mt5.initialize() / mt5.account_info()
  │    ├── mt5.history_deals_get(from_utc, to_utc)
  │    ├── mt5.history_orders_get(...)
  │    └── mt5.positions_get() for current positions
  └── Shelld Statistics / Electron
       ├── isolated IPC import adapter with validation
       └── local SQLite history, images and plans
```

**Never** use `order_send` in the bridge. It is a read-only integration.

## Proposed sync sequence

1. Install **MetaTrader 5** for Windows and sign in to the trading account in the terminal.
2. For the installed Public Beta, Python and the official MetaTrader5 module are already embedded in the Setup.exe. Only an installed desktop MT5 terminal is required. Developers running source without packaging need a compatible Python and MetaTrader5 module.
3. Start an optional local bridge from Shelld Statistics. The bridge calls `mt5.initialize()` against the already-running terminal and reads the selected `account_info()` account login and server. Do not save your account password inside Shelld Statistics.
4. On first synchronization, read a user-selected backfill window (for example 90 days) from `history_deals_get(start_utc, now_utc)`, then poll for new deals about every 30–60 seconds while the terminal is available.
5. Group **executions** by account + position ID (or other reliable grouping for hedging/netting); handle partial closes, position reversals, fee-only deals and broker-specific execution records. A single MT5 deal is not necessarily one complete journal trade.
6. For each recognized position calculate instrument, LONG/SHORT, entry/exit times in local display timezone, size, average price, net monetary P&L, commissions and swaps. Track the close status; a partially closed position may need multiple journal entries or a clearly documented aggregation rule.
7. Pass validated normalized records through an Electron IPC import API. **Never** let an independent Python process write directly into the active SQLite file: Electron currently loads the entire SQLite DB into memory via `sql.js` and could overwrite out-of-band changes.
8. Use a stable deduplication key such as `(broker_server, account_login, position_identifier, close_deal_ticket)` for partial-close records or another documented unique group key. Persist a mapping between the MT5 identifiers and the internal Shelld `trade.id` so reruns **update** instead of duplicating entries.
9. Show `Last sync`, connection state, number of added/updated trades, and errors, with a manual **Sync now** button.

## What can be imported automatically?

| Field | MT5 history | Notes |
|---|---|---|
| Symbol, direction, lot, entry/exit time | Usually yes | Build a position from executions and orders |
| Entry/exit price | Usually yes | Weighted average if several fills |
| Realized monetary profit | Yes | P&L is in the account currency |
| Commission, swap, fee | Usually yes | Verify per broker and how they are recorded |
| Win/Loss/BE | Derived | Based on chosen net-P&L treatment |
| Gain (%) | Needs a defined base | Prefer balance/equity-at-entry snapshot; do not simply infer percent from money without a base |
| Planned risk (%) and realized RR | Not necessarily available from historical deals | Need initial stop-loss/position size and risk snapshot at entry or a manually set risk value |
| Trade model, weekly plan, 1W/1D/4H screenshots | No | These remain journal annotations |

## Safety details

- Never submit trading orders or change open positions from the sync bridge.
- Verify account ID and server before every import; do not mix prop-firm demo, personal or multiple broker accounts.
- Handle UTC timestamps and display conversion; do not silently reinterpret timestamps as local time.
- Use a transaction and validate each batch before saving; back up the SQLite file before the first bulk import.
- Do not overwrite manually added analysis, screenshots, models or linked trading plans during repeated sync.
- Add a preview/dry-run of detected imported trades before enabling continuous synchronization.

References: Official MetaQuotes MQL5 documentation for Python integration, `history_deals_get`, and `history_orders_get`.
