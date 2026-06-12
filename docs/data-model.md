# Data model

Source of truth = structured **facts** + an **append-only movement ledger**, every figure
carrying provenance. Static facts enter through the /setup wizard and the /manage
forms (the seed is the dev/test path). Dynamic state comes from the ledger. Drizzle + Postgres.

## Facts (Verified)

- `accounts` — bank / broker (DEGIRO, Trade Republic) / pension / manual. Property is modelled
  separately in `properties`.
- `holdings` — positions (ISIN/ticker, quantity). Revalued by the price feed.
- `tax_lots` — FIFO lots `{ buyDate, quantity, price, fees, fxRate, costBasisEUR }` — needed for
  Spanish FIFO capital-gains (consumed by `taxES`). At setup you enter only your
  **open** lots (purchases not yet sold); closed history isn't needed. The table holds **only the
  opening baseline** — every `buy`/`sell` you quick-log maintains the open-lot set thereafter
  (derived FIFO, like cash and quantity in `deriveState`), so you enter opening lots once and **never
  re-seed**. Tax basis remains available after a holding is soft-closed so its disposal can still be
  calculated. The synthetic fixture backs each broker holding with open lots.
- `properties` — value, purchase price, ownership %, rent, costs, liquidity, emotionalValue,
  isPrimaryResidence, `disposedAt`. A sold property is **soft-closed** (`disposedAt` set), never
  deleted — it stops counting toward net worth but stays for provenance.
- `liabilities` — mortgages `{ rate, balance, payment }`.
- `assumptions` — `{ value, conservativeValue, optimisticValue, source, lastReviewedAt }`
  (returns, inflation, rents, pension access dates…). Date-typed assumptions
  exist alongside numeric ones: a nullable `dateValue` column with a DB check that exactly one of
  `value`/`dateValue` is set. First date-typed key: `birthDate` — the Verified fact the versioned
  `profile` calculator derives age from for the Ask layer's non-sensitive profile summary.
  Date-typed assumptions never enter the calculators or the freshness loop.
