import { describe, expect, it } from "vitest";
import {
  plannedEventsScenario,
  sellPositionScenario,
  sellPropertyScenario,
  type ComputeVariant,
} from "@/calc/scenario";
import { computeSnapshot, type SnapshotFacts } from "@/calc/snapshot";
import { dec, sum } from "@/calc/money";
import { facts, FIXTURE_AS_OF } from "../fixtures";

// The scenario engine: a scenario is a pure transform over the facts,
// the full snapshot recomputes, and the DIFF is the advice's number. The math
// here is checked against hand-computed figures from the committed fixture
// (savings scale 19/21/23..., sale costs 5%, plusvalía 5% of gain).

const base = computeSnapshot({
  snapshotId: "snap_scenario",
  asOf: FIXTURE_AS_OF,
  reviewDue: false,
  facts,
  withScenarios: false,
});

const compute: ComputeVariant = (variantFacts) =>
  computeSnapshot({
    snapshotId: "snap_scenario",
    asOf: FIXTURE_AS_OF,
    reviewDue: false,
    facts: variantFacts,
    withScenarios: false,
  });

describe("sellPropertyScenario", () => {
  // Rental A: value 180,000, purchase 150,000, 100% owned, no mortgage.
  // gross 180,000 · costs 9,000 · gain 21,000 · CG tax 1,140 + 15,000×21% =
  // 4,290 · plusvalía 1,050 · net proceeds 165,660.
  const rentalA = sellPropertyScenario({
    base,
    facts,
    compute,
    propertyId: "prop_rent_a",
    propertyName: "Apartment — rental A",
  })!;

  it("computes the sale breakdown exactly (CG tax, rough plusvalía, proceeds)", () => {
    expect(rentalA.value.oneOffTaxEUR).toBe("5340.00");
    expect(rentalA.value.proceedsEUR).toBe("165660.00");
    const byLabel = Object.fromEntries(
      rentalA.value.breakdown.map((r) => [r.label, r.valueEUR]),
    );
    expect(byLabel["Gross sale (owner share)"]).toBe("180000.00");
    expect(byLabel["Selling costs"]).toBe("-9000.00");
    expect(byLabel["Capital-gains tax (savings scale)"]).toBe("-4290.00");
    expect(byLabel["Plusvalía municipal (rough)"]).toBe("-1050.00");
  });

  it("diffs the full snapshot: net worth drops by equity minus proceeds, runway and safe spend rise", () => {
    // Equity 180,000 out, 165,660 cash in ⇒ −14,340.
    expect(rentalA.value.diff.netWorthTotal.deltaEUR).toBe("-14340.00");
    const d = rentalA.value.diff;
    expect(d.runwayYears.variant!).toBeGreaterThan(d.runwayYears.base!);
    expect(dec(d.safeMonthlySpend.deltaEUR).greaterThan(0)).toBe(true);
    // The variant's tax-year estimate carries the one-off sale taxes.
    expect(dec(d.taxYear.deltaEUR).greaterThan(0)).toBe(true);
  });

  it("is irreversible, versioned and traceable to the base snapshot and the facts it used", () => {
    expect(rentalA.value.irreversible).toBe(true);
    expect(rentalA.snapshotId).toBe("snap_scenario");
    expect(rentalA.source).toBe("scenario.v1");
    expect(rentalA.version).toBe("scenario.es.2026.7");
    expect(rentalA.inputs).toContain("prop_rent_a");
    expect(rentalA.inputs).toContain("acc_bank"); // proceeds destination
  });

  it("carries the unlevered yield comparison and its exclusion when provided", () => {
    const withYield = sellPropertyScenario({
      base,
      facts,
      compute,
      propertyId: "prop_rent_a",
      yieldComparison: {
        propertyId: "prop_rent_a",
        grossYield: "0.060000",
        netYield: "0.050000",
        isPrimaryResidence: false,
        realNetYield: "0.029412",
        etfRealReturn: "0.049020",
        realGap: "-0.019608",
      },
    })!;
    expect(withYield.value.yieldComparison?.realGap).toBe("-0.019608");
    expect(
      withYield.value.exclusions.some((e) => e.includes("UNLEVERED")),
    ).toBe(true);
    // Absent input ⇒ absent field and no extra exclusion (degradation).
    expect("yieldComparison" in rentalA.value).toBe(false);
    expect(rentalA.value.exclusions.some((e) => e.includes("UNLEVERED"))).toBe(
      false,
    );
  });

  it("attaches the snapshot's propertyYield lines to the standard sell-property scenarios", () => {
    const snap = computeSnapshot({
      snapshotId: "snap_full",
      asOf: FIXTURE_AS_OF,
      reviewDue: false,
      facts,
    });
    expect(snap.propertyYield).toBeTruthy();
    expect(snap.propertyYield!.inputs).toContain("assum_return");
    expect(snap.propertyYield!.inputs).toContain("assum_lri");
    const sellRentalA = snap.scenarios!.find(
      (s) => s.value.key === "sell-property:prop_rent_a",
    )!;
    // Rental A: net (900−150)·12/180000 = 0.05; real 1.05/1.02 − 1.
    expect(sellRentalA.value.yieldComparison?.netYield).toBe("0.050000");
    expect(sellRentalA.value.yieldComparison?.realNetYield).toBe("0.029412");
    expect(sellRentalA.value.yieldComparison?.etfRealReturn).toBe("0.049020");
  });

  it("repays the mortgage and exempts the primary residence's CG (relief assumed)", () => {
    // Home: gross 320,000 · costs 16,000 · gain 54,000 · CG exempt (primary
    // residence) · plusvalía 2,700 · mortgage 140,000 ⇒ net proceeds 161,300.
    const home = sellPropertyScenario({
      base,
      facts,
      compute,
      propertyId: "prop_home",
    })!;
    const byLabel = Object.fromEntries(
      home.value.breakdown.map((r) => [r.label, r.valueEUR]),
    );
    expect(byLabel["Mortgage repaid"]).toBe("-140000.00");
    expect(byLabel["Capital-gains tax (savings scale)"]).toBe("0.00");
    expect(home.value.oneOffTaxEUR).toBe("2700.00");
    expect(home.value.proceedsEUR).toBe("161300.00");
    expect(home.inputs).toContain("liab_home_mortgage");
    expect(
      home.value.exclusions.some((e) =>
        e.includes("primary-residence CG exemption assumed"),
      ),
    ).toBe(true);
  });

  it("states the tax as unknown — never 0 — without a recorded purchase price", () => {
    const noBasis: SnapshotFacts = {
      ...facts,
      properties: facts.properties.map((p) =>
        p.id === "prop_rent_a" ? { ...p, purchasePrice: null } : p,
      ),
    };
    const result = sellPropertyScenario({
      base: compute(noBasis),
      facts: noBasis,
      compute,
      propertyId: "prop_rent_a",
    })!;
    expect(result.value.oneOffTaxEUR).toBeNull();
    // 2026.7: unknown tax ⇒ proceeds are unknown too, never the pre-tax
    // figure presented as if the sale were tax-free.
    expect(result.value.proceedsEUR).toBeNull();
    expect(result.value.basisIncomplete).toBe(true);
    const cgRow = result.value.breakdown.find((r) =>
      r.label.startsWith("Capital-gains"),
    );
    expect(cgRow?.valueEUR).toBeNull();
    const netRow = result.value.breakdown.find((r) =>
      r.label.startsWith("Net proceeds"),
    );
    expect(netRow?.valueEUR).toBeNull();
    // The Δ is an upper bound (variant recomputed with PRE-TAX proceeds) and
    // says so first.
    expect(result.value.exclusions[0]).toContain("upper bound");
    expect(
      result.value.exclusions.some((e) => e.includes("no purchase price")),
    ).toBe(true);
    // The basis-complete card stays untouched.
    expect(rentalA.value.basisIncomplete).toBeUndefined();
  });

  it("treats a zero purchase price as no basis — unknown tax, never a 100% gain", () => {
    const zeroBasis: SnapshotFacts = {
      ...facts,
      properties: facts.properties.map((p) =>
        p.id === "prop_rent_a" ? { ...p, purchasePrice: "0" } : p,
      ),
    };
    const result = sellPropertyScenario({
      base: compute(zeroBasis),
      facts: zeroBasis,
      compute,
      propertyId: "prop_rent_a",
    })!;
    expect(result.value.oneOffTaxEUR).toBeNull();
    expect(result.value.proceedsEUR).toBeNull(); // unknown tax ⇒ unknown proceeds
    expect(result.value.basisIncomplete).toBe(true);
    expect(
      result.value.exclusions.some((e) => e.includes("no purchase price")),
    ).toBe(true);
  });

  it("returns null for an unknown property", () => {
    expect(
      sellPropertyScenario({ base, facts, compute, propertyId: "nope" }),
    ).toBeNull();
  });
});

