# Getting data in

Two input modes, matching the two halves of the [data model](data-model.md):

- **Forms** for slow-moving **facts**: the opening baseline enters via the `/setup` wizard
  (first run, see §1); later fact maintenance (revaluations, assumptions, disposals) is being
  built on `/manage`. There is not yet a fact-edit audit trail.
- **Quick-log** appends to the **movement ledger** (buy / sell / deposit / dividend / fee /
  expense) and logs the monthly spend figure. Append-only: you never edit a ledger row, you add a
  correcting one.

The rule that ties them together: **current state = a dated opening baseline + every movement
since.** You set the baseline once, then you only ever log what changed.

## 1. Initial setup — "I have €300k in ETFs and 3 apartments"

A one-time **opening baseline**, dated. You enter your current position as facts:

- each **account** (Trade Republic, DEGIRO, pension, bank) and its cash balance
- each **holding** (ISIN, quantity) — and, for anything you'll owe Spanish capital-gains tax on,
  its **open tax lots** (the purchases you still hold: buy date, quantity, price, fees, FX). You do
  *not* back-fill closed/sold history — only the lots you still own, because that's all FIFO needs
  going forward.
- each **property** (value, purchase price, ownership %, rent, costs, primary-residence flag) and
  any **mortgage**
- your **assumptions** (nominal expected return, long-run inflation forecast, safe withdrawal
  rate, pension access dates)

Bulk entry, not one form at a time:

- **The `/setup` wizard** (first run): a fresh database routes home → `/setup`, a multi-step
  wizard (baseline date → accounts → holdings + lots → properties + mortgages → assumptions →
  planned events → review) held client-side and committed in **one transaction** that ends with
  the first strategic snapshot. Create-only and serialized: the commit takes an advisory lock and
  refuses if *any* baseline table has rows — `/setup` can never touch an existing install. The
  schema is shared (`src/shared/setup.ts`), so the wizard validates with exactly what the server
  commits with; cost basis is derived server-side (price × qty × FX + fees), account cash is
  EUR-only for now, and a held position needs a feed ticker or an explicit "unpriced"
  acknowledgement. Lot-coverage gaps are a review-screen warning, never a block. `monthlySpend`
  and `safeWithdrawalRate` are required — without them the first snapshot is born Data stale.
  After commit the price feed is kicked best-effort; a feed failure surfaces as missing prices in
  data quality, never as a failed setup.
- **The seed** (`scripts/seed.ts`) remains the dev/test path: a destructive reset onto the
  committed synthetic fixture (or a git-ignored `seed.local.ts`), guarded by the
  `cfo.allow_ledger_reset` trigger setting. Never run it on a live install.
- **Backlog** ([roadmap](roadmap.md)): import paths (broker CSV / paste) for holdings and lots.

After setup, net worth and runway compute off the baseline. From here on you log *changes*, not
balances.

## 2. Regular updates — what changed since last time

Two cadences:

**Quick-log (frequent, append-only):**

- a **buy / sell**, a **dividend**, a **fee**, a **transfer**, a one-off **deposit / withdrawal**
- a **transfer between your own accounts** — one form, both legs (see below)
- a **pension statement** — a dated revaluation the account re-anchors to (see below)
- monthly **spend** — **optional calibration only** (see below); never required

These are ledger rows; net worth and runway recompute from baseline + movements.
Amounts are positive EUR values. `transfer` means the incoming destination leg — money arriving
from outside.

**Natural-language quick-log ("just type it"):** the `/log` page takes free text — *"sold 10
VWCE yesterday at 130"* — and proposes a structured entry. The boundary is the tightest of the
voice's four clients: **the model receives only the text the user just typed** (no accounts, no
names, no ids — invariant #6 untouched) and may only *transcribe*: it returns verbatim spans
(entity mentions, numbers, a date expression), each of which is verified deterministically —
a span must appear in the input, and a normalized number must carry exactly the digits of its
span, so an invented figure can never become a proposal. Everything that decides what gets
logged is server-side and deterministic: entity resolution over local names/tickers/ISINs
(zero or multiple matches ⇒ a clarify question, never a guess), relative dates against the
server clock, the one `quantity × price` multiplication, and a final re-parse with the exact
schemas the manual forms use. The confirm card renders purely from the resolved struct — never
model prose — and confirming posts through the same submit actions as the forms, so the same
in-transaction checks re-validate everything. A missing key (or a provider
failure) quietly leaves the manual forms, which work fully offline — input never depends on
the provider.

