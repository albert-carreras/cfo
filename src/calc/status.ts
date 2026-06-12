import { dec, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";
import { STATUS_THRESHOLDS } from "./config/thresholds";
import type { DataQualityValue } from "./dataQuality";

// Maps the latest snapshot to exactly ONE status, in priority order (first match
// wins). Deterministic, versioned, tested — not UI logic. Honest staleness beats
// false calm, so Data stale takes precedence over everything. The
// overspend rules: the spend ASSUMPTION above safe monthly spend is the
// "base-case FIRE no longer holds" signal a runway floor alone can never catch
// on a FIRE-sized portfolio. Reasons speak in years and percent (coarse by
// design), never in cents.

export type StatusLevel =
  | "data_stale"
  | "urgent"
  | "action_recommended"
  | "review_soon"
  | "stable";

export type StatusValue = {
  status: StatusLevel;
  label: string;
  reason: string;
};

const LABELS: Record<StatusLevel, string> = {
  data_stale: "Data stale",
  urgent: "Urgent",
  action_recommended: "Action recommended",
  review_soon: "Review soon",
  stable: "Stable",
};

export function status(args: {
  snapshotId: string;
  runwayMonths: number | null;
  // The monthlySpend assumption and the SWR-derived safe draw.
  monthlySpendEUR: Money | null;
  safeMonthlySpendEUR: Money | null;
  dataQuality: DataQualityValue;
  reviewDue: boolean;
}): CalcResult<StatusValue> {
  const {
    snapshotId,
    runwayMonths,
    monthlySpendEUR,
    safeMonthlySpendEUR,
    dataQuality,
    reviewDue,
  } = args;
  const t = STATUS_THRESHOLDS;

  // Overspend: how far the spend assumption sits above the safe monthly draw,
  // in percent of the safe draw. Null when either side is missing.
  const spend = monthlySpendEUR === null ? null : dec(monthlySpendEUR);
  const safe =
    safeMonthlySpendEUR === null ? null : dec(safeMonthlySpendEUR);
  const overspendPct =
    spend !== null && spend.greaterThan(0) && safe !== null && safe.greaterThan(0)
      ? spend.minus(safe).dividedBy(safe).times(100)
      : null;

  let level: StatusLevel;
  let reason: string;

  if (dataQuality.score === "Poor" || dataQuality.missingRequired.length > 0) {
    level = "data_stale";
    reason =
      dataQuality.missingRequired.length > 0
        ? `Required input(s) past cadence: ${dataQuality.missingRequired.join(", ")}.`
        : "Data quality is Poor — not enough fresh inputs to compute a confident status.";
  } else if (runwayMonths !== null && runwayMonths < t.urgentRunwayMonths) {
    level = "urgent";
    reason = `Runway is ${runwayMonths} months — below the ${t.urgentRunwayMonths}-month floor.`;
  } else if (runwayMonths !== null && runwayMonths < t.actionRunwayMonths) {
    level = "action_recommended";
    reason = `Runway is ${runwayMonths} months — below the ${t.actionRunwayMonths}-month comfortable floor.`;
  } else if (
    overspendPct !== null &&
    overspendPct.greaterThan(t.overspendTolerancePct)
  ) {
    level = "action_recommended";
    reason = `Spend assumption is ${overspendPct.toFixed(0)}% above the safe monthly spend — the base-case plan does not hold at this rate.`;
  } else if (overspendPct !== null && overspendPct.greaterThan(0)) {
    level = "review_soon";
    reason = `Spend assumption is ${overspendPct.toFixed(0)}% above the safe monthly spend — inside the ${t.overspendTolerancePct}% tolerance, worth a review.`;
  } else if (reviewDue) {
    level = "review_soon";
    reason = "A scheduled review is due.";
  } else {
    level = "stable";
    reason = "Nothing material changed since the last snapshot.";
  }

  return {
    snapshotId,
    value: { status: level, label: LABELS[level], reason },
    source: VERSIONS.status.source,
    version: VERSIONS.status.version,
    inputs: [], // a meta-calc over snapshot outputs; provenance lives in snapshotId
  };
}
