import { describe, expect, it } from "vitest";
import { computeSnapshot, snapshotStatus, type SnapshotFacts } from "@/calc/snapshot";
import { facts, FIXTURE_AS_OF } from "../fixtures";

function snapshot(input: SnapshotFacts, asOf = FIXTURE_AS_OF) {
  return computeSnapshot({ snapshotId: "snapshot_test", asOf, facts: input });
}

describe("current financial snapshot", () => {
  it("buckets the position the way a person reads it", () => {
    const result = snapshot(facts);
    const nw = result.netWorth.value;

    expect(result.valuation.value.totalEUR).toBe("328974.00");
    // Bank 16,800 + broker cash 2,746: cash is cash, wherever it sits.
    expect(nw.cashEUR).toBe("19546.00");
    expect(nw.investmentsEUR).toBe("328974.00");
    expect(nw.pensionEUR).toBe("86400.00");
    expect(nw.propertyEquityEUR).toBe("435000.00");
    expect(nw.totalEUR).toBe("869920.00");
    expect(nw.availableEUR).toBe("348520.00");
    expect(nw.taxDueEUR).toBe("0.00");
  });

  it("answers the one spending question", () => {
    const fire = snapshot(facts).fire.value;
    // 348,520 × 3.5% / 12
    expect(fire.safeMonthlySpendEUR).toBe("1016.52");
    expect(fire.monthlySpendEUR).toBe("3200.00");
    expect(fire.fits).toBe(false);
    expect(fire.headroomEUR).toBe("-2183.48");
    expect(fire.runwayYears).toBe(9.1);
  });

  it("never invents a missing withdrawal rate", () => {
    const result = snapshot({
      ...facts,
      assumptions: facts.assumptions.filter((row) => row.key !== "safeWithdrawalRate"),
    });
    expect(result.fire.value.safeMonthlySpendEUR).toBeNull();
    expect(result.fire.value.fits).toBeNull();
    expect(result.attention.value.items.map((item) => item.id)).toContain("inputs-missing");
  });

  it("lists what needs attention, and nothing else", () => {
    const result = snapshot(facts);
    expect(result.attention.value.items.map((item) => item.id)).toEqual([
      "stale-values",
      "spend-above-safe",
    ]);
    expect(result.attention.value.items[0].detail).toContain("Bank — current account");
    expect(snapshotStatus(result)).toBe("attention");
  });

  it("flags a broken price feed before anything else", () => {
    const result = snapshot({
      ...facts,
      prices: facts.prices.map((price) => ({ ...price, asOf: "2026-05-01" })),
    });
    expect(result.attention.value.items[0].id).toBe("prices");
    expect(result.attention.value.items[0].level).toBe("high");
  });

  it("deducts the tax on this year's sales from net worth and the available pile", () => {
    const result = snapshot({
      ...facts,
      sales: [
        {
          id: "sale_1",
          holdingId: "hold_smh",
          soldAt: "2026-06-01",
          quantity: "100",
          proceedsEUR: "30000",
          costBasisEUR: "13500",
        },
      ],
    });
    // 16,500 gain: 6,000 × 19% + 10,500 × 21%
    expect(result.tax.value.dueEUR).toBe("3345.00");
    expect(result.netWorth.value.taxDueEUR).toBe("3345.00");
    expect(result.netWorth.value.totalEUR).toBe("866575.00");
    expect(result.netWorth.value.availableEUR).toBe("345175.00");
    expect(result.attention.value.items.map((item) => item.id)).toContain("tax-2026");
  });

  it("drops the deduction once the year is marked paid", () => {
    const result = snapshot({
      ...facts,
      sales: [
        {
          id: "sale_1",
          holdingId: "hold_smh",
          soldAt: "2026-02-01",
          quantity: "100",
          proceedsEUR: "30000",
          costBasisEUR: "13500",
        },
      ],
      taxSettlements: [
        { id: "paid_2026", year: 2026, paidAt: "2026-06-05", amountEUR: "3300" },
      ],
    });
    expect(result.tax.value.dueEUR).toBe("0.00");
    expect(result.netWorth.value.totalEUR).toBe("869920.00");
  });

  it("ties calculated values to their verified inputs", () => {
    const result = snapshot(facts);
    expect(result.netWorth.inputs).toContain("mov_dep_bank");
    expect(result.netWorth.inputs).toContain("reval_pension_q2");
    expect(result.valuation.inputs).toContain("price_vwce");
    expect(result.fire.inputs).toContain("assum_spend");
    expect(result.fire.inputs).toContain("assum_swr");
    expect(result.netWorth.source).toBe("netWorth.v3");
  });

  it("includes opted-in other assets and subtracts general debt once", () => {
    const result = snapshot({
      ...facts,
      otherAssets: [
        { id: "business", value: "50000", includeInNetWorth: true, valuedAt: FIXTURE_AS_OF },
        { id: "car", value: "20000", includeInNetWorth: false, valuedAt: FIXTURE_AS_OF },
      ],
      liabilities: [
        ...facts.liabilities,
        { id: "loan", propertyId: null, balance: "10000", valuedAt: FIXTURE_AS_OF },
      ],
    });
    expect(result.netWorth.value.otherAssetsEUR).toBe("50000.00");
    expect(result.netWorth.value.debtEUR).toBe("150000.00");
    expect(result.netWorth.value.totalEUR).toBe("909920.00");
    expect(result.netWorth.value.availableEUR).toBe("338520.00");
  });
});
