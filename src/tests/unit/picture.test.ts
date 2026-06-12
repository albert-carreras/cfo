import { describe, expect, it } from "vitest";
import { picture } from "@/calc/picture";
import type { FireValue } from "@/calc/fire";
import type { NetWorthValue } from "@/calc/netWorth";

// The picture's derived ratios (the reassurance narrative's only source of
// percentages). Hand-computed from a simple bucket split.

const nw: NetWorthValue = {
  liquidEUR: "82000.00",
  investableEUR: "738000.00",
  lockedEUR: "260000.00",
  illiquidEUR: "1450000.00",
  totalEUR: "2530000.00",
  fireCountedEUR: "820000.00",
  propertyEquity: [],
};

const fire: FireValue = {
  monthlySpendEUR: "2200.00",
  runwayAssetsEUR: "820000.00",
  runwayMonths: 372.7,
  runwayYears: 31.06,
  runwayMonthsConservative: null,
  runwayMonthsOptimistic: null,
  safeWithdrawalRate: "0.035",
  safeMonthlySpendEUR: "2391.67",
};

describe("picture", () => {
  const result = picture({
    snapshotId: "snap_pic",
    netWorth: nw,
    fire,
    inputs: ["netWorth.v1", "fire.v1"],
  });

  it("computes whole-percent bucket shares that sum to ~100", () => {
    const v = result.value;
    expect(v.liquidSharePct).toBe(3);
    expect(v.investableSharePct).toBe(29);
    expect(v.lockedSharePct).toBe(10);
    expect(v.illiquidSharePct).toBe(57);
    const total =
      v.liquidSharePct! + v.investableSharePct! + v.lockedSharePct! + v.illiquidSharePct!;
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(2); // whole-% rounding
  });

  it("computes spend vs safe spend and the headroom", () => {
    // 2,200 / 2,391.67 = 91.99% → 92; headroom 8.
    expect(result.value.spendVsSafeSpendPct).toBe(92);
    expect(result.value.spendHeadroomPct).toBe(8);
  });

  it("restates runway coarsely (whole years above a decade)", () => {
    expect(result.value.runwayYearsCoarse).toBe(31);
    const short = picture({
      snapshotId: "s",
      netWorth: nw,
      fire: { ...fire, runwayYears: 7.84 },
      inputs: [],
    });
    expect(short.value.runwayYearsCoarse).toBe(7.8);
  });

  it("is versioned and traceable", () => {
    expect(result.source).toBe("picture.v1");
    expect(result.version).toBe("picture.2026.0");
    expect(result.snapshotId).toBe("snap_pic");
    expect(result.inputs).toContain("fire.v1");
  });

  it("returns nulls — never NaN — on a zero total or missing assumptions", () => {
    const empty = picture({
      snapshotId: "s",
      netWorth: { ...nw, totalEUR: "0.00" },
      fire: {
        ...fire,
        monthlySpendEUR: "0.00",
        safeMonthlySpendEUR: null,
        safeWithdrawalRate: null,
        runwayYears: null,
        runwayMonths: null,
      },
      inputs: [],
    });
    const v = empty.value;
    expect(v.liquidSharePct).toBeNull();
    expect(v.illiquidSharePct).toBeNull();
    expect(v.spendVsSafeSpendPct).toBeNull();
    expect(v.spendHeadroomPct).toBeNull();
    expect(v.runwayYearsCoarse).toBeNull();
  });
});
