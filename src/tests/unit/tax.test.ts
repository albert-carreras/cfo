import { describe, expect, it } from "vitest";
import { fifoCostBasis, savingsTax, taxSummary, type TaxLot } from "@/calc/tax";

const lots: TaxLot[] = [
  { id: "b", holdingId: "h", buyDate: "2022-05-01", quantity: "100", costBasisEUR: "3000" },
  { id: "a", holdingId: "h", buyDate: "2020-01-01", quantity: "100", costBasisEUR: "1000" },
];

describe("FIFO cost basis", () => {
  it("takes the oldest lots first", () => {
    expect(fifoCostBasis({ lots, alreadySold: "0", quantity: "150" })).toBe("2500.00");
  });

  it("skips units consumed by earlier sales", () => {
    expect(fifoCostBasis({ lots, alreadySold: "50", quantity: "100" })).toBe("2000.00");
  });

  it("returns null rather than guess when the lots run out", () => {
    expect(fifoCostBasis({ lots, alreadySold: "0", quantity: "250" })).toBeNull();
    expect(fifoCostBasis({ lots: [], alreadySold: "0", quantity: "1" })).toBeNull();
  });
});

describe("Spanish savings-scale tax", () => {
  it("applies each bracket to its slice only", () => {
    expect(savingsTax("6000")).toBe("1140.00");
    // 1,140 + 44,000 × 21% + 42,044.82 × 23%
    expect(savingsTax("92044.82")).toBe("20050.31");
    // top brackets: 27% to 300k, 30% beyond
    expect(savingsTax("400000")).toBe("101880.00");
  });

  it("is zero for a net loss", () => {
    expect(savingsTax("-5000")).toBe("0.00");
  });
});

describe("tax summary", () => {
  it("nets a year's gains and losses, skips unknown bases, and honours payments", () => {
    const result = taxSummary({
      snapshotId: "s",
      asOf: "2026-10-30",
      sales: [
        { id: "s1", holdingId: "h", soldAt: "2026-03-01", quantity: "10", proceedsEUR: "20000", costBasisEUR: "5000" },
        { id: "s2", holdingId: "h", soldAt: "2026-04-01", quantity: "10", proceedsEUR: "1000", costBasisEUR: "4000" },
        { id: "s3", holdingId: "h", soldAt: "2026-05-01", quantity: "10", proceedsEUR: "9000", costBasisEUR: null },
        { id: "s4", holdingId: "h", soldAt: "2025-05-01", quantity: "10", proceedsEUR: "9000", costBasisEUR: "1000" },
        { id: "future", holdingId: "h", soldAt: "2026-12-01", quantity: "10", proceedsEUR: "9000", costBasisEUR: "1" },
      ],
      settlements: [{ id: "p", year: 2025, paidAt: "2026-06-20", amountEUR: "1520" }],
    });
    const [y2026, y2025] = result.value.years;
    expect(y2026.year).toBe(2026);
    expect(y2026.gainEUR).toBe("12000.00");
    expect(y2026.unknownBasisCount).toBe(1);
    expect(y2026.taxEUR).toBe("2400.00");
    expect(y2026.dueBy).toBe("2027-06-30");
    expect(y2025.settled?.paidAt).toBe("2026-06-20");
    expect(result.value.dueEUR).toBe("2400.00");
  });
});
