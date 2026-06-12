import type { Money } from "../money";

// FIRE band config — the rough, versioned parameters behind the
// conservative/base/optimistic view of the plan (the backlog's "FIRE with
// explicit failure modes"). Versioned like the tax tables and scenario config:
// the version travels with every band figure, and a change here is a
// deliberate, dated bump. The numbers are deliberately ROUGH judgment
// parameters made inspectable — no Monte Carlo, no return paths, just three
// deterministic recomputes of the same runway/safe-spend arithmetic.
export type FireBandParams = {
  // Multiplies the base monthlySpend assumption — used only when no explicit
  // monthlySpendConservative / monthlySpendOptimistic assumption is set (an
  // entered assumption always beats a derived multiplier).
  spendMultiplier: Money;
  // Added to the base safe withdrawal rate (e.g. "-0.005" = 3.5% → 3.0%).
  swrDelta: Money;
  // Fraction shaved off the liquid+investable pile before computing the band
  // (a market-drawdown haircut; "0" leaves the pile untouched).
  assetHaircut: Money;
};

export type FireBandsConfig = {
  version: string;
  conservative: FireBandParams;
  optimistic: FireBandParams;
};

export const FIRE_BANDS_2026: FireBandsConfig = {
  version: "fireBands.2026.1",
  // Conservative: spend runs 15% hot, the sustainable rate is half a point
  // lower, and the pile takes a 30% equity-style drawdown — all at once.
  // "The plan holds" in this band is a strong statement.
  conservative: {
    spendMultiplier: "1.15",
    swrDelta: "-0.005",
    assetHaircut: "0.30",
  },
  // Optimistic: spend runs 10% light and the rate half a point higher; the
  // pile is never marked UP — optimism about markets is not a number this
  // app originates.
  optimistic: {
    spendMultiplier: "0.90",
    swrDelta: "0.005",
    assetHaircut: "0",
  },
};
