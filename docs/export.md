# Export and monthly push

## Markdown brief

`GET /api/export` (also "Copy for AI" and ".md" in the header) produces one Markdown file for a
ChatGPT or Claude project:

- position: net worth buckets, tax due, available pile;
- spending: monthly spend, safe level, years at zero growth;
- every account with cash and confirmation date, every investment with units, price and date,
  value, FIFO cost basis and unrealised gain;
- realised sales per year with cost basis, estimated tax and whether it's paid;
- property, debt, other assets, planning inputs (income, housing cost, birth date) and plans;
- gaps: everything on the attention list plus missing income and purchase prices;
- instructions telling the receiving AI to keep facts, calculations and its own judgment apart
  and to ask before assuming missing terms.

The app never sends the brief anywhere; exporting is a deliberate action.

## Monthly push

On the 1st, `/api/cron/monthly` sends one ntfy notification about the month that ended:

> CFO · October — Net worth rose 1.2% in October. Worth a look: tax on this year's sales to keep
> aside; 3 values to confirm.

It carries percentages, counts and names, never € amounts, and opens `CFO_PUBLIC_URL` when tapped.
It is sent once per month; without `NTFY_URL` nothing is sent.

The old monthly AI check is gone. Its rows stay in `health_checks` as archive.
