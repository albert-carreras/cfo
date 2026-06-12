// Recommendation-trigger thresholds — versioned and tested. A
// trigger firing is the ONLY thing that permits the monthly review to make a
// recommendation (no trigger ⇒ no recommendation); the concentration ceilings
// in config/concentration.ts are part of the same trigger surface.
export const RECOMMENDATION_TRIGGER_THRESHOLDS = {
  // Liquid cash above this many months of the spend assumption is cash drag.
  // (v1 is instantaneous — the "for M months" persistence refinement needs the
  // snapshot history and is deliberately deferred; see docs/calculators.md.)
  cashDragMonths: 24,
} as const;
