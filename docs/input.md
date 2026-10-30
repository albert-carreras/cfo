# Input

Everything starts from **Something happened** (`/change`) or from an item's own page.

## Sold an investment

Pick it, leave units blank to sell all of it, type what you received after fees (several orders?
add them up and use the last date), and say where the money is now:

- **Still in the broker account** — broker cash goes up.
- **Another account** — the cash is moved there in the same step.
- **Leave balances alone** — only the units go down; use this when you already set the balances.

An account added after the sale date already contains the money, so nothing is moved into it.
The sale stores its FIFO cost basis, shows the gain and the year's running tax estimate, and
closes the position when nothing is left. A sale dated before the units were last confirmed is
refused (that confirmation already includes it); use the confirmation date, the tax year is what
matters.

## Bought an investment

More of something you hold, or "Something new" (account, ticker, name). Paid with cash in that
account, another account (moved first) or "leave balances alone". Each purchase adds a lot for
future cost basis.

## Moved money

Between two of your accounts. Both sides in one step.

## Update balances

Every balance, unit count, property value, debt and other asset on one page, each showing the
current figure. Type only what changed; blank rows stay as they are. Prices update by themselves.

## Opened or got something

Account (cash only), investment you already hold (units and what they cost), property (with an
optional mortgage), loan or mortgage, car or other.

## Closing things

Open the item:

- **Account** — needs no investments left. A remaining balance either moves to another account or
  is set to zero.
- **Investment** — "Remove without a sale" for a position that moved broker. A real sale goes
  through "Sold".
- **Property** — record net proceeds and where they went; the property and its mortgage close.
- **Debt** — mark repaid, optionally paid from an account.
- **Other** — remove, optionally with the money received.

## Tax

`/tax` lists each year's sales. Fix a sale's cost basis, remove a sale entered by mistake, and
mark the year paid (optionally from an account) once the return is settled.

## Plans and spending

`/plans` records big expected changes; close one once the real change is recorded. `/inputs`
holds monthly spend, safe withdrawal rate (type 3.5% or 0.035), income, housing cost and birth
date.
