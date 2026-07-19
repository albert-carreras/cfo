import { describe, expect, it } from "vitest";
import {
  buyHouseScenario,
  type ComputeVariant,
} from "@/calc/scenario";
import { computeSnapshot } from "@/calc/snapshot";
import { dec } from "@/calc/money";
import { facts, FIXTURE_AS_OF } from "../fixtures";

// The buy-house scenario against hand-computed figures from the committed
// fixture. Bank cash 16,800; VWCE 2,010 units @125.40 (lots 1,200@80 +
// 800@110 + 10@125.40); monthlySpend assumption 3,200; savings base 0.

const base = computeSnapshot({
  snapshotId: "snap_buy",
  asOf: FIXTURE_AS_OF,
  reviewDue: false,
  facts,
  withScenarios: false,
});

const compute: ComputeVariant = (variantFacts) =>
  computeSnapshot({
    snapshotId: "snap_buy",
    asOf: FIXTURE_AS_OF,
    reviewDue: false,
    facts: variantFacts,
    withScenarios: false,
  });

const byLabel = (s: { value: { breakdown: { label: string; valueEUR: string | null }[] } }) =>
  Object.fromEntries(s.value.breakdown.map((r) => [r.label, r.valueEUR]));

describe("buyHouseScenario", () => {
  // €400k at 20% down, 3% over 25y, funded by selling VWCE:
  // ITP 40,000 · costs 6,000 · down 80,000 · upfront 126,000 · principal
  // 320,000 · gap 126,000 − 16,800 = 109,200 sold from VWCE (FIFO: all from
  // the 80€ lot → basis 69,665.07, gain 39,534.93, tax 1,140 + 21% over 6k).
  const scenario = buyHouseScenario({
    base,
    facts,
    compute,
    params: {
      priceEUR: "400000",
      downPaymentRate: "0.20",
      mortgageRateAnnual: "0.03",
      termYears: 25,
    fundFromHoldingIds: ["hold_vwce"],
    },
    holdingNameById: { hold_vwce: "VWCE" },
  })!;

  it("computes ITP, costs, down payment and upfront cash exactly", () => {
    const rows = byLabel(scenario);
    expect(rows["Purchase price"]).toBe("-400000.00");
    expect(rows["ITP (progressive scale)"]).toBe("-40000.00");
    expect(rows["Other purchase costs (rough)"]).toBe("-6000.00");
    expect(rows["Mortgage principal (borrowed)"]).toBe("320000.00");
    expect(rows["Upfront cash needed"]).toBe("-126000.00");
  });

  it("carries the mortgage terms (mortgage.v1) including the stress leg", () => {
    expect(scenario.value.mortgage?.monthlyPaymentEUR).toBe("1517.48");
    expect(scenario.value.mortgage?.stress.rateAnnual).toBe("0.05");
    expect(
      dec(scenario.value.mortgage!.stress.monthlyPaymentEUR).greaterThan(
        dec(scenario.value.mortgage!.monthlyPaymentEUR),
      ),
    ).toBe(true);
  });

  it("sells just the funding gap from the listed position, FIFO-taxed", () => {
    expect(scenario.value.fundingSales).toHaveLength(1);
    const sale = scenario.value.fundingSales![0];
    expect(sale.holdingId).toBe("hold_vwce");
    expect(sale.grossEUR).toBe("109200.00");
    // 109,200 − 109,200·80/125.40 = 39,534.93.
    expect(sale.gainEUR).toBe("39534.93");
    const rows = byLabel(scenario);
    expect(rows["Sold to fund — VWCE"]).toBe("109200.00");
    // 1,140 + (39,534.93 − 6,000)·21% = 8,182.34.
    expect(rows["CG tax on funding sales (due next year)"]).toBe("-8182.34");
    expect(scenario.value.uncoveredShortfallEUR).toBeUndefined();
  });

  it("diffs the snapshot: net worth drops by exactly ITP + costs; runway drops with the payment in spend", () => {
    // Cash −126,000 + 109,200 · property +400,000 · mortgage −320,000 ·
    // holdings −109,200 ⇒ Δ = −46,000 (the transaction frictions).
    expect(scenario.value.diff.netWorthTotal.deltaEUR).toBe("-46000.00");
    const d = scenario.value.diff;
    expect(d.runwayYears.variant!).toBeLessThan(d.runwayYears.base!);
    // Δ tax carries the one-off ITP plus the variant's own CG pickup.
    expect(dec(d.taxYear.deltaEUR).greaterThan(48000)).toBe(true);
  });

  it("is irreversible, versioned, and traceable to the facts it used", () => {
    expect(scenario.value.kind).toBe("buy-house");
    expect(scenario.value.irreversible).toBe(true);
    expect(scenario.version).toBe("scenario.es.2026.8");
    expect(scenario.inputs).toContain("hold_vwce");
    expect(scenario.inputs).toContain("lot_vwce_1");
    expect(scenario.inputs).toContain("assum_spend");
    expect(scenario.inputs).toContain("acc_bank");
    // One-off tax = ITP + funding CG (no chained sale).
    expect(scenario.value.oneOffTaxEUR).toBe("48182.34");
    expect(scenario.value.proceedsEUR).toBe("-126000.00");
  });

  it("applies the progressive ITP tramos above 600k", () => {
    // €1M all-cash: 600k·10% + 300k·11% + 100k·12% = 105,000.
    const allCash = buyHouseScenario({
      base,
      facts,
      compute,
      params: {
        priceEUR: "1000000",
        downPaymentRate: "1",
        mortgageRateAnnual: "0.03",
        termYears: 25,
      },
    })!;
    const rows = byLabel(allCash);
    expect(rows["ITP (progressive scale)"]).toBe("-105000.00");
    expect(rows["Mortgage principal (borrowed)"]).toBe("0.00");
    expect(allCash.value.mortgage?.monthlyPaymentEUR).toBe("0.00");
    // Nothing to sell listed ⇒ the uncovered shortfall is printed, not hidden.
    expect(dec(allCash.value.uncoveredShortfallEUR!).greaterThan(0)).toBe(true);
  });

  it("nets a replaced rent against the payment in the spend assumption", () => {
    const withRent = buyHouseScenario({
      base,
      facts,
      compute,
      params: {
        priceEUR: "400000",
        downPaymentRate: "0.20",
        mortgageRateAnnual: "0.03",
        termYears: 25,
        fundFromHoldingIds: ["hold_vwce"],
        monthlyRentSavedEUR: "1000",
      },
    })!;
    // Spend rises by 1,517.47 − 1,000 = 517.47 instead of the full payment ⇒
    // the runway after is strictly better than the no-rent variant's.
    expect(withRent.value.diff.runwayYears.variant!).toBeGreaterThan(
      scenario.value.diff.runwayYears.variant!,
    );
  });

  it("chains a sale of an existing property: proceeds fund the purchase first", () => {
    const move = buyHouseScenario({
      base,
      facts,
      compute,
      params: {
        priceEUR: "400000",
        downPaymentRate: "0.20",
        mortgageRateAnnual: "0.03",
        termYears: 25,
        sellPropertyId: "prop_rent_a",
        fundFromHoldingIds: ["hold_vwce"],
      },
      propertyNameById: { prop_rent_a: "Rental A" },
    })!;
    const rows = byLabel(move);
    // Rental A nets 165,660 (existing sell-property figures) ⇒ cash covers the
    // 126,000 upfront with no funding sale.
    expect(rows["Net proceeds — selling Rental A"]).toBe("165660.00");
    expect(move.value.fundingSales).toBeUndefined();
    // One-off tax = ITP 40,000 + sale CG 4,290 + plusvalía 1,050.
    expect(move.value.oneOffTaxEUR).toBe("45340.00");
    // Δ net worth = sale friction (−14,340) + purchase friction (−46,000).
    expect(move.value.diff.netWorthTotal.deltaEUR).toBe("-60340.00");
    expect(move.inputs).toContain("prop_rent_a");
  });
});
