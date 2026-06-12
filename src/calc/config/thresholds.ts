// Status thresholds — versioned like the (future) tax tables and covered by
// tests. The calm surface is only as trustworthy as these numbers.
export const STATUS_THRESHOLDS = {
  // Runway below this hard floor is Urgent (months of spend the assets cover).
  urgentRunwayMonths: 6,
  // Below this comfortable floor warrants action.
  actionRunwayMonths: 18,
  // A strategic snapshot older than this is "Review soon".
  reviewDueDays: 35,
  // Overspend: the spend ASSUMPTION above safe monthly spend by more
  // than this tolerance ⇒ Action recommended; above safe but inside the band ⇒
  // Review soon. This is the "base-case FIRE no longer holds" rule.
  overspendTolerancePct: 10,
} as const;

// Spend calibration: the optional monthly-spend log, compared against
// the spend assumption. Divergence past the threshold raises a SOFT data-quality
// flag ("your spend assumption looks off") — never Data stale.
export const SPEND_CALIBRATION_THRESHOLDS = {
  // Trailing window of calendar months (ending at the snapshot month) averaged.
  windowMonths: 6,
  // Fewer logged months than this in the window ⇒ no calibration (one odd month
  // must not flag a sound assumption).
  minLoggedMonths: 3,
  // |trailing average − assumption| beyond this % of the assumption ⇒ flag.
  divergencePct: 25,
} as const;

// What counts as a MATERIAL change between the last strategic snapshot and the
// current state — the firewall between daily internal updates and the calm
// monthly surface. Versioned and tested like the status thresholds.
export const MATERIAL_CHANGE_THRESHOLDS = {
  // Net worth moved by at least this % since the last strategic snapshot.
  netWorthDeltaPct: 5,
  // The liquid+investable pile (fireCountedEUR) moved by at least this %
  //: property equity dilutes the total, so an equity-only crash
  // needs its own trigger. Symmetric with the net-worth threshold on purpose.
  fireCountedDeltaPct: 5,
  // Runway crossed below the action floor (months) since the last snapshot.
  runwayFloorMonths: 18,
} as const;
