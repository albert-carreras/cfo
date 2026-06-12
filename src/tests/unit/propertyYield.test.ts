import { describe, expect, it } from "vitest";
import { propertyYield } from "@/calc/propertyYield";

// Unlevered yield vs the assumed real ETF return — pure, hand-computed.

const flat = {
  id: "prop_x",
  value: "300000",
  rentMonthly: "1000",
  costsMonthly: "200",
  isPrimaryResidence: false,
};

describe("propertyYield", () => {
  it("computes gross/net unlevered yields and the real comparison", () => {
    const result = propertyYield({
      snapshotId: "s",
      properties: [flat],
      expectedReturnAnnual: "0.07",
      longRunInflationAnnual: "0.02",
      inputs: ["prop_x", "assum_return", "assum_lri"],
    });
    const line = result.value.properties[0];
    expect(line.grossYield).toBe("0.040000"); // 12000 / 300000
    expect(line.netYield).toBe("0.032000"); // 9600 / 300000
    expect(line.realNetYield).toBe("0.011765"); // 1.032/1.02 − 1
    expect(line.etfRealReturn).toBe("0.049020"); // 1.07/1.02 − 1
    expect(line.realGap).toBe("-0.037255"); // the ETF assumption wins
    expect(result.source).toBe("propertyYield.v1");
    expect(result.version).toBe("propertyYield.2026.1");
    expect(result.inputs).toContain("assum_return");
  });

  it("flips the gap sign when the property out-yields the assumption", () => {
    const result = propertyYield({
      snapshotId: "s",
      properties: [{ ...flat, rentMonthly: "2000" }], // net 7.2%
      expectedReturnAnnual: "0.05",
      longRunInflationAnnual: "0.02",
      inputs: [],
    });
    expect(Number(result.value.properties[0].realGap)).toBeGreaterThan(0);
  });

  it("leaves the real fields null when either assumption is missing", () => {
    for (const args of [
      { expectedReturnAnnual: null, longRunInflationAnnual: "0.02" },
      { expectedReturnAnnual: "0.07", longRunInflationAnnual: null },
    ]) {
      const result = propertyYield({
        snapshotId: "s",
        properties: [flat],
        ...args,
        inputs: [],
      });
      const line = result.value.properties[0];
      expect(line.grossYield).toBe("0.040000"); // the unlevered yield survives
      expect(line.realNetYield).toBeNull();
      expect(line.etfRealReturn).toBeNull();
      expect(line.realGap).toBeNull();
    }
  });

  it("lets a negative net yield (costs above rent) flow through honestly", () => {
    const result = propertyYield({
      snapshotId: "s",
      properties: [{ ...flat, rentMonthly: "100", costsMonthly: "300" }],
      expectedReturnAnnual: "0.07",
      longRunInflationAnnual: "0.02",
      inputs: [],
    });
    expect(Number(result.value.properties[0].netYield)).toBeLessThan(0);
  });

  it("skips a property with non-positive value instead of dividing by it", () => {
    const result = propertyYield({
      snapshotId: "s",
      properties: [{ ...flat, value: "0" }],
      expectedReturnAnnual: "0.07",
      longRunInflationAnnual: "0.02",
      inputs: [],
    });
    expect(result.value.properties).toHaveLength(0);
  });

  it("includes the primary residence, flagged", () => {
    const result = propertyYield({
      snapshotId: "s",
      properties: [{ ...flat, isPrimaryResidence: true }],
      expectedReturnAnnual: null,
      longRunInflationAnnual: null,
      inputs: [],
    });
    expect(result.value.properties[0].isPrimaryResidence).toBe(true);
  });
});