- `planned_events` — house purchase / property sale / job exit / pension withdrawal / rental
  start: `{ date, amount, probability, includedInBaseCase }`. **Forecasts, not facts.** The base
  case uses only `includedInBaseCase` events — an inheritance is `includedInBaseCase: false`, so it
  can lift the *optimistic* scenario but never props up the base case (netWorth's rule). When an
  event actually happens it **materialises** into real ledger rows and is marked realised.
  **Consumed by the scenario engine only** (`amount` is a **magnitude** — the event
  *type* owns the direction, scenario.es.2026.6: a purchase spends, a withdrawal/inheritance
  arrives); the base-case calculators still never see them.
- `movements` — **the append-only ledger you feed**: deposit / withdraw / buy / sell / transfer
  / dividend / fee / expense. Current cash/position state is derived from a dated **opening
  baseline** (set at initial setup) plus every movement since — so you never back-fill years of
  history, yet state stays fully derived. A holding's opening quantity is the baseline; `buy` /
  `sell` movements move it thereafter. Rows are never edited, only appended (corrections are new
  rows). Both legs of an own-account transfer (a `withdraw` on the source + a
  `transfer` on the destination) share one `transferGroupId`, written atomically by the quick-log
  transfer path — a transfer cannot create or destroy money via a missing leg. Single-leg
  movements carry a null group id (`transfer` alone remains valid for money arriving from
  outside). A movement written by realising a planned event carries the `plannedEventId` — the
  forecast → fact lineage stays queryable; ordinary movements carry null.
- `revaluations` — **dated value statements**, append-only like the ledger: `{ assetType,
  assetId, value, valuedAt }`. The asset **re-anchors** to its latest effective statement — value =
  statement + movements since `valuedAt` — which is the opening-baseline rule re-applied at a later
  date (movements before the statement date are absorbed by it; a wrong statement is corrected by
  appending a newer one). Generic by design (`assetType` + `assetId`): the enum accepts
  `account` / `property` / `liability`, with `property` (appraisals superseding the opening
  `properties.value`) and `liability` (mortgage-balance statements) being wired into the
  calculators next — only `account` rows are written today, and the quick-log path restricts
  them to **pension** accounts: a pension's value
  is periodically *stated* by the provider, while bank/broker cash is exact and must stay derived
  from the ledger. `data_quality`'s pension freshness reads the latest statement's `valuedAt` —
  without this a pension would go permanently stale because the opening baseline never moves.
- `monthly_spend` — **optional calibration**. The source of truth is the coarse `monthlySpend` **assumption**
  (annual review cadence); logged months only cross-check it — a trailing 6-month average that
  diverges past the versioned ±25% threshold raises a soft data-quality flag, never Data stale.
  You decide what counts as recurring spend; one-off big purchases are excluded by you, not
  guessed. Fine-grained `expense` movements are optional and affect cash; they are deliberately
  **not** the calibration input (non-transfer withdraw legs can be ordinary outflows, and a
  sparsely-logged outflow average would flag falsely).

## Feeds

- `market_prices`, `fx_rates` — cached daily by the feed (upserted on
  `(isin|quote, asOf)`, so each day appends one row and re-runs are safe). Both tables are a
  **running history**: valuation always uses the latest `asOf` per ISIN/quote (ties broken
  deterministically), and the history feeds material-change detection and the slow confidence
  score. `fx_rates.rate` is **EUR per 1 unit of `quote`**. User-visible summaries are deliberately
  batched to the monthly snapshot (see [architecture](architecture.md)).

## Config

- Tax tables — **versioned** (Spain national + Cataluña). Never hardcoded; the version that produced
  a number is shown alongside it. **These ship as versioned config-as-code**
  (`src/calc/config/taxES.es-cat.2026.ts`, version `taxES.es-cat.2026.1`), like the status thresholds —
  this keeps the calculators pure (no DB I/O) and is sourced in-file (Decret-llei 5/2025 for
  Cataluña). A `tax_config` **DB table** is deferred until there's a UI to edit the tables; the data
  model above anticipates it.

## Computed state & history (Calculated)

- `snapshots` — periodic computed results. Two kinds: **strategic** (the monthly user-visible
  snapshot, also promoted immediately after deliberate quick-log input) and **internal** (written
  by the daily feed job). Daily reruns deduplicate by kind/date. History feeds material-change
  detection and the slow confidence score.
- `checks` — the repeat-check log: one **append-only** row each time the calm home is
  looked at (`statusAtCheck`, `checkedAt`). Powers the home's *"You last checked … — no material
  change since"* reassurance line and anchors the monthly digest. Never updated or deleted.
- `data_quality` — completeness + freshness scoring, separate from FIRE confidence:
  ```
  DataQuality {
    id
    score            // Good | Partial | Poor
    missing          // ["May spending", "latest pension value"]
    stalestInputDays
    computedAt
  }
  ```
  `missing` and `stalestInputDays` are computed against an **expected-cadence config** — each input
  type declares how fresh it should be (spend assumption: annually; pension /
  property valuation: quarterly; other assumptions: annually…). An input past its cadence counts
  as `missing` / stale, and a **required** one is what drives the **Data stale** status
  (principles #9). Soft advisory `flags` — spend calibration, and the **negative-cash flag**
  (an account's derived cash below zero — usually a missing movement or a one-legged legacy
  transfer: a warn, never a block) — nudge the score Good → Partial but can never reach Poor or
  Data stale. Pension freshness reads the latest `revaluations` row.

## Decisions & reviews (Judgment)

- `decisions` — **the decision journal**. Every Ask answer is saved so you can later ask *"why
  did I decide not to sell SMH in June?"*. As built:
  ```
  Decision {
    id
    question
    answer                // the validated AskAnswer: labelled statements + citations (jsonb)
    context               // the EXACT AskContext sent to the model, metrics with rendered values included (jsonb)
    assumptions           // the assumption rows the model saw (jsonb)
    snapshotId            // FK → snapshots.id (restrict on delete, cascades across the same-day dedupe id rewrite)
    chosenAction
    requiresManualReview  // deterministic gate OR the model's flag (see principles #6)
    reviewedAt
    model                 // provenance of the Judgment (e.g. "gpt-5.5")
    createdAt
  }
  ```
  The planned `calculatorSnapshotIds` array collapsed to a single `snapshotId`: every calculator
  output in one strategic snapshot shares one id. Because the same-day snapshot row can be
  *replaced* by the dedupe upsert, the decision's immutable evidence is the embedded `context` —
  the FK is a live pointer, the jsonb is the record. Append-only in spirit: rows are never edited
  except the once-only review path (`markReviewed` sets `reviewedAt`/`chosenAction` only while
  `reviewedAt is null`). A changed mind is a new question.
- `settings` — app-level switches (`key` unique, `value`), currently unused. The Sensitive-mode
  switch (its first key) was removed in June 2026: the tailnet plus removing the provider key is
  the privacy boundary now, and a stale `sensitiveMode` row may remain and is ignored.
- `reviews` — **the monthly review log**: one append-only row per month,
  written by the scheduled `/api/cron/review` job. As built:
  ```
  Review {
    id
    month             // "YYYY-MM", unique — re-runs are no-ops
    scope             // "full" (the analyst ran) | "deterministic" (the no-AI floor)
    snapshotId        // FK → snapshots.id (restrict on delete, cascades across the dedupe rewrite)
    summary           // SnapshotSummary — the baseline the NEXT review compares against (jsonb)
    materialChange    // MaterialChangeValue vs the LAST review (jsonb)
    taxTableVersion   // the versioned tables on record this month
    report            // the validated ReviewReport: digest, findings, tax verdict (jsonb, null when deterministic)
    context           // the EXACT ReviewContext sent to the model (jsonb, null when no model ran)
    model, llmError   // Judgment provenance / why a full review fell back to the floor
    decisionId        // FK → decisions.id when the review carried a recommendation
    outcomes          // CalcResult<DecisionOutcomesValue> — every journaled decision re-measured (jsonb, null on legacy rows)
    firedTriggers     // this month's fired recommendation triggers, pinned (jsonb, null on legacy rows)
    createdAt
  }
  ```
  Like `decisions`, the embedded jsonb is the immutable record and the FK a live pointer. A
  review's regulatory findings and tax-table verdict are **sourced Judgment** (external URLs
  required by validation); its digest follows the Ask rules (metric tokens, citations); its
  recommendation, if any, is journaled as a manual-review-gated Decision — see the
  Review analyst in [ai-analyst.md](ai-analyst.md). `outcomes` and `firedTriggers` are part of
  the **deterministic floor**: written with the row in both scopes, so the
  accountability loop and the "no triggers fired, nothing to recommend" record survive
  a provider outage. `reviews.decisionId` stays **singular on purpose** — one recommendation per
  monthly review is a structural cap, not a convention.
- `pictures` — **the standing reassurance narrative** (`/picture`): one append-only row per
  (re)generation — promotion-triggered or manual refresh; latest wins, never edited. As built:
  ```
  Picture {
    id
    scope             // "full" (the voice ran) | "deterministic" (the no-AI floor)
    snapshotId        // FK → snapshots.id (restrict on delete, cascades across the dedupe rewrite)
    summary           // SnapshotSummary at generation time (jsonb)
    derived           // CalcResult<PictureValue> — the picture.v1 ratios, the floor (jsonb)
    narrative         // the validated PictureNarrative: sectioned, labelled statements (jsonb, null when deterministic)
    context           // the EXACT PictureContext sent to the model (jsonb, null when no model ran)
    model, llmError   // Judgment provenance / why a full narrative fell back to the floor
    createdAt
  }
  ```
  `summary` + `derived` are pinned in **both scopes** — the page's deterministic floor renders
  from the row, never recomputed against drifted facts. See "The picture" in
  [ai-analyst.md](ai-analyst.md).
- `notifications` — material-threshold events only, batched. No daily market noise.

## Audit

The movement ledger is database-enforced append-only; corrections are new rows. Snapshot results
retain calculator provenance. A separate `audit_log` for editable-fact changes stays on the
[backlog](roadmap.md).

## Provenance

Every Calculated figure references the snapshot + the underlying fact/movement/price rows it was
derived from, so the UI can always answer "where did this number come from?".
