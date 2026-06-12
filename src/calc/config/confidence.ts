// Confidence-score config — versioned like the status/material-change
// thresholds and the tax tables. The score answers "given the inputs, is the
// plan sound?" (principle #7 — distinct from data quality) and must move
// SLOWLY (principle #11): a −40% crash nudges it, never craters it.
export const CONFIDENCE_CONFIG = {
  // Weights of the raw composite. Components whose inputs are missing (e.g. no
  // monthly spend logged ⇒ no runway) are skipped and the rest are reweighted.
  weights: {
    spendCoverage: 0.5, // safe monthly spend vs actual monthly spend
    runway: 0.3, // runway months vs the long-horizon target
    dataQuality: 0.2, // Good / Partial / Poor
  },
  // Runway at or above this many months scores 100 (25 years — a FIRE-length
  // horizon, far above the 18-month action floor in thresholds.ts).
  runwayTargetMonths: 300,
  // How "do we know enough?" maps into the composite.
  dataQualityScores: { Good: 100, Partial: 70, Poor: 30 } as const,
  // EMA half-life in days: a sustained move takes ~a month to show half its
  // size. With daily internal snapshots, one −40% crash day shifts the score
  // by ~2 points, a week by ~5 — a nudge, not a crater.
  halfLifeDays: 30,
} as const;