**One user intent = one transaction = one snapshot.** Every quick-log intent has a
transaction-scoped primitive in `src/server/quicklog.ts` (`appendMovementTx`, `appendTransferTx`,
`logRevaluationTx`, `logMonthlySpendTx` — validate + append, no recompute) and a thin public
wrapper that runs it and promotes exactly one strategic snapshot (`recomputeAndPromote`).
Compound flows (realising a planned event, disposing a property) compose the primitives inside
one transaction with one final recompute, so a snapshot can never capture a half-applied state.

**Own-account transfers: one intent, two legs, atomically.** The quick-log transfer
form (and the `transfer` kind on `POST /api/log`) takes from/to/amount and writes the `withdraw`
leg on the source and the `transfer` leg on the destination **in one transaction**, both sharing a
`transferGroupId` — quick-log can no longer produce the one-sided transfer that used to be able to
create or destroy money. Driving the source account's cash negative is a **warn, not a block**:
the snapshot raises a soft data-quality flag (*"cash is negative in … — a movement may be missing
or a transfer one-legged"*), because the likely cause is a missing earlier entry, and honesty
beats refusing the entry.

**Pension statements: a dated fact, not an edit.** A pension's value is periodically
*stated* by the provider, not derivable from the ledger. The quick-log statement form appends a
`revaluations` row (`value`, `valuedAt`) and the account **re-anchors**: value = latest statement
+ movements since its date (the opening-baseline rule, re-applied). Append-only — a wrong
statement is fixed by appending a newer one. Restricted to pension accounts: bank/broker cash is
exact and must stay derived. Freshness now tracks the latest statement (quarterly cadence), so a
pension no longer goes permanently stale.

**Spend: a coarse annual assumption, not a monthly log.** The source of truth for
FIRE / runway is the `monthlySpend` **assumption** — a big, round figure entered like the SWR and
reviewed **yearly** (principle #12: coarse by design — a ±€1,000/month imprecision must not
matter). Optional `monthlySpendConservative` / `monthlySpendOptimistic` values produce their own
runways. Set them with the assumption script:

```
npx tsx scripts/set-assumption.ts --key monthlySpend --value 3200 --source "coarse annual figure"
npx tsx scripts/set-assumption.ts --key monthlySpendConservative --value 3600
npx tsx scripts/set-assumption.ts --key monthlySpendOptimistic --value 2800
```

The monthly-spend quick-log survives as **optional calibration**: when at least 3 of the trailing
6 months are logged, their average is compared to the assumption, and a divergence past the
versioned ±25% threshold (`config/thresholds.ts`) raises a **soft** data-quality flag — *"your
spend assumption looks off"* — never **Data stale**. A quiet ledger is a feature: stop logging
and the home stays calm on the assumption's annual review cadence.

**Fact edits (infrequent) — the `/manage` page ("Your setup"):**

Each tab opens with a read table of what's currently saved — live properties (value, valuation
date, rent, primary-residence flag), accounts and holdings, open planned events — above the forms
that change them, so the page is also the inventory of the facts the calculators run on.
Disposed/realised rows are filtered out; nothing is ever deleted underneath.

- **add-later facts**: a new account, holding (with optional open lots) or property (with an
  optional mortgage) opened *after* the baseline carries its own `openingAsOf`/`valuedAt` — the
  derive engine honors per-row baselines, and movements predating an entity's opening are
  rejected. Cost basis for lots is derived server-side, same as in `/setup`.
