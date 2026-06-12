// Scenario-engine config — the rough, versioned parameters behind
// the sell-a-property and sell-position counterfactuals. Versioned like the
// tax tables: every scenario output carries this version, and a change here is
// a deliberate, dated bump. The numbers are deliberately ROUGH — each scenario
// prints its exclusions next to its figures (principle #10).
export const SCENARIO_ES_2026 = {
  // 2026.2 (2026-06-11): primary-residence CG exemption assumed on the
  // sell-property scenario; a non-positive purchase price now reads as
  // "no basis recorded" (unknown tax), never as a 100% gain.
  // 2026.3 (2026-06-11): the sell-position FIFO replays apply the 2-month
  // wash-sale deferral from the tax config (taxES.es-cat.2026.3).
  // 2026.4 (2026-06-11): the sell-property card carries the unlevered
  // property-yield-vs-assumed-ETF comparison (propertyYield.v1) with its
  // exclusion line; no parameter changed.
  // 2026.5 (2026-06-12): the GROWN spread variant — future tranches priced at
  // today's price grown at the nominal expectedReturn assumption (whole-year
  // exponent, rough), neutral delta vs at-once that may be negative; the
  // at-once leg and the headline diff stay at today's price. Planned-event
  // rows gain a today's-purchasing-power illustration at longRunInflation
  // (yearsUntil = max(0, days)/365.25); headline totals stay undiscounted.
  // 2026.6 (2026-06-12): planned events apply with each type's inherent
  // direction — house purchase = cash→property swap (wealth-neutral, runway
  // drops), pension withdrawal = pension→cash transfer (rescate taxed in the
  // variant), property sale = cash-side only (stated), job exit/rental start
  // move nothing; inheritance stays an inflow. Previously every event was
  // added as positive cash, so a purchase read as a windfall.
  // 2026.7 (2026-06-12): a sell-property with no recorded purchase basis no
  // longer treats the unknown taxes as 0 — proceeds go null (basisIncomplete),
  // the variant recomputes pre-tax, and every Δ is labelled an upper bound.
  version: "scenario.es.2026.7",
  // Selling costs on a property sale (agency ~3% + notary/registry/fees),
  // applied to the gross owner-share sale value.
  propertySaleCostsRate: "0.05",
  // Rough plusvalía municipal: a flat share of the POSITIVE capital gain.
  // Decided over the exact cadastral coefficient method (which needs the
  // cadastral land value + years held) — the detailed model stays in the
  // backlog; this estimate is labelled rough wherever it appears.
  plusvaliaRateOfGain: "0.05",
  // Sell-position spread: how many calendar years the spread variant tranches
  // the sale over (year one sells at asOf, later tranches mid-year).
  positionSpreadYears: 3,
} as const;
