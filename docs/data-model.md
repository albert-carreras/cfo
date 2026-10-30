# Data model

## Things you own

- `accounts` — bank/savings, broker, pension or cash, with a dated opening balance.
- `holdings` — an investment in an account: name, ticker (the Yahoo symbol, also the price key in
  `isin` for new rows), dated opening units.
- `tax_lots` — purchases: date, units, total cost. FIFO cost basis for sales comes from these.
- `properties` — full value, your share, purchase price, rent/costs, valuation date.
- `liabilities` — mortgages (linked to a property) and loans.
- `other_assets` — cars and similar, counted in net worth only when marked.
- `assumptions` — planning inputs: monthly spend, safe withdrawal rate, income, housing cost,
  birth date. Each has a reviewed date.
- `planned_events` — plans. Context only. A date from 2049 means "timing unknown", amount 0 means
  "amount TBD".

Closed things get `disposedAt`; nothing is deleted.

## What changes them

- `movements` — append-only cash and unit changes: deposit, withdraw, buy, sell, transfer. A
  transfer is two rows sharing `transferGroupId`. Written by the sell/buy/move/tax flows.
- `revaluations` — append-only dated observations ("this balance is X on date D") for accounts,
  holding units, properties, debts and other assets.

Current state of an account or holding = its latest observation (or opening balance) plus the
movements after it. On the observation's own date, only movements written after the observation
apply, so confirming a balance and then logging something the same day never double counts.

## Sales and tax

- `sales` — one row per sale: holding, date, units, net proceeds, cost basis (FIFO, or entered by
  hand), `voidedAt` when entered by mistake.
- `tax_settlements` — a year's tax marked paid. While a year has none, its estimate is deducted
  from net worth.

## Computed and logged

- `market_prices`, `fx_rates` — dated feed rows.
- `snapshots` — one computed snapshot per day (jsonb).
- `data_updates` — the activity log: `kind`, `title`, readable `changes` lines and a note. Rows
  from before the log existed hold raw observations; the activity page resolves their names.
- `settings` — small app flags, e.g. `digest:YYYY-MM` once the monthly push went out.

## Retired, kept as archive

`health_checks` (the old monthly AI check), `decisions`, `reviews`, `pictures`, `checks` and
`monthly_spend` are not read by anything and stay untouched.
