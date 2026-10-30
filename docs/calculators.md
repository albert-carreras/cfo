# Calculators

Pure, deterministic, versioned (`src/calc/config/versions.ts`) and tested. Each returns
`CalcResult<T>` with the ids of the rows it used. `computeSnapshot` runs them in order.

## derive

Opening balance or latest observation, plus later movements; corrections (`correctsId`) supersede
the row they correct. On an observation's own date, a movement applies only if it was written
after the observation.

## valuation

Latest price on or before the date × units, through dated ECB FX when the price isn't in EUR. No
price means €0 and `priced: false`, never a guess.

## netWorth

- cash = cash in every non-pension account (bank, savings, broker cash)
- investments = securities outside pensions
- pension = pension cash and securities
- property = your share of each value − its mortgage
- other = other assets marked as counted
- taxDue = estimated tax on unpaid years' sales
- total = all of the above − loans − taxDue
- available = cash + investments − loans − taxDue

## fire (spending)

safe monthly spend = available × safe withdrawal rate / 12. It fits when monthly spend ≤ safe.
Years at zero growth = available / (spend × 12). Pension and property are not counted.

## tax

- FIFO cost basis over a holding's purchase lots, after the units earlier sales used. Null when
  the lots don't cover the sale.
- Each year's net gain (losses offset gains within the year, floor zero) on Spain's savings scale
  (`config/taxEs.ts`): 19% to €6,000, 21% to €50,000, 23% to €200,000, 27% to €300,000, 30% above.
- Due by 30 June of the next year. Paid years drop out of `dueEUR`.
- Not modelled: interest, dividends, loss carry-forwards, property gains, País Vasco/Navarra.

## attention

The overview's "Needs you" list, most important first: negative balances, missing or stale prices,
tax to keep aside (overdue after the due date), sales without cost basis, values older than their
freshness limit (`config/freshness.ts`: cash 100 days, pension 200, units/property/other 370, debt
200), plans whose date passed, missing or year-old spending inputs, spending above the safe level.

## Deliberately absent

Mortgage, scenario, property-vs-ETF and trade calculators. Decision-specific maths belongs in the
external AI conversation, which has the brief.
