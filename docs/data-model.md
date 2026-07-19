# Data model

## Verified structure

- `accounts` — bank, broker, pension or manual container with a dated opening balance.
- `holdings` — security identity, account, dated opening quantity and optional feed ticker.
- `properties` — value, ownership, purchase context, rent/cost context and valuation date.
- `other_assets` — vehicles, businesses, collectibles or other context; explicitly included or
  excluded from planning net worth.
- `liabilities` — mortgages linked to property or general loans.
- `assumptions` — dated planning inputs such as spending, withdrawal rate, income and housing cost.
- `planned_events` — future context only; never counted in present net worth.

Facts are soft-closed with `disposedAt` where applicable.

## Dated observations

`revaluations` is the generic append-only value stream for accounts, holding quantities,
properties, liabilities and other assets. A Data workspace save writes one observation per live
item. `data_updates` groups those rows into a readable human event with an as-of date and note.

For accounts and holdings, the latest dated observation re-anchors the baseline and later legacy
movements replay after it. Property, debt and other-asset observations replace the earlier stated
value for current calculations.

## Automatic evidence

- `market_prices` — dated security prices.
- `fx_rates` — dated EUR conversion rates.
- `snapshots` — immutable calculated JSON; `internal` for daily history, `strategic` for durable
  checkpoints.

## AI check

`health_checks` stores trigger, dedupe key, snapshot id, deterministic summary, final verdict,
validated qualitative report, model provenance and any provider error. The row remains useful when
`report` is null because the deterministic floor is always present.

## Retained legacy records

`movements`, `monthly_spend`, `tax_lots`, `checks`, `decisions`, `reviews` and `pictures` predate the
simplified product. Movements and lots are still read for compatibility/export. The other legacy
tables are archival and must not be silently deleted.
