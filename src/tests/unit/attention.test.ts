import { describe, expect, it } from "vitest";
import { attention } from "@/calc/attention";
import { fire } from "@/calc/fire";
import type { TaxValue } from "@/calc/tax";

const noTax: TaxValue = { years: [], dueEUR: "0.00", scaleVersion: "test" };
const fits = fire({
  snapshotId: "s",
  availableEUR: "900000",
  monthlySpendEUR: "2200",
  safeWithdrawalRate: "0.035",
  inputs: [],
}).value;

function run(overrides: Partial<Parameters<typeof attention>[0]> = {}) {
  return attention({
    snapshotId: "s",
    asOf: "2026-10-30",
    values: [],
    prices: [],
    negativeCash: [],
    tax: noTax,
    plans: [],
    monthlySpend: { lastReviewedAt: "2026-06-10" },
    safeWithdrawalRate: { lastReviewedAt: "2026-06-09" },
    fire: fits,
    ...overrides,
  }).value.items;
}

describe("attention list", () => {
  it("is empty when nothing needs you", () => {
    expect(run()).toEqual([]);
  });

  it("groups old values into one item, oldest first", () => {
    const items = run({
      values: [
        { id: "a", kind: "cash", name: "Revolut", lastConfirmed: "2026-08-14" },
        { id: "b", kind: "cash", name: "Trade Republic", lastConfirmed: "2026-06-01" },
        { id: "c", kind: "property", name: "Berga", lastConfirmed: "2025-08-01" },
        { id: "d", kind: "units", name: "VWCE.DE units", lastConfirmed: "2026-01-01" },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("2 values haven't been confirmed in a while");
    expect(items[0].detail).toBe("Berga (1 year 3 mo), Trade Republic (5 months)");
  });

  it("puts a broken price first", () => {
    const items = run({
      values: [{ id: "b", kind: "cash", name: "Trade Republic", lastConfirmed: "2026-01-01" }],
      prices: [{ holdingId: "h", name: "AAPL", priceAsOf: null }],
    });
    expect(items[0].id).toBe("prices");
    expect(items[0].target).toEqual({ kind: "item", itemType: "holding", id: "h" });
  });

  it("asks you to keep tax aside until the year is paid, and escalates when overdue", () => {
    const tax: TaxValue = {
      scaleVersion: "test",
      dueEUR: "20050.31",
      years: [
        {
          year: 2026,
          saleCount: 1,
          proceedsEUR: "124174.00",
          gainEUR: "92044.82",
          unknownBasisCount: 0,
          taxEUR: "20050.31",
          dueBy: "2027-06-30",
          settled: null,
        },
      ],
    };
    expect(run({ tax })[0].title).toBe("Keep about €20,050 aside for 2026 tax on sales");
    const late = run({ tax, asOf: "2027-07-02" });
    expect(late[0].level).toBe("high");
  });

  it("notices a plan whose date has passed", () => {
    const items = run({
      plans: [
        { id: "p1", label: "House purchase", date: "2026-09-01" },
        { id: "p2", label: "Inheritance", date: null },
      ],
    });
    expect(items.map((item) => item.id)).toEqual(["plan-p1"]);
  });
});
