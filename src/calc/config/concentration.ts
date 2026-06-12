// Concentration ceilings — versioned like the status thresholds.
// Above a ceiling is a CLASSIFICATION, never a shame: it permits the review to
// recommend (via recommendationTriggers), nothing more. Percent of the named
// denominator.
export const CONCENTRATION_CEILINGS = {
  // One position above this share of investable assets.
  singlePositionPctOfInvestable: 25,
  // One broker account (cash + holdings) above this share of investable.
  singleBrokerPctOfInvestable: 60,
  // Property equity above this share of total net worth.
  realEstatePctOfNetWorth: 65,
  // Spain exposure (property equity + ES-ISIN holdings) above this share of
  // total net worth.
  spainPctOfNetWorth: 70,
} as const;
