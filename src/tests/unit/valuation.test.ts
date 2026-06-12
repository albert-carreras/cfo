import { describe, expect, it } from "vitest";
import { valuation } from "@/calc/valuation";

describe("valuation", () => {
  it("values holdings as quantity × EUR price", () => {
    const result = valuation({
      snapshotId: "s",
      asOf: "2026-06-09",
      holdings: [{ id: "h1", isin: "X" }],
      quantityByHolding: { h1: "10" },
      prices: [{ id: "p1", isin: "X", price: "5", currency: "EUR", asOf: "2026-06-01" }],
      fx: [],
    });

    expect(result.value.totalEUR).toBe("50.00");
    expect(result.value.holdings[0].priced).toBe(true);
    expect(result.value.holdings[0].priceAsOf).toBe("2026-06-01");
    expect(result.inputs).toEqual(expect.arrayContaining(["h1", "p1"]));
  });

  it("converts a non-EUR price through FX and records the fx row as provenance", () => {
    const result = valuation({
      snapshotId: "s",
      asOf: "2026-06-09",
      holdings: [{ id: "h1", isin: "U" }],
      quantityByHolding: { h1: "300" },
      prices: [{ id: "p1", isin: "U", price: "270", currency: "USD", asOf: "2026-06-01" }],
      fx: [{ id: "fx1", quote: "USD", rate: "0.92", asOf: "2026-06-01" }],
    });

    // 300 × 270 × 0.92 = 74520
    expect(result.value.totalEUR).toBe("74520.00");
    expect(result.value.holdings[0].priceEUR).toBe("248.40");
    expect(result.value.holdings[0].fxAsOf).toBe("2026-06-01");
    expect(result.value.holdings[0].valuationAsOf).toBe("2026-06-01");
    expect(result.inputs).toContain("fx1");
  });

  it("flags an unpriced holding as priced:false and counts it as zero", () => {
    const result = valuation({
      snapshotId: "s",
      asOf: "2026-06-09",
      holdings: [{ id: "h1", isin: "Z" }],
      quantityByHolding: { h1: "10" },
      prices: [],
      fx: [],
    });

    expect(result.value.holdings[0].priced).toBe(false);
    expect(result.value.totalEUR).toBe("0.00");
  });

  it("a non-EUR price with NO fx rate is unpriced — never silently treated as EUR", () => {
    const result = valuation({
      snapshotId: "s",
      asOf: "2026-06-09",
      holdings: [{ id: "h1", isin: "U" }],
      quantityByHolding: { h1: "300" },
      prices: [{ id: "p1", isin: "U", price: "270", currency: "USD", asOf: "2026-06-01" }],
      fx: [],
    });

    expect(result.value.holdings[0].priced).toBe(false);
    expect(result.value.totalEUR).toBe("0.00");
    expect(result.inputs).toContain("p1");
  });

  it("with a daily price history, the latest asOf wins regardless of row order", () => {
    const result = valuation({
      snapshotId: "s",
      asOf: "2026-06-09",
      holdings: [{ id: "h1", isin: "U" }],
      quantityByHolding: { h1: "10" },
      prices: [
        { id: "p_new", isin: "U", price: "200", currency: "USD", asOf: "2026-06-09" },
        { id: "p_old", isin: "U", price: "100", currency: "USD", asOf: "2026-06-01" },
      ],
      fx: [
        { id: "fx_old", quote: "USD", rate: "0.90", asOf: "2026-06-01" },
        { id: "fx_new", quote: "USD", rate: "0.92", asOf: "2026-06-09" },
      ],
    });

    // 10 × 200 × 0.92 — the 2026-06-09 rows, not the older ones.
    expect(result.value.totalEUR).toBe("1840.00");
    expect(result.value.holdings[0].priceAsOf).toBe("2026-06-09");
    expect(result.inputs).toEqual(expect.arrayContaining(["p_new", "fx_new"]));
    expect(result.inputs).not.toContain("p_old");
    expect(result.inputs).not.toContain("fx_old");
  });

  it("ignores price and FX rows after the snapshot date", () => {
    const result = valuation({
      snapshotId: "s",
      asOf: "2026-06-09",
      holdings: [{ id: "h1", isin: "U" }],
      quantityByHolding: { h1: "10" },
      prices: [
        { id: "p_now", isin: "U", price: "100", currency: "USD", asOf: "2026-06-09" },
        { id: "p_future", isin: "U", price: "900", currency: "USD", asOf: "2026-06-10" },
      ],
      fx: [
        { id: "fx_now", quote: "USD", rate: "0.90", asOf: "2026-06-09" },
        { id: "fx_future", quote: "USD", rate: "2", asOf: "2026-06-10" },
      ],
    });

    expect(result.value.totalEUR).toBe("900.00");
    expect(result.inputs).toContain("p_now");
    expect(result.inputs).toContain("fx_now");
    expect(result.inputs).not.toContain("p_future");
    expect(result.inputs).not.toContain("fx_future");
  });
});