describe("sellPositionScenario", () => {
  // VWCE: 2,010 shares @ €125.40 = 252,054 gross. FIFO basis 96,000 + 88,000
  // + 1,254 = 185,254 ⇒ gain 66,800 ⇒ at-once tax 1,140 + 9,240 + 3,864 =
  // 14,244 on a zero savings base.
  const vwce = sellPositionScenario({
    base,
    facts,
    compute,
    holdingId: "hold_vwce",
    holdingName: "VWCE",
  })!;

  it("computes the at-once FIFO gain and tax exactly", () => {
    expect(vwce.value.atOnceTaxEUR).toBe("14244.00");
    expect(vwce.value.proceedsEUR).toBe("237810.00"); // 252,054 − 14,244
    const gainRow = vwce.value.breakdown.find((r) =>
      r.label.startsWith("Realized gain"),
    );
    expect(gainRow?.valueEUR).toBe("66800.00");
  });

  it("spreads tranches over the configured years, FIFO continuing, and taxes each year separately", () => {
    expect(vwce.value.tranches).toHaveLength(3);
    // Same shares, same price: tranche gains must sum to the at-once gain.
    expect(
      sum(vwce.value.tranches!.map((t) => t.gainEUR)).toFixed(2),
    ).toBe("66800.00");
    // Spreading restarts the progressive scale each year ⇒ strictly cheaper.
    expect(dec(vwce.value.spreadTaxSavingEUR!).greaterThan(0)).toBe(true);
    expect(
      dec(vwce.value.atOnceTaxEUR!)
        .minus(dec(vwce.value.spreadTaxEUR!))
        .toFixed(2),
    ).toBe(vwce.value.spreadTaxSavingEUR);
  });

  it("adds the grown spread variant (scenario.es.2026.5) without touching the headline", () => {
    // The fixture's expectedReturn (0.07, nominal) prices tranche i at
    // price·1.07^i. Year-0 tranche is identical; later tranches grow.
    const grown = vwce.value.tranchesGrown!;
    expect(grown).toHaveLength(3);
    expect(grown[0].proceedsEUR).toBe(vwce.value.tranches![0].proceedsEUR);
    expect(dec(grown[1].proceedsEUR).greaterThan(vwce.value.tranches![1].proceedsEUR)).toBe(true);
    // More proceeds ⇒ more gain ⇒ more tax than the 0%-growth spread.
    expect(dec(vwce.value.spreadTaxGrownEUR!).greaterThan(vwce.value.spreadTaxEUR!)).toBe(true);
    // Neutral delta: atOnce − spreadGrown, sign carried honestly.
    expect(
      dec(vwce.value.atOnceTaxEUR!)
        .minus(dec(vwce.value.spreadTaxGrownEUR!))
        .toFixed(2),
    ).toBe(vwce.value.spreadTaxDeltaGrownEUR);
    expect(vwce.value.grownAtReturnAnnual).toBe("0.07");
    expect(vwce.inputs).toContain("assum_return");
    // The headline never grows: at-once leg and diff stay at today's price.
    expect(vwce.value.diff.netWorthTotal.deltaEUR).toBe("0.00");
    expect(
      vwce.value.exclusions.some((e) => e.includes("expectedReturn assumption")),
    ).toBe(true);
  });

  it("the grown delta can be NEGATIVE — high growth makes spreading cost more", () => {
    const hot = sellPositionScenario({
      base,
      facts: {
        ...facts,
        assumptions: facts.assumptions.map((a) =>
          a.key === "expectedReturn" ? { ...a, value: "0.5" } : a,
        ),
      },
      compute,
      holdingId: "hold_vwce",
    })!;
    expect(dec(hot.value.spreadTaxDeltaGrownEUR!).lessThan(0)).toBe(true);
    // The 0%-growth comparison and the headline stay untouched by the
    // assumption (the no-markup assertion).
    expect(hot.value.spreadTaxEUR).toBe(vwce.value.spreadTaxEUR);
    expect(hot.value.atOnceTaxEUR).toBe(vwce.value.atOnceTaxEUR);
    expect(hot.value.diff.netWorthTotal.deltaEUR).toBe(
      vwce.value.diff.netWorthTotal.deltaEUR,
    );
  });

  it("omits the grown variant when expectedReturn is unset (degradation)", () => {
    const without = sellPositionScenario({
      base,
      facts: {
        ...facts,
        assumptions: facts.assumptions.filter(
          (a) => a.key !== "expectedReturn",
        ),
      },
      compute,
      holdingId: "hold_vwce",
    })!;
    expect("tranchesGrown" in without.value).toBe(false);
    expect(without.value.spreadTaxDeltaGrownEUR).toBeUndefined();
    expect(without.inputs).not.toContain("assum_return");
    // Legacy fields identical — the assumption only adds, never alters.
    expect(without.value.tranches).toEqual(vwce.value.tranches);
    expect(without.value.spreadTaxSavingEUR).toBe(vwce.value.spreadTaxSavingEUR);
    expect(
      without.value.exclusions.some((e) =>
        e.includes("future tranches assume today's price"),
      ),
    ).toBe(true);
  });

  it("a negative assumed return shrinks the grown proceeds, taxes floored at 0", () => {
    const down = sellPositionScenario({
      base,
      facts: {
        ...facts,
        assumptions: facts.assumptions.map((a) =>
          a.key === "expectedReturn" ? { ...a, value: "-0.5" } : a,
        ),
      },
      compute,
      holdingId: "hold_vwce",
    })!;
    const grown = down.value.tranchesGrown!;
    expect(dec(grown[2].proceedsEUR).lessThan(down.value.tranches![2].proceedsEUR)).toBe(true);
    for (const t of grown) {
      expect(dec(t.taxEUR).greaterThanOrEqualTo(0)).toBe(true);
    }
  });

  it("the snapshot diff moves the gain into the year's tax estimate, not into net worth", () => {
    // Selling swaps holding value for the same cash today; the CG tax lands in
    // the tax-year estimate (paid the following June), not today's net worth.
    expect(vwce.value.diff.netWorthTotal.deltaEUR).toBe("0.00");
    // 14,244 CG + 52.72 general: the gain pushes the total base past 12,450,
    // so Cataluña's raised low-income autonomic minimum (6,105) falls back to
    // 5,550 — the full-snapshot diff catches what the marginal CG figure
    // alone cannot.
    expect(vwce.value.diff.taxYear.deltaEUR).toBe("14296.72");
  });

  it("a position below basis sells with zero CG tax and zero spread saving", () => {
    // AGGH: 500 × €4.80 = 2,400 vs basis 2,600 — a loss, floored to €0 tax.
    const aggh = sellPositionScenario({
      base,
      facts,
      compute,
      holdingId: "hold_aggh",
    })!;
    expect(aggh.value.atOnceTaxEUR).toBe("0.00");
    expect(aggh.value.spreadTaxSavingEUR).toBe("0.00");
  });

  it("returns null for an unknown or unpriced holding", () => {
    expect(
      sellPositionScenario({ base, facts, compute, holdingId: "nope" }),
    ).toBeNull();
  });
});

