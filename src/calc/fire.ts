import { dec, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";

// The one spending question: does your monthly spend fit what the available
// pile can safely pay out, and how long would it last with zero growth? Pure.
// Pension and property are deliberately left out; they are not drawable.

export type FireValue = {
  availableEUR: Money;
  monthlySpendEUR: Money | null;
  safeWithdrawalRate: Money | null;
  // available × rate / 12
  safeMonthlySpendEUR: Money | null;
  // safe − spend; negative = spending above the safe level
  headroomEUR: Money | null;
  // Null whenever either side is missing — never a reassuring default.
  fits: boolean | null;
  // available / (spend × 12): years at zero growth
  runwayYears: number | null;
};

export function fire(args: {
  snapshotId: string;
  availableEUR: Money;
  monthlySpendEUR: Money | null;
  safeWithdrawalRate: Money | null;
  inputs: string[];
}): CalcResult<FireValue> {
  const { snapshotId, availableEUR, monthlySpendEUR, safeWithdrawalRate, inputs } = args;
  const available = dec(availableEUR);
  const spend =
    monthlySpendEUR !== null && dec(monthlySpendEUR).greaterThan(0)
      ? dec(monthlySpendEUR)
      : null;
  const rate = safeWithdrawalRate === null ? null : dec(safeWithdrawalRate);
  const safe = rate === null ? null : available.times(rate).dividedBy(12);

  return {
    snapshotId,
    value: {
      availableEUR: available.toFixed(2),
      monthlySpendEUR: spend?.toFixed(2) ?? null,
      safeWithdrawalRate: rate?.toString() ?? null,
      safeMonthlySpendEUR: safe?.toFixed(2) ?? null,
      headroomEUR: safe && spend ? safe.minus(spend).toFixed(2) : null,
      fits: safe && spend ? spend.lessThanOrEqualTo(safe) : null,
      runwayYears:
        spend === null
          ? null
          : Number(available.dividedBy(spend.times(12)).toFixed(1)),
    },
    source: VERSIONS.fire.source,
    version: VERSIONS.fire.version,
    inputs,
  };
}
