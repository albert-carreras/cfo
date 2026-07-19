import { describe, expect, it } from "vitest";
import { fire, fireHeadroom, type FireBand } from "@/calc/fire";

function band(spend: string | null, safe: string | null): FireBand {
  return {
    monthlySpendEUR: spend,
    runwayAssetsEUR: "0.00",
    runwayMonths: null,
    runwayYears: null,
    safeWithdrawalRate: null,
    safeMonthlySpendEUR: safe,
    holds: null,
  };
}

describe("fireHeadroom", () => {
  it("is positive when the safe draw exceeds spend", () => {
    expect(fireHeadroom(band("3000.00", "3213.00"))).toBe("213.00");
  });

  it("is negative when spend exceeds the safe draw", () => {
    expect(fireHeadroom(band("2500.00", "2350.00"))).toBe("-150.00");
  });

  it("is null when either side is missing", () => {
    expect(fireHeadroom(band(null, "3000.00"))).toBeNull();
    expect(fireHeadroom(band("3000.00", null))).toBeNull();
  });

  it("matches the base band computed by fire()", () => {
    const result = fire({
      snapshotId: "s",
      liquidEUR: "100000.00",
      investableEUR: "200000.00",
      fireCountedEUR: "300000.00",
      monthlySpendEUR: "800.00",
      safeWithdrawalRate: "0.035",
      inputs: [],
    });
    // safe = 300000 * 0.035 / 12 = 875.00; headroom = 875 - 800 = 75.
    expect(fireHeadroom(result.value.bands!.base)).toBe("75.00");
  });
});