- a new **property appraisal** ("now worth €320k, June 2026") — there's no market price for an
  apartment, so these are periodic manual revaluations. `data_quality` flags a valuation as stale
  once it's past its expected cadence (e.g. quarterly). The append-only revaluation path for
  properties (and mortgage balances) is being wired into the calculators next — the
  `revaluations` enum already accepts `property`/`liability` rows. (Pension statements live in
  quick-log — they're dated facts, not edits.)
- a changed **assumption** (lower expected return, new spend figure) — the `/manage` assumptions
  tab edits **inline, one row per whitelisted key** (`monthlySpend` ± variants,
  `safeWithdrawalRate`, `expectedReturn`, `longRunInflation`, `inflation`, `interestRate`,
  `birthDate`, `lossCarryForward`, `familyMinimum`), each row carrying a one-sentence description of what the
  number is and which calculator consumes it, its value input and a Save button; unset keys show
  as empty rows (the table is also the checklist), and script-only keys appear after the
  whitelist, read-only. Key-specific sanity ranges still apply (a 35% SWR is a typo, not an
  opinion); the source is always `user (manage)` — no source field. **An assumption edit is an
  upsert: the previous value is replaced — there is no history yet** (the planned `audit_log`
  remains open); setting one resets `lastReviewedAt`, the annual review clock.
  Two keys are **feed-maintained** (`FEED_ASSUMPTION_KEYS`, badged "auto · ECB"): `inflation`
  (Spain HICP annual rate) and `interestRate` (the ECB deposit facility rate) refresh **once a
  month** inside the daily cron from the ECB Data Portal, written with `source: "feed:ecb"`. They
  stay manually editable — a manual value holds until the month rolls over, then the feed takes
  the row back. A feed failure never blocks the daily update; the row simply ages.
  **The return/inflation contract (fire.v2):** `expectedReturn` is your NOMINAL long-run
  portfolio return and `longRunInflation` your long-run inflation FORECAST — that pair feeds the
  real-runway view. The feed-maintained `inflation` row is the current **observation**, kept for
  calibrating the forecast and consumed by no calculator. The committed
  script remains the headless path (same upsert underneath):
  ```
  npx tsx scripts/set-assumption.ts --key safeWithdrawalRate --value 0.035 --source "rule of thumb"
  npx tsx scripts/set-assumption.ts --key birthDate --date 1985-04-09
  npx tsx scripts/set-assumption.ts --key lossCarryForward --value 8000 --source "2024 declaración, casilla 1268"
  ```
  (On the prod host: `docker compose -f docker-compose.server.yml run --rm app_setup npx tsx scripts/set-assumption.ts …` —
  the seed remains the destructive local-only reset.)

  The optional **`lossCarryForward`** assumption is for savings-base losses from
  **before the ledger's opening baseline** — losses inside the ledger are derived automatically by
  replaying disposals. It never expires in-model: review it annually (its freshness cadence) and
  retire it once spent or past the 4-year window.

**"I sold an apartment"** is the `/manage` sell-property flow — one transaction:

- a `deposit` movement records the net cash proceeds (`sell` is reserved for held securities)
- the **property fact** is **soft-closed** (`disposedAt` set) — it stops counting toward net worth
  but is never deleted, so you can still ask about it later (provenance)
- its **mortgage** liabilities close the same way
- one snapshot recompute at the end — never a half-applied state

**Closing things is gated, not warned:** a holding disposes only at exactly zero derived
quantity (log the sale first), and an account closes only with exactly zero derived cash and no
live holdings — a closed account leaves the calculation entirely, so anything left in it would
silently vanish. Nothing is destroyed; the ledger plus the soft-close are the audit trail.

## 3. Predictable future events — "I'll inherit from X", "we'll buy a house in 2028"

These are **forecasts, not facts**: rows in `planned_events`
`{ date, amount, probability, includedInBaseCase }`. They feed scenarios (the Ask layer's "can I
quit in 2027?"), not today's net worth. The `amount` is a **magnitude** — the event *type* owns
the direction in the scenario engine (a house purchase spends cash into a property, a pension
withdrawal moves locked money into cash, an inheritance arrives).

Two switches matter:

- **`includedInBaseCase`** decides whether the event is allowed to prop up the plan. An
  **inheritance is `includedInBaseCase: false`** — it can lift the *optimistic* scenario but never
  the base case (inheritance is never counted in base FIRE). A planned house-purchase *outflow*, by
  contrast, usually *is* in the base case.
- **`probability`** sizes the event within whatever scenario includes it.

Planned events are created and edited on `/manage` (editable freely **until realised** — they're
forecasts, not facts).

When the event actually happens, it **materialises** via the type-specific realise flow on
`/manage` — a forecast never silently becomes a fact; you confirm the real figures, and they land
in **one transaction** with `realisedAt`:

- **inheritance** → an explicit, user-confirmed `deposit` movement
- **pension withdrawal** → an **atomic two-leg transfer**: a `withdraw` on the pension account plus
  a `transfer` into the receiving cash account, sharing a `transferGroupId` and both carrying the
  `plannedEventId` — the pension is actually drawn down, and the rescate feeds the tax estimate's
  general base
- **house purchase** → the `withdraw` that paid for it **plus** the new property fact
  (and optional mortgage)
- **property sale** → routes into the sell-property flow (proceeds deposit + soft-close)
- **job exit** → no ledger row — leaving a job moves no money by itself; review the spend
  assumptions instead
- **rental start** → sets the property's `rentMonthly` (a slow-fact edit, no ledger row)

Movements written by a realisation carry the `plannedEventId`, so the forecast → fact lineage is
queryable later. Planned events are consumed by the scenario engine
([calculators](calculators.md#scenario-engine-scenariots)); `/ask` turns a question about them
into a labelled, cited answer pinned to the strategic snapshot + the exact context it used, saved
to the decision journal.
