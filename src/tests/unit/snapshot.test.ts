import { describe, expect, it } from "vitest";
import { computeSnapshot, type SnapshotFacts } from "@/calc/snapshot";
import { facts, FIXTURE_AS_OF } from "../fixtures";

function snapshot(input: SnapshotFacts, asOf = FIXTURE_AS_OF) {
  return computeSnapshot({
    snapshotId: "snapshot_test",
    asOf,
    reviewDue: false,
    facts: input,
  });
}

describe("current financial snapshot", () => {
  it("computes the verified position and independence plan", () => {
    const result = snapshot(facts);

    expect(result.valuation.value.totalEUR).toBe("328974.00");
    expect(result.netWorth.value.totalEUR).toBe("869920.00");
    expect(result.netWorth.value.fireCountedEUR).toBe("348520.00");
    expect(result.netWorth.value.lockedEUR).toBe("86400.00");
    expect(result.fire.value.monthlySpendEUR).toBe("3200.00");
    expect(result.fire.value.runwayMonths).toBe(108.9);
    expect(result.status.value.status).toBe("action_recommended");
  });

  it("replays the legacy ledger without requiring routine logging", () => {
    const before = snapshot(facts);
    const after = snapshot({
      ...facts,
      movements: [
        ...facts.movements,
        {
          id: "expense",
          type: "expense",
          accountId: "acc_bank",
          holdingId: null,
          quantity: null,
          amount: "2000",
          occurredAt: "2026-06-08",
          correctsId: null,
        },
      ],
      monthlySpend: [],
    });

    expect(Number(before.netWorth.value.totalEUR) - Number(after.netWorth.value.totalEUR)).toBe(2000);
    expect(after.fire.value.monthlySpendEUR).toBe("3200.00");
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
    expect(result.netWorth.value.fireCountedEUR).toBe("348520.00");
  });

  it("ties calculated values to their verified inputs", () => {
    const result = snapshot(facts);
    expect(result.netWorth.inputs).toContain("mov_dep_bank");
    expect(result.netWorth.inputs).toContain("reval_pension_q2");
    expect(result.valuation.inputs).toContain("price_vwce");
    expect(result.fire.inputs).toContain("assum_spend");
    expect(result.fire.inputs).toContain("assum_swr");
    expect(result.netWorth.source).toBe("netWorth.v2");
    expect(result.netWorth.version).toBe("netWorth.2026.3");
  });

  it("marks the picture stale when a required market input is stale", () => {
    const result = snapshot({
      ...facts,
      prices: facts.prices.map((price) => ({ ...price, asOf: "2026-05-01" })),
    });
    expect(result.dataQuality.value.missingRequired).toContain("Market prices");
    expect(result.status.value.status).toBe("data_stale");
  });

  it("never invents a missing withdrawal rate", () => {
    const result = snapshot({
      ...facts,
      assumptions: facts.assumptions.filter((row) => row.key !== "safeWithdrawalRate"),
    });
    expect(result.fire.value.safeWithdrawalRate).toBeNull();
    expect(result.fire.value.safeMonthlySpendEUR).toBeNull();
    expect(result.dataQuality.value.missingRequired).toContain("Safe withdrawal rate");
  });

  it("does not require monthly spending logs", () => {
    const result = snapshot({
      ...facts,
      monthlySpend: [],
      assumptions: facts.assumptions.map((row) =>
        row.key === "monthlySpend" ? { ...row, value: "1000" } : row,
      ),
    });
    expect(result.dataQuality.value.missingRequired).toEqual([]);
    expect(result.status.value.status).toBe("stable");
  });
});
