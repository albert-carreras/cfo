import { describe, expect, it } from "vitest";
import { fire } from "@/calc/fire";

describe("fire", () => {
  it("computes runway from liquid+investable and a safe monthly draw", () => {
    const result = fire({
      snapshotId: "s",
      liquidEUR: "20000",
      investableEUR: "300000",
      fireCountedEUR: "320000",
      monthlySpendEUR: "4000",
      safeWithdrawalRate: "0.035",
      inputs: ["spend1", "swr1"],
    });

    const v = result.value;
    expect(v.runwayAssetsEUR).toBe("320000.00");
    expect(v.runwayMonths).toBe(80); // 320000 / 4000
    expect(v.runwayYears).toBe(6.67); // 80 / 12
    // 320000 × 0.035 / 12
    expect(v.safeMonthlySpendEUR).toBe("933.33");
    expect(result.inputs).toEqual(["spend1", "swr1"]);
  });

  it("computes conservative/optimistic runways from their optional spend values", () => {
    const result = fire({
      snapshotId: "s",
      liquidEUR: "20000",
      investableEUR: "300000",
      fireCountedEUR: "320000",
      monthlySpendEUR: "4000",
      monthlySpendConservativeEUR: "5000",
      monthlySpendOptimisticEUR: "3200",
      safeWithdrawalRate: "0.035",
      inputs: ["assum_spend", "swr1"],
    });

    expect(result.value.runwayMonths).toBe(80);
    expect(result.value.runwayMonthsConservative).toBe(64); // 320000 / 5000
    expect(result.value.runwayMonthsOptimistic).toBe(100); // 320000 / 3200
  });

  it("leaves the optional scenarios null when not provided", () => {
    const result = fire({
      snapshotId: "s",
      liquidEUR: "20000",
      investableEUR: "300000",
      fireCountedEUR: "320000",
      monthlySpendEUR: "4000",
      safeWithdrawalRate: "0.035",
      inputs: [],
    });
    expect(result.value.runwayMonthsConservative).toBeNull();
    expect(result.value.runwayMonthsOptimistic).toBeNull();
  });

  it("returns null runway when no spend assumption is set (unbounded)", () => {
    const result = fire({
      snapshotId: "s",
      liquidEUR: "20000",
      investableEUR: "300000",
      fireCountedEUR: "320000",
      monthlySpendEUR: null,
      safeWithdrawalRate: "0.035",
      inputs: [],
    });

    expect(result.value.runwayMonths).toBeNull();
    expect(result.value.runwayYears).toBeNull();
  });

  it("computes the three bands under the versioned stress parameters", () => {
    const result = fire({
      snapshotId: "s",
      liquidEUR: "20000",
      investableEUR: "300000",
      fireCountedEUR: "320000",
      monthlySpendEUR: "1000",
      safeWithdrawalRate: "0.035",
      bandsConfig: {
        version: "fireBands.test.1",
        conservative: {
          spendMultiplier: "1.15",
          swrDelta: "-0.005",
          assetHaircut: "0.30",
        },
        optimistic: {
          spendMultiplier: "0.90",
          swrDelta: "0.005",
          assetHaircut: "0",
        },
      },
      inputs: [],
    });

    const bands = result.value.bands!;
    expect(bands.version).toBe("fireBands.test.1");

    // Base band mirrors the headline figures.
    expect(bands.base.monthlySpendEUR).toBe("1000.00");
    expect(bands.base.runwayMonths).toBe(320);
    expect(bands.base.safeMonthlySpendEUR).toBe("933.33");
    expect(bands.base.holds).toBe(false); // 1000 > 933.33

    // Conservative: 30% haircut, spend ×1.15, SWR 3.5% → 3.0%.
    expect(bands.conservative.runwayAssetsEUR).toBe("224000.00");
    expect(bands.conservative.monthlySpendEUR).toBe("1150.00");
    // 224000 / 1150 = 194.8
    expect(bands.conservative.runwayMonths).toBe(194.8);
    // 320000 × 0.7 × 0.03 / 12 = 560
    expect(bands.conservative.safeMonthlySpendEUR).toBe("560.00");
    expect(bands.conservative.holds).toBe(false);

    // Optimistic: no haircut, spend ×0.90, SWR 4.0%.
    expect(bands.optimistic.monthlySpendEUR).toBe("900.00");
    // 320000 × 0.04 / 12 = 1066.67
    expect(bands.optimistic.safeMonthlySpendEUR).toBe("1066.67");
    expect(bands.optimistic.holds).toBe(true);
  });

  it("prefers an explicit conservative/optimistic spend assumption over the multiplier", () => {
    const result = fire({
      snapshotId: "s",
      liquidEUR: "0",
      investableEUR: "300000",
      fireCountedEUR: "300000",
      monthlySpendEUR: "1000",
      monthlySpendConservativeEUR: "2000",
      monthlySpendOptimisticEUR: "800",
      safeWithdrawalRate: "0.035",
      inputs: [],
    });

    const bands = result.value.bands!;
    expect(bands.conservative.monthlySpendEUR).toBe("2000.00");
    expect(bands.optimistic.monthlySpendEUR).toBe("800.00");
    // The legacy spend-only runways still come from the explicit assumptions.
    expect(result.value.runwayMonthsConservative).toBe(150);
    expect(result.value.runwayMonthsOptimistic).toBe(375);
  });

  it("states the base plan's explicit failure modes", () => {
    const result = fire({
      snapshotId: "s",
      liquidEUR: "20000",
      investableEUR: "300000",
      fireCountedEUR: "320000",
      monthlySpendEUR: "800",
      safeWithdrawalRate: "0.035",
      inputs: [],
    });

    const fm = result.value.bands!.failureModes;
    // safe = 933.33; spend can rise 16.7% before it stops fitting.
    expect(fm.spendRisePct).toBe(16.7);
    // the pile can drop 14.3% before the safe draw falls to 800.
    expect(fm.assetDropPct).toBe(14.3);
    // 800 × 12 / 320000 = 3%.
    expect(fm.swrFloorPct).toBe(3);
  });

  it("reports negative failure-mode headroom when the plan is already broken", () => {
    const result = fire({
      snapshotId: "s",
      liquidEUR: "0",
      investableEUR: "100000",
      fireCountedEUR: "100000",
      monthlySpendEUR: "1000",
      safeWithdrawalRate: "0.035",
      inputs: [],
    });

    const bands = result.value.bands!;
    expect(bands.base.holds).toBe(false);
    // safe = 291.67 — spend would have to FALL; headroom is negative, not 0.
    expect(bands.failureModes.spendRisePct).toBeLessThan(0);
    expect(bands.failureModes.assetDropPct).toBeLessThan(0);
    expect(bands.failureModes.swrFloorPct).toBe(12);
  });

  it("keeps bands honest when spend or the rate is missing", () => {
    const noSpend = fire({
      snapshotId: "s",
      liquidEUR: "0",
      investableEUR: "100000",
      fireCountedEUR: "100000",
      monthlySpendEUR: null,
      safeWithdrawalRate: "0.035",
      inputs: [],
    });
    expect(noSpend.value.bands!.conservative.monthlySpendEUR).toBeNull();
    expect(noSpend.value.bands!.conservative.runwayMonths).toBeNull();
    expect(noSpend.value.bands!.conservative.holds).toBeNull();
    expect(noSpend.value.bands!.failureModes.spendRisePct).toBeNull();

    const noSwr = fire({
      snapshotId: "s",
      liquidEUR: "0",
      investableEUR: "100000",
      fireCountedEUR: "100000",
      monthlySpendEUR: "1000",
      safeWithdrawalRate: null,
      inputs: [],
    });
    expect(noSwr.value.bands!.base.safeMonthlySpendEUR).toBeNull();
    expect(noSwr.value.bands!.base.holds).toBeNull();
    expect(noSwr.value.bands!.failureModes.swrFloorPct).toBeNull();
  });

  it("does not invent a safe withdrawal rate when the verified assumption is missing", () => {
    const result = fire({
      snapshotId: "s",
      liquidEUR: "100000",
      investableEUR: "200000",
      fireCountedEUR: "300000",
      monthlySpendEUR: "3000",
      safeWithdrawalRate: null,
      inputs: ["spend"],
    });

    expect(result.value.runwayMonths).toBe(100);
    expect(result.value.safeWithdrawalRate).toBeNull();
    expect(result.value.safeMonthlySpendEUR).toBeNull();
  });
});

