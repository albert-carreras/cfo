# CFO — agent guide

CFO is a small personal financial record: one overview of what you own, a "something happened"
flow that records real-life events (sold, bought, moved money, new balances), the tax to keep
aside for sales, and an exportable Markdown brief for decisions in a general AI chat. A monthly
push says how net worth moved and what needs attention. There is no AI inside the app.

## The one rule

**Every personal number is verified or calculated.** Verified = entered or confirmed by the
person, or fetched from a price/FX feed. Calculated = produced by the pure, tested calculators in
`src/calc`. The app never guesses a missing value, never gives advice and never recommends a
transaction; open questions go to an external AI with the export.

## Read first

- [docs/principles.md](docs/principles.md) — product invariants.
- [docs/architecture.md](docs/architecture.md) — boundaries and automation.
- [docs/data-model.md](docs/data-model.md) — stored facts, observations and history.
- [docs/input.md](docs/input.md) — how real-life changes are recorded.
- [docs/calculators.md](docs/calculators.md) — the deterministic core, including tax.
- [docs/export.md](docs/export.md) — the Markdown handoff and the monthly push.

If code contradicts a doc, update the doc in the same change.

## Invariants

1. Calculators in `src/calc/*` are pure (no I/O, clock or randomness), versioned and tested. Each
   returns `CalcResult<T>` with provenance ids.
2. Movements and observations are append-only (database triggers enforce it). A mistake is fixed
   by a newer observation, never by editing a row. Accounts, holdings, properties, debts and other
   assets are soft-closed, never deleted. A sale or tax payment entered by mistake is voided.
3. Every user event is one transaction ending in one recomputed snapshot and one activity entry
   (`finishChange` in `src/server/write.ts`).
4. A plan is context, never a number in today's position.
5. Tax is an estimate on security sales only (Spain's savings scale, FIFO cost basis). It is
   deducted from net worth until the year is marked paid. Property gains are not estimated.
6. Push payloads never carry € amounts (public ntfy topics are guessable).
7. Keep retired tables (`health_checks`, `decisions`, `reviews`, `pictures`, `checks`,
   `monthly_spend`, `settings`) as archival data unless a separately approved migration removes
   them.

## Product surface

- `/` — overview: net worth and chart, what needs you, summary, spending line, everything you own,
  plans, recent activity.
- `/change` — "something happened": sold, bought, moved money, update balances, add, close.
- `/item/[kind]/[id]` — one account, investment, property, debt or other asset: set its value,
  edit details, close it.
- `/tax`, `/plans`, `/inputs`, `/activity`.
- `/api/export` — the Markdown brief. `/api/cron/daily` — prices, FX, today's snapshot.
  `/api/cron/monthly` — the monthly push.

The UI is plain and phone-first, with light and dark themes from `src/app/globals.css`.

## Stack and commands

Next.js App Router, TypeScript, Tailwind v4 (barely used; plain CSS classes), Drizzle/Postgres,
Zod, Vitest, Node 24 and npm.

| Command | Purpose |
|---|---|
| `npm run dev` | Local app on port 3222 |
| `npm run test:ci` | Gate: lint, typecheck, tests |
| `npm run db:generate` | Generate a migration after schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run seed` | Destructive synthetic/local seed |

The database schema is `src/server/db/schema.ts`; migrations are in `drizzle/`. Real financial
data belongs only in Postgres or git-ignored `scripts/seed.local.ts`.

## `CalcResult` contract

```ts
type CalcResult<T> = {
  snapshotId: string;
  value: T;
  source: string;
  version: string;
  inputs: string[];
};
```

## Infra

Production runs on `au` behind Cloudflare Access and an outbound-only Tunnel. Postgres is private.
Application egress: Yahoo Finance quotes, ECB FX and the optional ntfy endpoint. See
[docs/deploy.md](docs/deploy.md).
