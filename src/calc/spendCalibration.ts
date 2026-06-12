import { dec, sum, type Money } from "./money";
import { SPEND_CALIBRATION_THRESHOLDS } from "./config/thresholds";

// The monthly-spend LOG is optional calibration for the coarse
// monthlySpend ASSUMPTION. When enough recent months are logged, their trailing
// average is compared to the assumption; a divergence past the versioned
// threshold raises a SOFT data-quality flag ("your spend assumption looks
// off") — never Data stale. Pure: `asOf` is passed in; not enough logs ⇒ null,
// silently (an unused optional input is not a problem to report).

export type SpendCalibrationValue = {
  trailingAvgEUR: Money;
  monthsUsed: number; // logged months inside the window
  divergencePct: Money; // signed: + when the log runs ABOVE the assumption
  divergent: boolean;
  inputs: string[]; // the monthly-spend row ids averaged (provenance)
};

// The `windowMonths` YYYY-MM keys ending at (and including) asOf's month.
function windowMonths(asOf: string, count: number): Set<string> {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const keys = new Set<string>();
  for (let i = 0; i < count; i++) {
    const total = year * 12 + (month - 1) - i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    keys.add(`${y}-${String(m).padStart(2, "0")}`);
  }
  return keys;
}

export function spendCalibration(args: {
  asOf: string;
  assumptionEUR: Money | null; // the monthlySpend assumption (null = unset)
  logs: { id: string; month: string; amount: Money; createdAt: string }[];
}): SpendCalibrationValue | null {
  const { asOf, assumptionEUR, logs } = args;
  const t = SPEND_CALIBRATION_THRESHOLDS;

  const assumption = assumptionEUR === null ? null : dec(assumptionEUR);
  if (assumption === null || !assumption.greaterThan(0)) return null;

  // Only rows effective by the snapshot date, newest figure per month winning
  // (a re-log of the same month is the append-only correction path).
  const window = windowMonths(asOf, t.windowMonths);
  const byMonth = new Map<string, (typeof logs)[number]>();
  for (const row of logs) {
    if (row.createdAt.slice(0, 10) > asOf || !window.has(row.month)) continue;
    const current = byMonth.get(row.month);
    if (
      !current ||
      row.createdAt > current.createdAt ||
      (row.createdAt === current.createdAt && row.id > current.id)
    ) {
      byMonth.set(row.month, row);
    }
  }

  const used = [...byMonth.values()];
  if (used.length < t.minLoggedMonths) return null;

  const avg = sum(used.map((row) => row.amount)).dividedBy(used.length);
  const divergence = avg.minus(assumption).dividedBy(assumption).times(100);

  return {
    trailingAvgEUR: avg.toFixed(2),
    monthsUsed: used.length,
    divergencePct: divergence.toFixed(1),
    divergent: divergence.abs().greaterThan(t.divergencePct),
    inputs: used
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((row) => row.id),
  };
}
