# Calculators — the trust core

Pure TypeScript functions in `src/calc/*`, each with Vitest tests. Deterministic. Each returns
typed JSON tagged with `snapshotId`, `source`, and `version`. **The LLM consumes these; it never
recomputes or invents them.** This is the part that must be boringly reliable before any voice
is added.

Open items live in the [roadmap backlog](roadmap.md).

| Calculator | File | Notes |
|---|---|---|
| Valuation | `valuation.ts` | holdings × cached price × FX → asset values |
| Net worth | `netWorth.ts` | liquid / investable / locked / illiquid / total / **FIRE-counted** (inheritance never in base FIRE). Account cash may **re-anchor** to a dated revaluation in `deriveState` (pension statements) — value = latest statement + movements since its date |
| FIRE | `fire.ts` | runway years + safe monthly draw, computed from the coarse `monthlySpend` **assumption** with optional conservative/optimistic runways. The **bands** (`fire.2026.3`): conservative/base/optimistic recomputes of the same arithmetic under versioned stress parameters (`config/fireBands.ts` — spend multiplier, SWR delta, asset haircut; an entered conservative/optimistic spend assumption beats the multiplier), plus the base plan's **explicit failure modes** — the spend rise %, pile drop % and SWR floor that break "spend fits the safe draw". Deterministic recomputes, no Monte Carlo; the pile is never marked up. `fire.v2` (`fire.2026.4`) adds the **real view**: closed-form depletion `n = −ln(1 − P·g/S)/ln(1+g)` at the real monthly rate derived from the NOMINAL `expectedReturn` and the `longRunInflation` FORECAST assumptions (the ECB-fed `inflation` row is an observation, never consumed) — omitted entirely unless both plus a positive spend are set; `sustainable` when `P·g ≥ S`. The 0%-growth runway stays the headline and the bands stay ungrown. Also the **actual withdrawal rate** (spend·12 / fireCounted), comparable to the SWR |
| Data quality | `dataQuality.ts` | completeness + freshness scoring; separate from FIRE confidence. **Soft advisory flags** (spend calibration, negative cash) downgrade Good → Partial, never Poor, so they can never flip Data stale; pension freshness reads the latest **revaluation** |
| Spend calibration | `spendCalibration.ts` | the optional monthly-spend log vs the assumption: trailing 6-month average (min 3 logged months); divergence past ±25% (`config/thresholds.ts`) ⇒ a soft data-quality flag, never Data stale |
| Status engine | `status.ts` | latest snapshot → one status (Stable / Review soon / Action recommended / Urgent / **Data stale**); deterministic, versioned, tested thresholds — the load-bearing calc behind the calm surface, including the overspend rules |
| Tax — Spain + Cataluña | `taxES.ts` | FIFO ETF gains (date-guarded: a disposal only consumes lots with `buyDate ≤ disposal date`), the **2-month wash-sale deferral** (deferred loss rides on the repurchase lots' basis; homogeneity = same holding), savings-income bands, **personal/family minimums** credited at the bottom of the scales (state 5,550 €; Cataluña 6,105 € under a 12,450 € total base; family minimums via the optional `familyMinimum` assumption; the unabsorbed state minimum credits the savings scale), realised **pension withdrawals** into the general base, rough rental income, the **4-year loss carry-forward** (derived from the ledger), **wealth tax** (IP, Cataluña scale + the IRPF–IP límite conjunto), and the config-driven **exclusions** printed on the card. Versioned per year, selected via `config/taxRegistry.ts` |
| Material change | `materialChange.ts` | (last strategic snapshot, current state) → material or not; the deterministic firewall behind "No material change since …", with a second threshold on the liquid+investable pile (`fireCountedEUR`) |
| Confidence (slow) | `confidence.ts` | gap-aware EMA (30-day half-life) over the internal snapshot history; composite of safe-spend coverage · runway vs target · data quality. A −40% crash nudges it, doesn't crater it |
| Decision outcomes | `decisionOutcome.ts` | the accountability loop: each journaled decision's pinned snapshot summary vs the current one — Δ net worth, Δ runway, status then → now. Pinned on every review row; the track record's math |
| Concentration | `concentration.ts` | position % of investable · single-broker % · RE equity % · Spain exposure vs versioned ceilings (`config/concentration.ts`). Classifies, never shames. Tech look-through stays on the backlog |
| Property yield | `propertyYield.ts` | **unlevered** gross/net yield per property + the real comparison vs the assumed ETF return (`propertyYield.2026.1`): real net yield and `(1+expectedReturn)/(1+longRunInflation) − 1`, gap sign-aware. Unlevered on purpose — financing/owner equity not modelled; the ETF side is the user's assumption, never a prediction. Rides the sell-property scenario cards and `scenario.N.*Yield*` Ask tokens |
| Real estate (rest) | `realEstate.ts` | backlog: return on equity with mortgage interest · liquidity penalty · life-utility (sale tax + rough plusvalía live in the scenario engine) |
| Tax — solidarity / plusvalía detail | `taxES.ts` (extend) | backlog: ISGF · detailed RE-gain · legal IP valuation basis — what remains out is printed on the card |

## Contract

```ts
type CalcResult<T> = {
  snapshotId: string;   // ties the output to a point-in-time set of facts
  value: T;             // the typed numbers
  source: string;       // e.g. "netWorth.v1"
  version: string;      // e.g. "taxES.es-cat.2026"
  inputs: string[];     // ids of the facts/movements/prices it used (provenance)
};
```

## Status engine (`status.ts`)

The calm surface is only as trustworthy as the rule that produces it, so the status is a
**deterministic, tested calculator** — not UI logic. It maps the latest snapshot to exactly one
status, in **priority order** (first match wins):

1. **Data stale** — a required input is past its expected cadence, or data quality is Poor. Takes
   precedence over everything: if we don't know enough, we say so rather than computing a confident
   status (principles #7, #9). The spend input is the `monthlySpend` **assumption**
   on its **annual** review cadence — a quiet monthly-spend ledger can no longer flip the home to
   Data stale, and the soft calibration flag is structurally barred from it.
2. **Urgent** — runway below a hard floor (< 6 months of spend), or a liability the plan can't
   cover.
3. **Action recommended** — a threshold broke that warrants action: runway below the comfortable
   18-month floor, or (**overspend — "base-case FIRE no longer holds"**) the spend assumption
   above the safe monthly spend by more than the versioned tolerance (`overspendTolerancePct`,
   10%). Irreversible actions are held behind the manual-review lock (principles #6).
4. **Review soon** — the spend assumption above the safe monthly spend but **inside** the
   tolerance band, a scheduled review due, or a soft threshold / material change crossed.
5. **Stable** — nothing material changed since the last snapshot.

Thresholds live in `config/thresholds.ts`, versioned like the tax tables, and covered by tests.
The inputs are net worth + runway + the spend assumption vs the safe monthly draw + data
quality plus the review-due cadence; material change gates the promotion flows around it. The
confidence score is deliberately **not** a status input — it is its own slow signal on the
home and reviews pages, so a soft score can't flip the calm surface. Status reasons speak in years
and percent, never cents (principle #12: **coarse by design** — the same rule rounds every
user-facing amount to ~3 significant figures and presents runway in years, while full precision
stays in the calculators and the provenance depth).

## Material change (`materialChange.ts`)

The rule that decides whether the calm surface is allowed to move. Compares the **last
strategic snapshot** against the **current** computed state and returns
`{ material, changes[], netWorthDeltaPct, comparedTo }`. Material when (thresholds in
`config/thresholds.ts`, versioned and tested):

- **net worth moved ≥ 5%** in either direction, or
- **the liquid+investable pile (`fireCountedEUR`) moved ≥ 5%** in either direction (property
  equity dilutes the total, so a 12% equity crash inside an RE-heavy portfolio could
  previously fail to move the surface on exactly the event it should move on; the check skips
  quietly against older stored summaries that lack the field), or
- **runway crossed below the 18-month action floor** (crossing, not sitting below — an
  already-low runway doesn't re-fire daily), or
- **status worsened into the action band** (`action_recommended` / `urgent`); cadence
  churn (`review_soon`, `data_stale`) is handled by its own flows and is *not* material, or
- **no strategic snapshot exists yet** (bootstrap).

The daily feed job uses it to promote an off-cycle strategic snapshot; the home page uses
it for the *"No material change since …"* line. Like `status.ts` it is a meta-calc over
snapshot outputs — provenance lives in the snapshot ids it compares.

## Confidence — the slow score (`confidence.ts`)

Answers **"given the inputs, is the plan sound?"** — deliberately distinct from data quality's
"do we have enough fresh inputs?" (principle #7), and deliberately **slow** (principle #11). Like
`status.ts` and `materialChange.ts` it is a meta-calc over snapshot outputs: the caller passes the
**internal snapshot history** (the daily job's accumulation) plus the current snapshot, and
provenance is the snapshot ids it smoothed over.

Today's raw composite (weights in versioned `config/confidence.ts`):

- **safe-spend coverage** (0.5) — safe monthly spend ÷ the spend assumption, capped at 1
- **runway** (0.3) — runway months vs a 300-month (25-year) target
- **data quality** (0.2) — Good 100 / Partial 70 / Poor 30

Components whose inputs are missing (no spend assumption ⇒ no runway) are skipped and the rest
reweighted — a missing input is data quality's job to flag, not a reason to crater plan soundness.

Smoothing is a **gap-aware EMA with a 30-day half-life**: each observation pulls the score toward
today's raw composite by an amount that grows with the days elapsed, so sparse histories decay
identically to daily ones and same-day duplicates change nothing. One −40%-crash day moves the
score ~2 points; a sustained crash shows half its size after a month. Tested in
`src/tests/unit/confidence.test.ts`.

## Tax engine (`taxES.ts`)

A Spanish income-tax **planning estimate** for a Cataluña resident. Two distinct bases — the spine
of Spanish IRPF — never blurred:

- **Savings base** (`base del ahorro`): FIFO capital gains + dividends + interest. Taxed on the
  **state-only** savings scale (19/21/23/27/30%); the same in every CCAA — Cataluña does not modify
  it.
- **General base** (`base general`): pension withdrawals (treated as general income on withdrawal) +
  net rental + any other general income. Taxed as `stateScale(base) + catalunaScale(base)` (both
  progressive scales applied to the same base).

Pieces:

- **FIFO capital gains** — lots are **derived from the ledger** (`realizedCapitalGains`): the opening
  `tax_lots` baseline **+ every `buy`** (each opens a lot) form the FIFO queue, and **every `sell`**
  consumes it oldest-first (gain = proceeds − matched cost basis; partial lots leave a residual).
  A lot only matches when its `buyDate ≤ the disposal date` — a sell never consumes a future
  purchase (future repurchases still count for the wash-sale window, where they belong).
  All sells replay in date order, but only the snapshot year's disposals feed the savings base. So
  `tax_lots` holds only your **opening** lots — the buys/sells you quick-log maintain everything
  after, exactly like cash and share counts in `deriveState`. **You enter opening lots once and never
  re-seed.** (Cost basis of a buy = the EUR amount paid; fees folded into the amount, and non-EUR buys
  logged at their EUR cost — rough model.)
- **Rough rental model** — `rentalIncome`: `net = (rent − costs) × 12 × ownership%`; positive net
  uses a deliberately conservative **50% vivienda reduction** (→ 50% taxable), while a loss passes
  through unreduced. Primary
  residence and unrented properties are skipped.
- **Pension withdrawal** — added to the general base. **Derived from the ledger** (`2026.5`): every
  `withdraw` leg on a **pension-type** account in the tax year counts as a rescate (realising a
  pension-withdrawal event writes exactly that, as an atomic two-leg transfer into cash).
  *Hypothetical* withdrawals stay 0 in the base case (irreversible action behind the manual-review
  lock, principle #6) — they live in scenarios.
- **Loss carry-forward** — `lossCarryForward`: Spanish savings-base losses carry
  forward **four tax years**, and the whole history is **derived by replaying the ledger's
  per-disposal gains year by year** — no stored tax state, so corrections to old movements reprice
  the carry-forward automatically. Prior years consume the pool oldest-first with their net realized
  gains; what survives the 4-year window reduces this year's savings base (never below 0), and the
  remainder + anything expired is reported on the card. Losses from **before the ledger's opening
  baseline** enter via the optional `lossCarryForward` **assumption** (consumed first; it never
  expires in-model — it's on the assumption's annual review cadence and is retired by the user).
- **Wealth tax (IP)** — `wealthTaxES`, folded into the same `taxES` result and the same
  card. The base is the snapshot's **net worth** minus the modelled exemptions: the **pension pile**
  (the snapshot's `lockedEUR`) and up to **€300k of the owner's share of the primary residence**;
  then the Cataluña **€500k mínimo exento** and the autonomic scale (0.21% → 3.48%,
  `config/taxIP.es-cat.2026.ts`, anchored against the published cuota table in
  `src/tests/unit/taxIP.test.ts`). The **límite conjunto** (art. 31) is modelled in simplified form:
  IRPF quota + IP quota are capped at **60% of the IRPF bases**, and the IP reduction is capped at
  **80% of itself** (at least 20% is always due) — the >1-year-gains carve-out is *not* modelled and
  is printed as an exclusion. Valuation is the snapshot's (purchase price for property, latest
  market price for positions), not the legal max-of-three / 31-Dec basis — also printed.

The tables are **versioned config-as-code** (`src/calc/config/taxES.es-cat.2026.ts`, version
`taxES.es-cat.2026.5`, plus `src/calc/config/taxIP.es-cat.2026.ts`, version `taxIP.es-cat.2026.1`)
— not a DB table — so the calculator stays pure and the version travels with every figure
(principle #10). The snapshot selects them **by tax year** through `config/taxRegistry.ts`
(`selectTaxConfigs`): the exact year's tables when they exist, else the latest available year —
the fallback feeds the soft "tax tables stale" flag, and the estimate keeps the selected config's
own year/version label (a 2027 snapshot computed under 2026 tables says so, it is never
relabelled). Adding a year = a sibling config file + one registry entry. Source-cited in the configs (Decret-llei 5/2025 for Cataluña IRPF; Decreto
Legislativo 1/2024 + Decret-llei 10/2024 for the IP scale).

Their **currency** is guarded two ways: a **deterministic** `data_quality` flag
when the tables don't cover the current tax year (year-rollover) or pass the annual review cadence —
a **soft, non-required** flag, because stale tables make the tax *estimate* stale, not net worth —
and the monthly review's regulatory re-verification (both versions ride in
`review.taxTables`), which may *propose* a versioned bump (never auto-applied).

**The card states its exclusions** (principle #10: show the source, not a disclaimer): the lists
live in the configs (`exclusions` on both), travel in `TaxESValue.exclusions`, and render as fine
print next to the number. Currently out of scope and printed as such: **ISGF** (only bites above
€3M net and paid IP is fully deductible against it), detailed plusvalía, wash-sale homogeneity
beyond the same holding, family minimums not entered via the `familyMinimum` assumption
(descendants/ascendants are never derived), the legacy 40% pre-2007
pension-lump-sum reduction, mortgage-interest & depreciation deductions on rentals, withholding
already paid on dividends/interest (estimates run on the net cash logged), the legal IP valuation
basis, and the 25% dividend/interest cap on loss offsets.

## Scenario engine (`scenario.ts`)

The counterfactual layer — the actual gestor's numbers. A **scenario is a pure, versioned
transform over `SnapshotFacts`**: transform the facts, recompute the **full snapshot** over them,
and emit the **diff** (Δ net worth, Δ fireCounted, Δ runway, Δ safe spend, Δ tax-year estimate,
status before/after). Provenance = the base `snapshotId` + the fact ids the scenario touched;
version `scenario.es.2026.3` (`config/scenarios.ts`). The voice may narrate and compare these —
it never originates them (invariant #2). Every scenario prints its **exclusions** next to its
figures (principle #10).

- **Sell a property** — gross owner share − selling costs (5%, config) − mortgage repaid −
  marginal savings-scale CG tax on `(value − purchasePrice) × share − costs` − **rough plusvalía**
  (a flat 5% of the positive gain — decided over the cadastral coefficient method; the detailed
  model stays in the backlog). Net proceeds land in cash via a synthetic asOf movement (so
  revaluation re-anchors can't swallow them). **No recorded purchase price — including a
  non-positive one (a defaulted 0 must never read as a 100% gain) ⇒ the tax shows as *unknown*,
  never 0.** And unknown tax never reads as 0 in the *numbers* either (**2026.7,
  `basisIncomplete`**): proceeds and the net-proceeds row go null, the variant recomputes with the
  pre-tax proceeds, and every Δ is explicitly labelled an **upper bound** — on the card ("basis
  missing" badge), in the exclusions (first line) and on the Ask token's label. On the
  **primary residence** the IRPF gain is assumed exempt (reinvestment in a new
  vivienda habitual or the over-65 exemption) — CG tax 0, plusvalía still estimated, the
  assumption printed in the exclusions (2026.2). The card carries the **unlevered yield vs
  assumed-ETF comparison** (`propertyYield.v1`, 2026.4) with its own exclusion line.
  Irreversible → manual-review-gated wherever the voice touches it.
- **Sell a position (at once vs spread)** — reuses the FIFO engine over the position's open lots
  (the same ledger replay the tax estimate uses). The at-once variant is a synthetic `sell`
  movement, so the variant snapshot's own tax estimate picks the gain up deterministically (net
  worth today is unchanged; the year's tax rises). The spread variant tranches the sale over
  `positionSpreadYears` (3) calendar years at today's price, FIFO continuing across tranches,
  year one taxed marginally on top of this year's savings base, later years standalone — the
  per-year table plus the at-once/spread tax saving is the decision's number. **2026.5 adds the
  GROWN spread variant**: tranche i priced at `price·(1+expectedReturn)^i` (whole-year, rough),
  with a **neutral, possibly negative** delta vs at-once ("saves"/"costs more" by sign). The
  0%-growth fields stay as the comparison, and the at-once leg / headline diff never grow — the
  assumption only ever feeds the clearly-labeled extra view.
- **Planned events** — finally consume `planned_events`: the **base case applies only
  `includedInBaseCase` events** (netWorth's rule), **optimistic adds the rest at face value**
  (probabilities deliberately not weighted — listed as an exclusion). Realised events never
  re-apply. Not irreversible (forecasts, not actions). 2026.5: each row gains a
  **today's-purchasing-power illustration** at the `longRunInflation` assumption
  (`yearsUntil = max(0, days)/365.25`; a past-dated unrealised event discounts by factor 1) —
  **headline totals remain undiscounted face values**, stated in the exclusions.
  **2026.6: direction by event type** — the entered amount is a magnitude; the type owns the
  sign, mirroring what realisation would write. A **house purchase** is a wealth-neutral
  cash→synthetic-property swap (net worth flat, fireCounted/runway honestly down); a **pension
  withdrawal** is a pension→cash transfer (net worth flat, fireCounted up, and the variant's tax
  estimate counts the rescate); an **inheritance** stays a cash inflow; a **property sale**
  models the cash side only (stated — the forecast isn't linked to a property fact; the
  sell-property scenario owns the full swap); **job exit / rental start** move nothing (null
  rows). Amounts apply as of today regardless of the event date — stated in the exclusions.

The **standard decision set** is computed inside `computeSnapshot` (one scenario per live
property, per held priced position, plus the two planned-event views) and stored on the strategic
snapshot — the Ask layer and the `/detail` decision cards read it from there. Scenario variants
recompute with `withScenarios: false`, so counterfactuals never nest.

## Concentration (`concentration.ts`)

Where the pile clusters, classified against versioned ceilings (`config/concentration.ts`):
single position > 25% of investable, single broker (cash + holdings) > 60% of investable,
real-estate **equity** > 65% of net worth, Spain exposure (property equity + ES-ISIN holdings)
> 70% of net worth. **Classifies, never shames** — `above: true` is a fact, not an alarm; its only
consequence is permitting the review to talk about it. Empty piles classify nothing. VWCE tech
look-through stays backlog.

## Recommendation triggers (`recommendationTriggers.ts`)

The deterministic conditions that **permit** the monthly review to recommend anything. **No fired
trigger ⇒ no recommendation** — enforced in the review's answer validation (fail-closed, including
for stored snapshots predating the scenario engine), so the model can never originate a recommendation from browsing
the portfolio. Versioned thresholds in `config/recommendationTriggers.ts`:

- any **concentration** dimension above its ceiling (one trigger per dimension);
- **cash drag** — liquid cash above 24 months of the spend assumption (v1 is instantaneous; the
  "for M months" persistence refinement needs the snapshot history and is deliberately deferred);
- **overspend** — the spend assumption above the safe monthly draw (the same condition that moves
  the status; here it only permits the review to address it);
- **harvestable losses** — positions below their remaining FIFO basis while the year carries
  realized gains they could offset.

A month with no fired trigger produces a review that says so — informative silence —
the fired list is **pinned on the review row** (`fired_triggers`), so the silence is on the
record, not inferred from absence.

## Decision outcomes (`decisionOutcome.ts`)

The accountability loop's arithmetic: every journaled decision re-measured against the current
snapshot. Input is the decision's **pinned** `SnapshotSummary` ("then" — reconstructed from the
snapshot row the decision points at) and the current one; output per decision is Δ net worth
(EUR and %, null % on a zero base), Δ runway months (null when either side is unknown) and
status then → now, plus the decision's review state (`reviewed`, `chosenAction`). Oldest first;
`inputs` carry the decision ids as provenance.

Deliberately boring: pure subtraction over two summaries the user can already see. The deltas
are **Calculated**; what they mean — how much was the decision vs the market — stays a
**Judgment** for the review's voice ([ai-analyst](ai-analyst.md)), which can only reference the
measured deltas via positional `decision.N.*` metric tokens. The monthly review pins the result
on its row (both scopes, the deterministic floor included); the ask page recomputes it live against
today's state and shows it beside each journalled answer as that decision's track record.

## Why built in this order
The trust core shipped deliberately small first — valuation + net worth + basic FIRE + data
quality — with full Spanish tax, wealth tax, scenarios and the confidence score layered on only
once the ledger → valuation → net worth → status loop was boringly correct. Too much surface area
at once produces a messy skeleton; the same discipline applies to anything still on the
[backlog](roadmap.md).