describe("plannedEventsScenario", () => {
  const withEvents: SnapshotFacts = {
    ...facts,
    plannedEvents: [
      {
        id: "ev_house",
        type: "house_purchase",
        date: "2027-03-01",
        amount: "80000", // a magnitude — the type owns the sign (2026.6)
        probability: "0.9",
        includedInBaseCase: true,
        realisedAt: null,
      },
      {
        id: "ev_inherit",
        type: "inheritance",
        date: "2030-01-01",
        amount: "100000",
        probability: "0.5",
        includedInBaseCase: false,
        realisedAt: null,
      },
      {
        id: "ev_done",
        type: "inheritance",
        date: "2025-01-01",
        amount: "50000",
        probability: "1",
        includedInBaseCase: true,
        realisedAt: "2025-02-01T00:00:00.000Z", // already in the ledger
      },
    ],
  };
  const eventBase = compute(withEvents);

  it("base case applies only includedInBaseCase events; a house purchase is a wealth-neutral swap", () => {
    const result = plannedEventsScenario({
      base: eventBase,
      facts: withEvents,
      compute,
      mode: "base",
    })!;
    // Cash −80,000, synthetic property +80,000: net worth flat — the honest
    // cost shows up in the liquid pile and the runway, not as a windfall.
    expect(result.value.diff.netWorthTotal.deltaEUR).toBe("0.00");
    expect(result.value.diff.fireCounted.deltaEUR).toBe("-80000.00");
    expect(result.value.diff.runwayYears.variant!).toBeLessThan(
      result.value.diff.runwayYears.base!,
    );
    expect(result.value.proceedsEUR).toBe("-80000.00");
    expect(
      result.value.exclusions.some((e) => e.includes("swaps cash")),
    ).toBe(true);
    expect(result.value.irreversible).toBe(false);
    expect(result.inputs).toContain("ev_house");
    expect(result.inputs).not.toContain("ev_inherit");
  });

  it("optimistic adds the rest at face value; realised events never re-apply", () => {
    const result = plannedEventsScenario({
      base: eventBase,
      facts: withEvents,
      compute,
      mode: "optimistic",
    })!;
    // Inheritance +100,000 in cash; the house swap stays net-worth-neutral.
    expect(result.value.diff.netWorthTotal.deltaEUR).toBe("100000.00");
    expect(result.value.proceedsEUR).toBe("20000.00");
    expect(result.inputs).not.toContain("ev_done");
  });

  it("a pension withdrawal is a pension→cash transfer: net worth flat, fireCounted up, rescate taxed", () => {
    const withdrawal: SnapshotFacts = {
      ...facts,
      plannedEvents: [
        {
          id: "ev_rescate",
          type: "pension_withdrawal",
          date: "2027-01-01",
          amount: "10000",
          probability: "1",
          includedInBaseCase: true,
          realisedAt: null,
        },
      ],
    };
    const result = plannedEventsScenario({
      base: compute(withdrawal),
      facts: withdrawal,
      compute,
      mode: "base",
    })!;
    expect(result.value.diff.netWorthTotal.deltaEUR).toBe("0.00");
    // The pension is locked (outside FIRE); cash isn't — the runway insight.
    expect(result.value.diff.fireCounted.deltaEUR).toBe("10000.00");
    // The variant's tax estimate counts the withdraw leg as a rescate.
    expect(dec(result.value.diff.taxYear.deltaEUR).greaterThan(0)).toBe(true);
    expect(result.inputs).toContain("acc_pension");
    expect(
      result.value.exclusions.some((e) => e.includes("rescate")),
    ).toBe(true);
  });

  it("job exit moves no money: a null breakdown row and an explicit exclusion", () => {
    const exit: SnapshotFacts = {
      ...facts,
      plannedEvents: [
        {
          id: "ev_exit",
          type: "job_exit",
          date: "2027-01-01",
          amount: "0",
          probability: "1",
          includedInBaseCase: true,
          realisedAt: null,
        },
      ],
    };
    const result = plannedEventsScenario({
      base: compute(exit),
      facts: exit,
      compute,
      mode: "base",
    })!;
    expect(result.value.diff.netWorthTotal.deltaEUR).toBe("0.00");
    expect(result.value.breakdown[0].valueEUR).toBeNull();
    expect(
      result.value.exclusions.some((e) => e.includes("move no money")),
    ).toBe(true);
  });

  it("returns null when no event qualifies", () => {
    expect(
      plannedEventsScenario({ base, facts, compute, mode: "optimistic" }),
    ).toBeNull();
  });

  it("adds today's-purchasing-power figures per row at longRunInflation; headlines stay nominal", () => {
    const result = plannedEventsScenario({
      base: eventBase,
      facts: withEvents,
      compute,
      mode: "optimistic",
    })!;
    const byLabel = Object.fromEntries(
      result.value.breakdown.map((r) => [r.label, r.presentValueEUR]),
    );
    // 2027-03-01 is 265/365.25 years out at 2% ⇒ −80,000 → −78,858.82.
    expect(byLabel["house purchase · 2027-03-01"]).toBe("-78858.82");
    expect(byLabel["inheritance · 2030-01-01"]).toBe("93184.38");
    // The headline total remains the undiscounted face-value sum.
    expect(result.value.proceedsEUR).toBe("20000.00");
    expect(result.inputs).toContain("assum_lri");
    expect(
      result.value.exclusions.some((e) => e.includes("purchasing-power")),
    ).toBe(true);
  });

  it("discounts a past-dated unrealised event by factor 1 and degrades without the assumption", () => {
    const pastEvent: SnapshotFacts = {
      ...withEvents,
      plannedEvents: [
        {
          id: "ev_late",
          type: "inheritance",
          date: "2025-01-01", // past, still unrealised
          amount: "50000",
          probability: "1",
          includedInBaseCase: true,
          realisedAt: null,
        },
      ],
    };
    const late = plannedEventsScenario({
      base: compute(pastEvent),
      facts: pastEvent,
      compute,
      mode: "base",
    })!;
    expect(late.value.breakdown[0].presentValueEUR).toBe("50000.00");

    const noAssumption: SnapshotFacts = {
      ...pastEvent,
      assumptions: pastEvent.assumptions.filter(
        (a) => a.key !== "longRunInflation",
      ),
    };
    const degraded = plannedEventsScenario({
      base: compute(noAssumption),
      facts: noAssumption,
      compute,
      mode: "base",
    })!;
    expect("presentValueEUR" in degraded.value.breakdown[0]).toBe(false);
    expect(degraded.inputs).not.toContain("assum_lri");
    expect(
      degraded.value.exclusions.some((e) => e.includes("purchasing-power")),
    ).toBe(false);
  });
});

describe("the snapshot's standard decision set", () => {
  it("carries one scenario per property and per held position, with display names", () => {
    const snapshot = computeSnapshot({
      snapshotId: "snap_std",
      asOf: FIXTURE_AS_OF,
      reviewDue: false,
      facts,
      propertyNameById: { prop_rent_a: "Apartment — rental A" },
      holdingNameById: { hold_vwce: "VWCE" },
    });
    const keys = snapshot.scenarios!.map((s) => s.value.key);
    expect(keys).toEqual([
      "sell-property:prop_home",
      "sell-property:prop_rent_a",
      "sell-property:prop_rent_b",
      "sell-position:hold_vwce",
      "sell-position:hold_smh",
      "sell-position:hold_aggh",
    ]);
    const labels = snapshot.scenarios!.map((s) => s.value.label);
    expect(labels).toContain("Sell Apartment — rental A");
    expect(labels).toContain("Sell all VWCE");
  });

  it("withScenarios:false omits the set (the variants inside the engine never nest)", () => {
    expect(base.scenarios).toBeUndefined();
  });
});
