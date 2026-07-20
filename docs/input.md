# Input

## Initial setup

Enter the structural facts once: accounts, investments, properties and mortgages, other material
assets, loans, and core planning inputs. A feed ticker enables automatic market pricing; no ticker
is allowed only with explicit acknowledgement.

## Ordinary maintenance

Use **Data → Confirm the current snapshot**. The form shows every live balance, investment
quantity, property value, debt balance and other-asset value, each with its last-confirmed date.
Edit what changed, choose the as-of date, add a short note if useful, and save the batch. Every row
is confirmed by default; uncheck a row to skip it so one balance you cannot confirm today does not
block the rest.

This is intentionally not a transaction workflow. If cash rose by an immaterial amount and that
precision does not change any decision, update it at the next natural checkpoint.

## Major events

- **Bought a house:** add the property and optional mortgage; then confirm the affected cash and
  investment values in the snapshot form. Mark an existing house plan reflected only after the
  actual facts are present.
- **Received an inheritance:** add the asset actually received, or confirm the account/investment
  where it landed. Do not keep it as a future plan after it is in current facts.
- **Bought a car:** add it as an other asset if it is useful context. Cars default to excluded from
  planning net worth. Add a loan separately if applicable and confirm the cash used.
- **Sold or closed something:** use **Data → Close or dispose**. An account must be empty and a
  holding fully sold before it closes; recording a property sale books the net proceeds into an
  account. Repaid loans and disposed other assets soft-close directly — then confirm the cash they
  moved in the snapshot form. Everything is soft-closed and stays in the record; nothing is deleted.

## Planning inputs

Spending and the safe-withdrawal rate drive the independence metrics. Income and current housing
cost exist primarily so a decision conversation has the missing affordability context. All inputs
carry a reviewed date and source.

## Plans

A plan has type, rough date, magnitude and context. It never changes current net worth or runway.
The receiving AI decides how to model it after asking for missing terms. Open a plan in **Data →
Planned major changes** to edit its type, date, amount or note; "Timing unknown" and "Amount TBD"
checkboxes record the sentinels so no magic date or zero has to be remembered.
