import { describe, expect, it } from "vitest";
import { netWorth, type NwAccount } from "@/calc/netWorth";

const accounts: NwAccount[] = [
  { id: "bank", type: "bank" },
  { id: "broker", type: "broker" },
  { id: "pension", type: "pension" },
];

describe("netWorth", () => {
  it("buckets by account type and computes property equity net of mortgage", () => {
    const result = netWorth({
      snapshotId: "s",
      accounts,
      cashByAccount: { bank: "10000", broker: "1000", pension: "50000" },
      holdingValues: [
        { holdingId: "h1", accountId: "broker", valueEUR: "200000" },
        { holdingId: "h2", accountId: "pension", valueEUR: "30000" },
      ],
      properties: [{ id: "p1", value: "300000", ownershipPct: "50" }],
      liabilities: [{ id: "l1", propertyId: "p1", balance: "100000" }],
    });

    const v = result.value;
    expect(v.liquidEUR).toBe("10000.00");
    expect(v.investableEUR).toBe("201000.00"); // broker cash + broker holdings
    expect(v.lockedEUR).toBe("80000.00"); // pension cash + pension holdings
    // 300000 × 50% − 100000 = 50000
    expect(v.illiquidEUR).toBe("50000.00");
    expect(v.totalEUR).toBe("341000.00");
  });

  it("excludes locked (pension) assets from FIRE-counted wealth", () => {
    const result = netWorth({
      snapshotId: "s",
      accounts,
      cashByAccount: { bank: "10000", broker: "1000", pension: "50000" },
      holdingValues: [{ holdingId: "h2", accountId: "pension", valueEUR: "30000" }],
      properties: [],
      liabilities: [],
    });

    // fireCounted = liquid + investable, never the pension
    expect(result.value.fireCountedEUR).toBe("11000.00");
    expect(result.value.lockedEUR).toBe("80000.00");
  });
});
