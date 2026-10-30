// How old a confirmed value may get before the overview asks for a refresh.
// Coarse on purpose: the record needs material accuracy, not bookkeeping.
export const FRESHNESS_DAYS = {
  // Bank / broker cash drifts with spending and interest.
  cash: 100,
  // Pension statements arrive a couple of times a year.
  pension: 200,
  // Units only change when you trade; trades are logged as they happen.
  units: 370,
  property: 370,
  debt: 200,
  otherAsset: 370,
  // Monthly spend and the other planning inputs.
  planningInputs: 370,
  // The daily feed should never fall this far behind; past it the feed is
  // broken, not the market closed.
  marketPrice: 10,
} as const;
