// Sentinel rendering for planned events. A plan may be recorded before its
// timing or amount is known: a far-future date stands in for "timing unknown"
// and a zero amount for "value not yet decided". These helpers keep the same
// reading across the Picture, the Data workspace and the Markdown pack.

// Any planned-event date on or after this reads as "timing unknown".
export const PLAN_TIMING_UNKNOWN_FROM = "2049-01-01";

// The concrete sentinels written when the user checks "timing unknown" /
// "amount TBD" on a plan, so the UI never asks them to remember a magic value.
export const PLAN_TIMING_UNKNOWN_DATE = "2050-01-01";
export const PLAN_AMOUNT_TBD = "0";

export function isTimingUnknown(date: string): boolean {
  return date >= PLAN_TIMING_UNKNOWN_FROM;
}

export function isAmountTBD(amount: string | number): boolean {
  return Number(amount) === 0;
}
