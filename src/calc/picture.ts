import { dec, type Money } from "./money";
import type { FireValue } from "./fire";
import type { NetWorthValue } from "./netWorth";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";

// The picture's derived ratios — the deterministic backbone of the standing
// reassurance narrative (/picture). The voice may only reference these shares
// via metric tokens; it never computes a percentage itself. Coarse by design
// (whole percent, whole years above a decade) like the rest of the calm
// surface. Pure; works on stored snapshots (input = calculator values only).

export type PictureValue = {
  // Each net-worth bucket as a whole-percent share of the total. Null when the
  // total is zero (no facts yet) — never NaN.
  liquidSharePct: number | null;
  investableSharePct: number | null;
  lockedSharePct: number | null;
  illiquidSharePct: number | null;
  // Spend vs the safe monthly draw: how much of the sustainable level is being
  // used, and the headroom left. Null without a spend + SWR assumption.
  spendVsSafeSpendPct: number | null;
  spendHeadroomPct: number | null;
  // Runway restated coarsely (one decimal under a decade, whole years above).
  runwayYearsCoarse: number | null;
};

function sharePct(part: Money, total: Money): number | null {
  const t = dec(total);
  if (!t.greaterThan(0)) return null;
  return Number(dec(part).dividedBy(t).times(100).toFixed(0));
}

export function picture(args: {
  snapshotId: string;
  netWorth: NetWorthValue;
  fire: FireValue;
  inputs: string[]; // the calculators' sources (provenance of the ratios)
}): CalcResult<PictureValue> {
  const { snapshotId, netWorth: nw, fire: fr, inputs } = args;

  const spend = dec(fr.monthlySpendEUR);
  const safe = fr.safeMonthlySpendEUR === null ? null : dec(fr.safeMonthlySpendEUR);
  const spendVsSafe =
    safe === null || !safe.greaterThan(0) || !spend.greaterThan(0)
      ? null
      : Number(spend.dividedBy(safe).times(100).toFixed(0));

  const runwayYearsCoarse =
    fr.runwayYears === null
      ? null
      : fr.runwayYears < 10
        ? Number(fr.runwayYears.toFixed(1))
        : Math.round(fr.runwayYears);

  return {
    snapshotId,
    value: {
      liquidSharePct: sharePct(nw.liquidEUR, nw.totalEUR),
      investableSharePct: sharePct(nw.investableEUR, nw.totalEUR),
      lockedSharePct: sharePct(nw.lockedEUR, nw.totalEUR),
      illiquidSharePct: sharePct(nw.illiquidEUR, nw.totalEUR),
      spendVsSafeSpendPct: spendVsSafe,
      spendHeadroomPct: spendVsSafe === null ? null : 100 - spendVsSafe,
      runwayYearsCoarse,
    },
    source: VERSIONS.picture.source,
    version: VERSIONS.picture.version,
    inputs,
  };
}
