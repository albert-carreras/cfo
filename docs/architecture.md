# Architecture

```text
events from the UI ──┐
prices + FX feed ────┼─> Postgres: facts, movements, observations, sales
                     │                      │
                     │              loadFacts (src/server/facts.ts)
                     │                      v
                     │   pure calculators (src/calc): derive · valuation · tax
                     │            net worth · spending · attention
                     │                      │
                     │        ┌─────────────┼──────────────┐
                     v        v             v              v
               daily snapshot   overview / item pages   Markdown brief   monthly push
```

## Boundaries

- **Record:** Drizzle/Postgres. `loadFacts` is the only read path into calculator input.
- **Trust core:** `src/calc/*` has no database, network, clock or randomness; dates enter as
  arguments. `computeSnapshot` composes everything into one result.
- **Writes:** `src/server/record.ts` (events: values, sell, buy, move, tax, closing) and
  `src/server/items.ts` (adding and editing things, plans, planning inputs) on top of the
  append-only primitives in `src/server/ledger.ts`. Each event is one transaction that ends in
  `finishChange`: recompute, store today's snapshot, write one activity entry.
- **Read model:** `src/server/overview.ts` builds what every screen and the export show.
- **UI:** server components in `src/app`. Forms post through `ActionForm`, which keeps what was
  typed when a flow rejects it (`RecordError`) and shows why.

## Automation

`/api/cron/daily` (06:15 and 07:45 UTC) fetches a Yahoo Finance price for every live investment
with a ticker, ECB FX for non-EUR prices, and stores today's snapshot. One symbol failing never
blocks the rest; a stale price shows up on the overview.

`/api/cron/monthly` (08:45 UTC on the 1st) sends one ntfy push about the month that just ended and
what needs attention. It dedupes by month.

Adding an investment or changing its ticker fetches its price immediately.

## Snapshots

One snapshot per day (`dedupeKey internal:YYYY-MM-DD`), upserted by the daily feed and by every
change. The net-worth chart reads only `result.netWorth.value.totalEUR`, so older rows with a
different shape still chart.

## Privacy

Production is behind Cloudflare Access; the origin and Postgres are private. Nothing personal
leaves the box automatically except the amount-free monthly push. Exporting the brief is a
deliberate action.
