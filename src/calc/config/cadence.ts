// How fresh each input type must be before data_quality flags it as stale.
// Versioned config, not magic numbers buried in code.
export type Cadence = "weekly" | "monthly" | "quarterly" | "annually";

export const CADENCE_MAX_DAYS: Record<Cadence, number> = {
  // The feed updates daily; >10 days without a fresh price means it's broken
  // (market holidays and a few missed runs stay within grace).
  weekly: 10, // market prices
  // ~2 months: you can only log a month's spend once it's over, so last month
  // (or this one) still counts as fresh.
  monthly: 62, // monthly spend
  quarterly: 100, // property / pension valuations
  annually: 370, // assumptions (returns, inflation, SWR…)
};
