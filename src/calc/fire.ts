import Decimal from "decimal.js";
import { dec, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";
import {
  FIRE_BANDS_2026,
  type FireBandParams,
  type FireBandsConfig,
} from "./config/fireBands";

// Basic FIRE: how long the liquid+investable pile lasts at the assumed spend,
// and a safe monthly draw from the FIRE-counted pile. The spend
// is the coarse `monthlySpend` ASSUMPTION (reviewed yearly) — the monthly spend
// log is optional calibration, never the source of truth. The conservative/
// base/optimistic BANDS recompute the same arithmetic under versioned stress
// parameters (config/fireBands.ts) and state the base plan's explicit failure
// modes — how far spend, the pile, or the withdrawal rate can move before
// spend no longer fits the safe draw. Deterministic recomputes, not
// simulations. Pure.
//
// fire.v2 adds the REAL view: runway if the pile grows at the real return
// derived from the user's nominal `expectedReturn` and `longRunInflation`
// assumptions — a clearly-labeled assumption-driven extra view. The 0%-growth
// runway stays the headline, and the BANDS stay ungrown: optimism about
// markets is not a number this app originates.

export type FireBand = {
  // The band's spend: the explicit monthlySpendConservative/Optimistic
  // assumption when set, else the base spend × the band's multiplier.
  monthlySpendEUR: Money | null;
  runwayAssetsEUR: Money; // liquid + investable, after the band's haircut
  runwayMonths: number | null;
  runwayYears: number | null;
  safeWithdrawalRate: Money | null; // base SWR + the band's delta (floored at 0)
  safeMonthlySpendEUR: Money | null; // haircut pile × band SWR / 12
  // Whether the band's spend fits its safe draw. Null when either side is
  // missing — never a reassuring default.
  holds: boolean | null;
};

// The base plan's explicit failure modes — the smallest single move that
// breaks "spend fits the safe draw". Negative spendRisePct / assetDropPct
// mean the base plan is ALREADY broken (spend above the safe draw); they are
// deliberately not clamped to 0. All null when spend or SWR is missing.
export type FireFailureModes = {
  spendRisePct: number | null; // spend rise (%) that breaks the plan
  assetDropPct: number | null; // FIRE-counted drop (%) that breaks the plan
  swrFloorPct: number | null; // the minimum withdrawal rate (%) the plan needs
};

// The assumption-driven real view (fire.v2). Present only when expectedReturn,
// longRunInflation AND a positive spend are all set — an honest unknown is an
// omitted block, never a defaulted one. `sustainable` means the pile's real
// growth covers the spend (P·g ≥ S), in which case the real runway is null
// (JSON-safe; no Infinity).
export type FireRealView = {
  expectedReturnAnnual: Money; // the nominal assumption, echoed for display
  longRunInflationAnnual: Money;
  realReturnAnnual: Money; // (1+r)/(1+i) − 1
  realMonthlyGrowth: Money; // g = ((1+r)/(1+i))^(1/12) − 1
  realRunwayMonths: number | null; // null ⇔ sustainable
  realRunwayYears: number | null;
  sustainable: boolean;
};

export type FireValue = {
  monthlySpendEUR: Money; // the base spend assumption ("0.00" when unset)
  runwayAssetsEUR: Money; // liquid + investable
  runwayMonths: number | null; // null = no spend assumption (runway is unbounded)
  runwayYears: number | null;
  // Spend-only conservative/optimistic runways (pre-band view, kept for
  // stored snapshots); the bands below are the full stressed recompute.
  runwayMonthsConservative: number | null;
  runwayMonthsOptimistic: number | null;
  safeWithdrawalRate: Money | null; // e.g. "0.035"
  safeMonthlySpendEUR: Money | null;
  // What you actually draw: spend·12 / fireCounted — a genuine withdrawal
  // ratio comparable to safeWithdrawalRate. Null when spend is unset or the
  // pile is empty. Optional only on pre-v2 stored snapshots.
  actualWithdrawalRate?: Money | null;
  // The assumption-driven real view — omitted (not null) when any input is
  // missing, so pre-v2 stored snapshots and degraded runs look identical.
  real?: FireRealView;
  // Optional only because pre-band STORED snapshots lack it; fire() always
  // fills it. `version` is the band config's own (the calc version travels on
  // the CalcResult).
  bands?: {
    version: string;
    conservative: FireBand;
    base: FireBand;
    optimistic: FireBand;
    failureModes: FireFailureModes;
  };
};

function runwayFor(runwayAssets: Decimal, spend: Decimal | null) {
  if (spend === null || !spend.greaterThan(0)) return null;
  return Number(runwayAssets.dividedBy(spend).toFixed(1));
}

// Closed-form depletion of a pile P growing at the real monthly rate g while
// spending S per month: n = −ln(1 − P·g/S) / ln(1+g). Valid for g < 0 too
// (faster depletion — both ln terms flip sign). g ≈ 0 falls back to P/S.
function realView(args: {
  runwayAssets: Decimal;
  spend: Decimal | null;
  expectedReturn: Decimal | null;
  longRunInflation: Decimal | null;
}): FireRealView | undefined {
  const { runwayAssets, spend, expectedReturn, longRunInflation } = args;
  if (
    expectedReturn === null ||
    longRunInflation === null ||
    spend === null ||
    !spend.greaterThan(0)
  ) {
    return undefined;
  }
  const onePlusI = dec(1).plus(longRunInflation);
  if (!onePlusI.greaterThan(0)) return undefined; // absurd input, never NaN
  const realAnnual = dec(1).plus(expectedReturn).dividedBy(onePlusI).minus(1);
  const onePlusGAnnual = realAnnual.plus(1);
  if (!onePlusGAnnual.greaterThan(0)) return undefined;
  const g = onePlusGAnnual.pow(dec(1).dividedBy(12)).minus(1);

  // P·g ≥ S with growth: the real draw is covered — sustainable, no runway.
  const sustainable =
    g.greaterThan(0) && runwayAssets.times(g).greaterThanOrEqualTo(spend);

  let months: number | null = null;
  if (!sustainable) {
    if (g.abs().lessThan("1e-12")) {
      // r == i: real growth is zero, depletion is the plain division.
      months = Number(runwayAssets.dividedBy(spend).toFixed(1));
    } else {
      // !sustainable keeps the ln argument strictly positive for g > 0.
      const arg = dec(1).minus(runwayAssets.times(g).dividedBy(spend));
      months = Number(arg.ln().negated().dividedBy(g.plus(1).ln()).toFixed(1));
    }
  }

  return {
    expectedReturnAnnual: expectedReturn.toString(),
    longRunInflationAnnual: longRunInflation.toString(),
    realReturnAnnual: realAnnual.toFixed(6),
    realMonthlyGrowth: g.toFixed(8),
    realRunwayMonths: months,
    realRunwayYears: months === null ? null : Number((months / 12).toFixed(2)),
    sustainable,
  };
}

function band(args: {
  runwayAssets: Decimal;
  fireCounted: Decimal;
  spend: Decimal | null;
  swr: Decimal | null;
  params: FireBandParams | null; // null = the base band (no stress applied)
  explicitSpend: Decimal | null; // an entered assumption beats the multiplier
}): FireBand {
  const { runwayAssets, fireCounted, params, explicitSpend } = args;

  const keep = params ? new Decimal(1).minus(dec(params.assetHaircut)) : dec(1);
  const assets = runwayAssets.times(keep);
  const spend =
    explicitSpend ??
    (args.spend === null
      ? null
      : params
        ? args.spend.times(dec(params.spendMultiplier))
        : args.spend);
  const swr =
    args.swr === null
      ? null
      : Decimal.max(0, params ? args.swr.plus(dec(params.swrDelta)) : args.swr);

  const runwayMonths = runwayFor(assets, spend);
  const safe =
    swr === null ? null : fireCounted.times(keep).times(swr).dividedBy(12);

  return {
    monthlySpendEUR: spend?.toFixed(2) ?? null,
    runwayAssetsEUR: assets.toFixed(2),
    runwayMonths,
    runwayYears:
      runwayMonths === null ? null : Number((runwayMonths / 12).toFixed(2)),
    safeWithdrawalRate: swr?.toString() ?? null,
    safeMonthlySpendEUR: safe?.toFixed(2) ?? null,
    holds:
      spend === null || !spend.greaterThan(0) || safe === null
        ? null
        : spend.lessThanOrEqualTo(safe),
  };
}

// How far spend / the pile / the rate can move before spend stops fitting the
// safe draw — the algebra of `spend ≤ fireCounted × swr / 12`, solved for
// each input with the others held fixed.
function failureModes(args: {
  fireCounted: Decimal;
  spend: Decimal | null;
  swr: Decimal | null;
}): FireFailureModes {
  const { fireCounted, spend, swr } = args;
  if (
    spend === null ||
    !spend.greaterThan(0) ||
    swr === null ||
    !swr.greaterThan(0) ||
    !fireCounted.greaterThan(0)
  ) {
    return { spendRisePct: null, assetDropPct: null, swrFloorPct: null };
  }
  const safe = fireCounted.times(swr).dividedBy(12);
  const annualSpend = spend.times(12);
  return {
    spendRisePct: Number(
      safe.dividedBy(spend).minus(1).times(100).toFixed(1),
    ),
    assetDropPct: Number(
      new Decimal(1)
        .minus(annualSpend.dividedBy(fireCounted.times(swr)))
        .times(100)
        .toFixed(1),
    ),
    swrFloorPct: Number(
      annualSpend.dividedBy(fireCounted).times(100).toFixed(2),
    ),
  };
}

export function fire(args: {
  snapshotId: string;
  liquidEUR: Money;
  investableEUR: Money;
  fireCountedEUR: Money;
  monthlySpendEUR: Money | null; // the monthlySpend assumption
  monthlySpendConservativeEUR?: Money | null;
  monthlySpendOptimisticEUR?: Money | null;
  safeWithdrawalRate: Money | null;
  expectedReturnAnnual?: Money | null; // nominal long-run return assumption
  longRunInflationAnnual?: Money | null; // long-run inflation FORECAST (not the ECB observation)
  bandsConfig?: FireBandsConfig;
  inputs: string[]; // ids of the assumption rows used (provenance)
}): CalcResult<FireValue> {
  const {
    snapshotId,
    liquidEUR,
    investableEUR,
    fireCountedEUR,
    monthlySpendEUR,
    monthlySpendConservativeEUR = null,
    monthlySpendOptimisticEUR = null,
    safeWithdrawalRate,
    expectedReturnAnnual = null,
    longRunInflationAnnual = null,
    bandsConfig = FIRE_BANDS_2026,
    inputs,
  } = args;

  const runwayAssets = dec(liquidEUR).plus(dec(investableEUR));
  const fireCounted = dec(fireCountedEUR);
  const spend = monthlySpendEUR === null ? null : dec(monthlySpendEUR);
  const swr = safeWithdrawalRate === null ? null : dec(safeWithdrawalRate);
  const spendConservative =
    monthlySpendConservativeEUR === null ? null : dec(monthlySpendConservativeEUR);
  const spendOptimistic =
    monthlySpendOptimisticEUR === null ? null : dec(monthlySpendOptimisticEUR);

  const runwayMonths = runwayFor(runwayAssets, spend);
  const runwayYears =
    runwayMonths === null ? null : Number((runwayMonths / 12).toFixed(2));

  const safeMonthlySpend =
    swr === null ? null : fireCounted.times(swr).dividedBy(12);

  const actualWithdrawalRate =
    spend === null || !spend.greaterThan(0) || !fireCounted.greaterThan(0)
      ? null
      : spend.times(12).dividedBy(fireCounted).toFixed(4);

  const real = realView({
    runwayAssets,
    spend,
    expectedReturn:
      expectedReturnAnnual === null ? null : dec(expectedReturnAnnual),
    longRunInflation:
      longRunInflationAnnual === null ? null : dec(longRunInflationAnnual),
  });

  const shared = { runwayAssets, fireCounted, spend, swr };
  return {
    snapshotId,
    value: {
      monthlySpendEUR: spend === null ? "0.00" : spend.toFixed(2),
      runwayAssetsEUR: runwayAssets.toFixed(2),
      runwayMonths,
      runwayYears,
      runwayMonthsConservative: runwayFor(runwayAssets, spendConservative),
      runwayMonthsOptimistic: runwayFor(runwayAssets, spendOptimistic),
      safeWithdrawalRate: swr?.toString() ?? null,
      safeMonthlySpendEUR: safeMonthlySpend?.toFixed(2) ?? null,
      actualWithdrawalRate,
      // Spread only when present — `real: undefined` must serialize to an
      // absent key, identical to a degraded or pre-v2 snapshot.
      ...(real === undefined ? {} : { real }),
      bands: {
        version: bandsConfig.version,
        conservative: band({
          ...shared,
          params: bandsConfig.conservative,
          explicitSpend: spendConservative,
        }),
        base: band({ ...shared, params: null, explicitSpend: null }),
        optimistic: band({
          ...shared,
          params: bandsConfig.optimistic,
          explicitSpend: spendOptimistic,
        }),
        failureModes: failureModes({ fireCounted, spend, swr }),
      },
    },
    source: VERSIONS.fire.source,
    version: VERSIONS.fire.version,
    inputs,
  };
}
