# Calculators

The trust core is deliberately small. Each calculator is pure, deterministic, versioned and
returns `CalcResult<T>` with source input ids.

## State derivation

`deriveState` starts from each account/holding opening baseline, applies the latest dated
observation on or before `asOf`, then replays later legacy movements. Corrections cancel the row
they supersede. This keeps old data valid while making occasional snapshot confirmation the normal
workflow.

## Valuation

Latest security price on or before `asOf` × derived quantity, converted through a matching dated
FX rate when needed. Missing/stale price evidence is explicit; it is never replaced by a guess.

## Net worth

- liquid = bank + manual cash
- investable = broker cash + broker securities
- locked = pension cash + pension securities
- property equity = owned property value − linked mortgage
- other assets = only rows explicitly included
- total = all included buckets − general debt
- FIRE-counted = liquid + investable

Debt is reported gross as well as reflected in total/equity.

## Independence plan

The FIRE calculator uses verified planning assumptions to produce zero-growth runway, safe monthly
spending, actual withdrawal rate, an optional real-return illustration, and conservative/base/
optimistic bands. It does not incorporate open plans.

## Data quality and status

Required inputs are the spending assumption, withdrawal rate, and current prices for held
securities. Optional balances, quantities, property/debt values and other assumptions have longer
cadences and can warn without erasing a valid current status. The deterministic status then applies
runway and overspending thresholds.

## Concentration and material change

Concentration classifies positions, brokers, real estate and Spain exposure against versioned
ceilings. Material change compares strategic snapshot summaries so the daily feed can stay quiet
unless something meaningfully moves.

## Deliberately absent

There is no tax estimate, mortgage calculator, property-vs-ETF comparison, position-sale model or
future-event scenario engine. Decision-specific math belongs in the external AI conversation and
must state its assumptions there.
