// `source` = calc name + major version; `version` = the dated config/table
// version that produced the number (shown alongside it in the UI). Bump these
// deliberately when a formula or threshold changes.
export const VERSIONS = {
  valuation: { source: "valuation.v1", version: "valuation.2026.1" },
  // netWorth.2026.2: account cash may re-anchor to a dated
  // revaluation (pension statements) — value = latest statement + movements
  // since its date.
  netWorth: { source: "netWorth.v1", version: "netWorth.2026.2" },
  // fire.2026.2: spend comes from the monthlySpend ASSUMPTION (the
  // monthly log became optional calibration) + conservative/optimistic runways.
  // fire.2026.3 (backlog): conservative/base/optimistic BANDS — a stressed
  // recompute under config/fireBands.ts (spend multiplier, SWR delta, asset
  // haircut) — plus the base plan's explicit failure modes (spend rise %,
  // asset drop %, SWR floor).
  // fire.v2 / fire.2026.4 (2026-06): the REAL view — closed-form depletion at
  // the real return derived from the nominal expectedReturn + longRunInflation
  // assumptions (omitted unless both + a positive spend are set) — plus the
  // actual withdrawal rate (spend·12 / fireCounted). The 0%-growth runway
  // remains the headline; the bands stay ungrown.
  fire: { source: "fire.v2", version: "fire.2026.4" },
  // dataQuality.2026.2: soft advisory flags (spend calibration); the
  // spend input moved from required-monthly to the assumption's annual cadence.
  // dataQuality.2026.3: pension freshness reads the latest dated
  // revaluation (not the immovable opening baseline); negative account cash
  // raises a soft flag.
  dataQuality: { source: "dataQuality.v1", version: "dataQuality.2026.3" },
  // status.2026.1: overspend rules (spend assumption vs safe spend).
  status: { source: "status.v1", version: "status.2026.1" },
  // The tax tables themselves are versioned in config/taxES.es-cat.2026.ts; this
  // mirrors that version so it shows in the provenance block like the others.
  // taxES.es-cat.2026.2: the 4-year loss carry-forward reduces the
  // savings base; wealth tax (config/taxIP.es-cat.2026.ts, with the IRPF–IP
  // límite conjunto) folds into totalTaxEUR; exclusions are config-driven.
  // taxES.es-cat.2026.3 (backlog): the 2-month wash-sale deferral in the FIFO
  // engine + personal/family minimums credited at the bottom of the scales.
  // taxES.es-cat.2026.4 (2026-06-12): FIFO matching skips lots bought after
  // the disposal date — a sell can never consume a future purchase (the
  // wash-sale window still sees future repurchases, as intended).
  // taxES.es-cat.2026.5 (2026-06-12): realised pension withdrawals (withdraw
  // legs on pension accounts in the tax year) feed the general base;
  // realisation writes them as atomic two-leg transfers.
  taxES: { source: "taxES.v1", version: "taxES.es-cat.2026.5" },
  // materialChange.2026.1: second threshold on the liquid+investable
  // pile (fireCountedEUR) — property equity no longer dilutes an equity crash.
  materialChange: { source: "materialChange.v1", version: "materialChange.2026.1" },
  confidence: { source: "confidence.v1", version: "confidence.2026.0" },
  // The Ask layer. `profile` derives age from the birthDate
  // assumption; `ask` versions the deterministic guardrails around the voice
  // (context assembly, answer validation, the manual-review gate).
  profile: { source: "profile.v1", version: "profile.2026.0" },
  // ask.2026.1: scenario diffs join the metric tokens; the
  // instructions point decision questions at them.
  // ask.2026.2 (2026-06): fire.v2 real-view tokens (realRunwayYears,
  // realReturnAnnual, actualWithdrawalRate); assumption-driven metrics cite
  // the consumed assumption rows explicitly.
  // ask.2026.3 (2026-06): sell-property yield tokens (scenario.N.
  // realNetYieldPct / etfRealReturnPct / realYieldGapPct, propertyYield.v1).
  // ask.2026.4 (2026-06): scenario.N.spreadTaxDeltaGrownEUR (sign-aware grown
  // spread delta, scenario.es.2026.5).
  // ask.2026.5 (2026-06-12): basisIncomplete scenarios label their Δ-net-worth
  // token "(before unknown sale taxes — upper bound)" (scenario.es.2026.7).
  ask: { source: "ask.v1", version: "ask.2026.5" },
  // The scheduled review analyst's deterministic guardrails
  // (review context, report validation, the deterministic-floor fallback).
  // review.2026.1: a recommendation is only permitted when a
  // deterministic trigger fired — enforced in validation, fail-closed.
  // review.2026.2: decision outcomes + the fired triggers are pinned
  // on every review row (both scopes); the report gains a "decisions
  // revisited" section validated under the Ask rules.
  review: { source: "review.v1", version: "review.2026.2" },
  // The accountability loop: each journaled decision's pinned
  // snapshot summary vs the current one (Δ net worth, Δ runway, status
  // then → now). Pure arithmetic over two summaries — the deltas are
  // Calculated; what they mean stays a Judgment for the review's voice.
  decisionOutcome: {
    source: "decisionOutcome.v1",
    version: "decisionOutcome.2026.1",
  },
  // Unlevered property yield vs the assumed real ETF return (2026-06) — the
  // deterministic half of "keep this flat?". No tunables beyond the two
  // assumptions, so the version lives only here.
  propertyYield: { source: "propertyYield.v1", version: "propertyYield.2026.1" },
  // The scenario engine (counterfactual diffs over the snapshot; the
  // version mirrors config/scenarios.ts), the concentration classifier and the
  // deterministic recommendation triggers that gate the review's opinions.
  // scenario.es.2026.6 (2026-06-12): planned events apply with each type's
  // inherent direction (house purchase = cash→property swap, pension
  // withdrawal = pension→cash transfer with the rescate taxed, property sale
  // = cash side only, job exit/rental start move nothing).
  // scenario.es.2026.7 (2026-06-12): a sell-property without a recorded
  // purchase basis goes basisIncomplete — null proceeds, Δ labelled an upper
  // bound; unknown taxes never read as 0.
  scenario: { source: "scenario.v1", version: "scenario.es.2026.7" },
  concentration: { source: "concentration.v1", version: "concentration.2026.1" },
  // The picture (standing reassurance narrative): the derived ratios the
  // narrative may reference — bucket shares of net worth, spend headroom vs the
  // safe draw, coarse runway. The voice never computes a percentage itself.
  picture: { source: "picture.v1", version: "picture.2026.0" },
  recommendationTriggers: {
    source: "recommendationTriggers.v1",
    version: "recommendationTriggers.2026.1",
  },
} as const;
