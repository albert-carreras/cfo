import { describe, expect, it } from "vitest";
import { monthlyPayment, mortgageTerms } from "@/calc/mortgage";
import { dec } from "@/calc/money";

// French amortization checked against hand-computed figures:
// 300,000 at 3% over 25 years → i = 0.0025, n = 300,
// payment = 300000·0.0025 / (1 − 1.0025^−300) = 1,422.63.

describe("monthlyPayment", () => {
  it("matches the closed-form French amortization payment", () => {
    const p = monthlyPayment("300000", "0.03", 25);
    expect(p.toFixed(2)).toBe("1422.63");
  });

  it("degenerates to straight-line at a 0% rate", () => {
    expect(monthlyPayment("240000", "0", 20).toFixed(2)).toBe("1000.00");
  });

  it("is 0 for a non-positive principal or term", () => {
    expect(monthlyPayment("0", "0.03", 25).isZero()).toBe(true);
    expect(monthlyPayment("-100", "0.03", 25).isZero()).toBe(true);
    expect(monthlyPayment("100000", "0.03", 0).isZero()).toBe(true);
  });
});

describe("mortgageTerms", () => {
  const result = mortgageTerms({
    snapshotId: "snap_m",
    principalEUR: "300000",
    rateAnnual: "0.03",
    termYears: 25,
  });

  it("carries payment, total interest and total paid", () => {
    expect(result.value.monthlyPaymentEUR).toBe("1422.63");
    // 1422.63… × 300 − 300000 (computed on the unrounded payment).
    expect(dec(result.value.totalPaidEUR).minus("300000").toFixed(2)).toBe(
      result.value.totalInterestEUR,
    );
    expect(dec(result.value.totalInterestEUR).greaterThan("126000")).toBe(true);
    expect(dec(result.value.totalInterestEUR).lessThan("127000")).toBe(true);
  });

  it("stresses the same loan at +2 points", () => {
    expect(result.value.stress.rateAnnual).toBe("0.05");
    // 300,000 at 5% over 25y → 1,753.77.
    expect(result.value.stress.monthlyPaymentEUR).toBe("1753.77");
    expect(result.value.stress.deltaMonthlyEUR).toBe("331.14");
  });

  it("is versioned with empty inputs (no facts consumed — terms only)", () => {
    expect(result.source).toBe("mortgage.v1");
    expect(result.version).toBe("mortgage.2026.1");
    expect(result.inputs).toEqual([]);
    expect(result.snapshotId).toBe("snap_m");
  });
});