// fire.v2 — the assumption-driven real view + the actual withdrawal rate.
describe("fire real view (fire.v2)", () => {
  const base = {
    snapshotId: "s",
    liquidEUR: "20000",
    investableEUR: "300000",
    fireCountedEUR: "320000",
    monthlySpendEUR: "4000",
    safeWithdrawalRate: "0.035",
    inputs: ["spend1", "swr1", "ret1", "infl1"],
  };

  it("carries the fire.v2 version strings", () => {
    const result = fire({ ...base });
    expect(result.source).toBe("fire.v2");
    expect(result.version).toBe("fire.2026.4");
  });

  it("extends the runway when the assumed real return is positive (r > i)", () => {
    const result = fire({
      ...base,
      expectedReturnAnnual: "0.07",
      longRunInflationAnnual: "0.02",
    });
    const real = result.value.real!;
    // (1.07/1.02) − 1, monthly g = (1.07/1.02)^(1/12) − 1, then
    // n = −ln(1 − P·g/S)/ln(1+g) with P = 320000, S = 4000.
    expect(real.realReturnAnnual).toBe("0.049020");
    expect(real.realMonthlyGrowth).toBe("0.00399596");
    expect(real.realRunwayMonths).toBe(96.6);
    expect(real.realRunwayYears).toBe(8.05);
    expect(real.sustainable).toBe(false);
    expect(real.realRunwayMonths!).toBeGreaterThan(result.value.runwayMonths!);
  });

  it("shortens the runway when inflation outruns the return (g < 0)", () => {
    const result = fire({
      ...base,
      expectedReturnAnnual: "0",
      longRunInflationAnnual: "0.03",
    });
    const real = result.value.real!;
    expect(real.realReturnAnnual).toBe("-0.029126");
    expect(real.realRunwayMonths).toBe(72.9);
    expect(real.realRunwayMonths!).toBeLessThan(result.value.runwayMonths!);
    expect(real.sustainable).toBe(false);
  });

  it("falls back to the plain division when r equals i (g ≈ 0)", () => {
    const result = fire({
      ...base,
      expectedReturnAnnual: "0.02",
      longRunInflationAnnual: "0.02",
    });
    expect(result.value.real!.realRunwayMonths).toBe(
      result.value.runwayMonths,
    );
  });

  it("reports sustainable (runway null) when the real growth covers the spend", () => {
    const result = fire({
      ...base,
      liquidEUR: "0",
      investableEUR: "2000000",
      fireCountedEUR: "2000000",
      expectedReturnAnnual: "0.07",
      longRunInflationAnnual: "0.02",
    });
    const real = result.value.real!;
    expect(real.sustainable).toBe(true);
    expect(real.realRunwayMonths).toBeNull();
    expect(real.realRunwayYears).toBeNull();
  });

  it("omits the real view (not null) unless return, inflation AND a positive spend are all set", () => {
    const plain = fire({ ...base });
    const onlyReturn = fire({ ...base, expectedReturnAnnual: "0.07" });
    const onlyInflation = fire({ ...base, longRunInflationAnnual: "0.02" });
    const noSpend = fire({
      ...base,
      monthlySpendEUR: null,
      expectedReturnAnnual: "0.07",
      longRunInflationAnnual: "0.02",
    });
    for (const result of [plain, onlyReturn, onlyInflation, noSpend]) {
      expect(result.value.real).toBeUndefined();
      expect("real" in result.value).toBe(false); // absent key, not undefined-set
    }
    // Degradation: every legacy field identical to a run without the inputs.
    expect(onlyReturn.value).toEqual(plain.value);
    expect(onlyInflation.value).toEqual(plain.value);
  });

  it("omits the real view on absurd input (1+i ≤ 0) instead of returning NaN", () => {
    const result = fire({
      ...base,
      expectedReturnAnnual: "0.05",
      longRunInflationAnnual: "-1",
    });
    expect(result.value.real).toBeUndefined();
  });

  it("reports the actual withdrawal rate — spend·12 over the FIRE-counted pile", () => {
    const result = fire({ ...base });
    expect(result.value.actualWithdrawalRate).toBe("0.1500"); // 48000/320000
    const noSpend = fire({ ...base, monthlySpendEUR: null });
    expect(noSpend.value.actualWithdrawalRate).toBeNull();
    const emptyPile = fire({ ...base, fireCountedEUR: "0" });
    expect(emptyPile.value.actualWithdrawalRate).toBeNull();
  });
});
