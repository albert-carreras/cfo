import { describe, expect, it } from "vitest";
import {
  fifoCapitalGains,
  realizedCapitalGains,
  rentalIncome,
  progressiveTax,
  taxES,
  lossCarryForward,
  type TaxLot,
  type LotMovement,
  type DisposalGain,
} from "@/calc/taxES";
import { TAX_ES_CAT_2026 } from "@/calc/config/taxES.es-cat.2026";

const cfg = TAX_ES_CAT_2026;

// A minimal per-disposal row — lossCarryForward only reads date and gainEUR.
function gain(date: string, gainEUR: string): DisposalGain {
  return {
    disposalId: `d-${date}-${gainEUR}`,
    holdingId: "h1",
    date,
    quantity: "1",
    proceedsEUR: "0",
    costBasisEUR: "0",
    gainEUR,
  };
}

describe("fifoCapitalGains", () => {
  it("computes gain on a single full lot and leaves no remainder", () => {
    const lots: TaxLot[] = [
      { id: "l1", holdingId: "h", buyDate: "2020-01-01", quantity: "100", costBasisEUR: "1000" },
    ];
    const r = fifoCapitalGains({
      lots,
      disposals: [{ id: "d1", holdingId: "h", quantity: "100", proceedsEUR: "1500", date: "2026-03-01" }],
    });
    expect(r.realizedGainEUR).toBe("500.00");
    expect(r.disposals[0].costBasisEUR).toBe("1000.00");
    expect(r.remainingLots).toHaveLength(0);
    expect(r.inputs).toEqual(expect.arrayContaining(["d1", "l1"]));
  });

  it("partially consumes a lot and leaves a proportional residual", () => {
    const lots: TaxLot[] = [
      { id: "l1", holdingId: "h", buyDate: "2020-01-01", quantity: "100", costBasisEUR: "1000" },
    ];
    const r = fifoCapitalGains({
      lots,
      disposals: [{ id: "d1", holdingId: "h", quantity: "40", proceedsEUR: "600", date: "2026-03-01" }],
    });
    // cost/share = 10 → 40 shares cost 400 → gain 200
    expect(r.realizedGainEUR).toBe("200.00");
    expect(r.remainingLots).toHaveLength(1);
    expect(r.remainingLots[0].quantity).toBe("60");
    expect(r.remainingLots[0].costBasisEUR).toBe("600.00");
  });

  it("consumes lots oldest-first across a multi-lot holding", () => {
    const lots: TaxLot[] = [
      { id: "l_old", holdingId: "h", buyDate: "2020-01-01", quantity: "50", costBasisEUR: "500" }, // 10/sh
      { id: "l_new", holdingId: "h", buyDate: "2022-01-01", quantity: "50", costBasisEUR: "750" }, // 15/sh
    ];
    const r = fifoCapitalGains({
      lots,
      disposals: [{ id: "d1", holdingId: "h", quantity: "70", proceedsEUR: "1400", date: "2026-03-01" }],
    });
    // 50@10 + 20@15 = 500 + 300 = 800 matched cost → gain 600
    expect(r.disposals[0].costBasisEUR).toBe("800.00");
    expect(r.realizedGainEUR).toBe("600.00");
    // l_old fully consumed, l_new has 30 left @15 = 450
    expect(r.remainingLots).toHaveLength(1);
    expect(r.remainingLots[0].id).toBe("l_new");
    expect(r.remainingLots[0].quantity).toBe("30");
    expect(r.remainingLots[0].costBasisEUR).toBe("450.00");
  });

  it("reports a loss when proceeds fall below cost basis", () => {
    const lots: TaxLot[] = [
      { id: "l1", holdingId: "h", buyDate: "2020-01-01", quantity: "100", costBasisEUR: "2000" },
    ];
    const r = fifoCapitalGains({
      lots,
      disposals: [{ id: "d1", holdingId: "h", quantity: "100", proceedsEUR: "1500", date: "2026-03-01" }],
    });
    expect(r.realizedGainEUR).toBe("-500.00");
  });

  it("never consumes a lot bought after the disposal date", () => {
    const lots: TaxLot[] = [
      { id: "l_past", holdingId: "h", buyDate: "2020-01-01", quantity: "50", costBasisEUR: "500" }, // 10/sh
      { id: "l_future", holdingId: "h", buyDate: "2026-06-01", quantity: "50", costBasisEUR: "250" }, // 5/sh
    ];
    const r = fifoCapitalGains({
      lots,
      disposals: [{ id: "d1", holdingId: "h", quantity: "50", proceedsEUR: "1000", date: "2026-03-01" }],
    });
    // only the past lot is matchable: basis 500 → gain 500 (not 250 from the cheap future lot)
    expect(r.disposals[0].costBasisEUR).toBe("500.00");
    expect(r.realizedGainEUR).toBe("500.00");
    // the future lot survives untouched
    expect(r.remainingLots).toHaveLength(1);
    expect(r.remainingLots[0].id).toBe("l_future");
    expect(r.remainingLots[0].quantity).toBe("50");
    expect(r.inputs).not.toContain("l_future");
  });

  it("falls back to zero basis when only future lots exist", () => {
    const lots: TaxLot[] = [
      { id: "l_future", holdingId: "h", buyDate: "2026-06-01", quantity: "100", costBasisEUR: "1000" },
    ];
    const r = fifoCapitalGains({
      lots,
      disposals: [{ id: "d1", holdingId: "h", quantity: "100", proceedsEUR: "1500", date: "2026-03-01" }],
    });
    // nothing matchable → the documented zero-basis behavior: full proceeds = gain
    expect(r.disposals[0].costBasisEUR).toBe("0.00");
    expect(r.realizedGainEUR).toBe("1500.00");
    expect(r.remainingLots[0].quantity).toBe("100");
  });
});

describe("fifoCapitalGains — the 2-month wash-sale rule", () => {
  it("defers a loss when homogeneous shares were bought within the window and are still held", () => {
    const lots: TaxLot[] = [
      { id: "l_old", holdingId: "h", buyDate: "2020-01-01", quantity: "100", costBasisEUR: "2000" }, // 20/sh
      { id: "l_rebuy", holdingId: "h", buyDate: "2026-02-15", quantity: "100", costBasisEUR: "1500" }, // 15/sh
    ];
    const r = fifoCapitalGains({
      lots,
      // sells the OLD lot at a loss of 500; the February repurchase sits
      // inside [2026-01-01, 2026-05-01] and is fully held → full deferral
      disposals: [{ id: "d1", holdingId: "h", quantity: "100", proceedsEUR: "1500", date: "2026-03-01" }],
      washSaleWindowMonths: 2,
    });
    expect(r.realizedGainEUR).toBe("0.00");
    expect(r.disposals[0].gainEUR).toBe("0.00");
    expect(r.disposals[0].deferredLossEUR).toBe("500.00");
    // the deferred loss lives on as extra basis on the repurchase lot
    expect(r.remainingLots[0].id).toBe("l_rebuy");
    expect(r.remainingLots[0].costBasisEUR).toBe("2000.00"); // 1500 + 500
  });

  it("recognizes the deferred loss when the repurchased shares are sold", () => {
    const lots: TaxLot[] = [
      { id: "l_old", holdingId: "h", buyDate: "2020-01-01", quantity: "100", costBasisEUR: "2000" },
      { id: "l_rebuy", holdingId: "h", buyDate: "2026-02-15", quantity: "100", costBasisEUR: "1500" },
    ];
    const r = fifoCapitalGains({
      lots,
      disposals: [
        { id: "d1", holdingId: "h", quantity: "100", proceedsEUR: "1500", date: "2026-03-01" },
        // a year later, outside any window: sells the rebuy lot at its
        // nominal cost — the deferred 500 surfaces here
        { id: "d2", holdingId: "h", quantity: "100", proceedsEUR: "1500", date: "2027-06-01" },
      ],
      washSaleWindowMonths: 2,
    });
    expect(r.disposals[0].gainEUR).toBe("0.00");
    expect(r.disposals[1].gainEUR).toBe("-500.00");
    expect(r.realizedGainEUR).toBe("-500.00"); // conserved overall
  });

  it("defers only the repurchased fraction of the loss", () => {
    const lots: TaxLot[] = [
      { id: "l_old", holdingId: "h", buyDate: "2020-01-01", quantity: "100", costBasisEUR: "2000" },
      { id: "l_rebuy", holdingId: "h", buyDate: "2026-03-20", quantity: "40", costBasisEUR: "600" },
    ];
    const r = fifoCapitalGains({
      lots,
      // loss 500 over 100 shares; only 40 were repurchased → defer 200
      disposals: [{ id: "d1", holdingId: "h", quantity: "100", proceedsEUR: "1500", date: "2026-03-01" }],
      washSaleWindowMonths: 2,
    });
    expect(r.disposals[0].gainEUR).toBe("-300.00");
    expect(r.disposals[0].deferredLossEUR).toBe("200.00");
    expect(r.remainingLots[0].costBasisEUR).toBe("800.00"); // 600 + 200
  });

  it("does not defer when the window buy was itself fully sold, or outside the window", () => {
    // The 2026-02-15 lot is fully consumed by the disposal itself (FIFO from
    // a single lot) — it cannot be its own repurchase.
    const selfSale = fifoCapitalGains({
      lots: [
        { id: "l1", holdingId: "h", buyDate: "2026-02-15", quantity: "100", costBasisEUR: "2000" },
      ],
      disposals: [{ id: "d1", holdingId: "h", quantity: "100", proceedsEUR: "1500", date: "2026-03-01" }],
      washSaleWindowMonths: 2,
    });
    expect(selfSale.disposals[0].gainEUR).toBe("-500.00");
    expect(selfSale.disposals[0].deferredLossEUR).toBeUndefined();

    // A repurchase just past the window: 2026-03-01 + 2 months = 2026-05-01.
    const outside = fifoCapitalGains({
      lots: [
        { id: "l_old", holdingId: "h", buyDate: "2020-01-01", quantity: "100", costBasisEUR: "2000" },
        { id: "l_late", holdingId: "h", buyDate: "2026-05-02", quantity: "100", costBasisEUR: "1500" },
      ],
      disposals: [{ id: "d1", holdingId: "h", quantity: "100", proceedsEUR: "1500", date: "2026-03-01" }],
      washSaleWindowMonths: 2,
    });
    expect(outside.disposals[0].gainEUR).toBe("-500.00");
    expect(outside.realizedGainEUR).toBe("-500.00");
  });

  it("never touches gains, and the rule is off when no window is passed", () => {
    const lots: TaxLot[] = [
      { id: "l_old", holdingId: "h", buyDate: "2020-01-01", quantity: "100", costBasisEUR: "1000" },
      { id: "l_rebuy", holdingId: "h", buyDate: "2026-02-15", quantity: "100", costBasisEUR: "1500" },
    ];
    const withGain = fifoCapitalGains({
      lots,
      disposals: [{ id: "d1", holdingId: "h", quantity: "100", proceedsEUR: "1500", date: "2026-03-01" }],
      washSaleWindowMonths: 2,
    });
    expect(withGain.disposals[0].gainEUR).toBe("500.00");

    const ruleOff = fifoCapitalGains({
      lots: [
        { id: "l_old", holdingId: "h", buyDate: "2020-01-01", quantity: "100", costBasisEUR: "2000" },
        { id: "l_rebuy", holdingId: "h", buyDate: "2026-02-15", quantity: "100", costBasisEUR: "1500" },
      ],
      disposals: [{ id: "d1", holdingId: "h", quantity: "100", proceedsEUR: "1500", date: "2026-03-01" }],
    });
    expect(ruleOff.realizedGainEUR).toBe("-500.00");
  });
});

describe("realizedCapitalGains (lots derived from the ledger)", () => {
  const opening: TaxLot[] = [
    { id: "lot_open", holdingId: "h", buyDate: "2020-01-01", quantity: "100", costBasisEUR: "1000" }, // 10/sh
  ];

  it("a later buy opens a lot that a subsequent sell consumes FIFO", () => {
    const movements: LotMovement[] = [
      { id: "buy1", type: "buy", holdingId: "h", quantity: "50", amount: "750", occurredAt: "2024-05-01" }, // 15/sh
      { id: "sell1", type: "sell", holdingId: "h", quantity: "120", amount: "2400", occurredAt: "2026-03-01" }, // 20/sh
    ];
    const r = realizedCapitalGains({ openingLots: opening, movements, asOf: "2026-06-09" });
    // 100@10 (1000) + 20@15 (300) = 1300 matched cost; proceeds 2400 → gain 1100
    expect(r.realizedGainEUR).toBe("1100.00");
    expect(r.remainingLots).toHaveLength(1);
    expect(r.remainingLots[0].quantity).toBe("30");
    expect(r.remainingLots[0].costBasisEUR).toBe("450.00");
    expect(r.inputs).toEqual(expect.arrayContaining(["lot_open", "buy1", "sell1"]));
  });

  it("replays prior-year sells first but only returns the asOf-year's gain", () => {
    const movements: LotMovement[] = [
      { id: "sell_2025", type: "sell", holdingId: "h", quantity: "60", amount: "900", occurredAt: "2025-08-01" },
      { id: "sell_2026", type: "sell", holdingId: "h", quantity: "40", amount: "1000", occurredAt: "2026-04-01" },
    ];
    const r = realizedCapitalGains({ openingLots: opening, movements, asOf: "2026-06-09" });
    // 2025 consumes 60@10 first; 2026 then consumes 40@10 (cost 400), proceeds 1000 → 600
    expect(r.realizedGainEUR).toBe("600.00");
  });

  it("ignores movements dated after asOf", () => {
    const movements: LotMovement[] = [
      { id: "sell_future", type: "sell", holdingId: "h", quantity: "100", amount: "2000", occurredAt: "2026-12-31" },
    ];
    const r = realizedCapitalGains({ openingLots: opening, movements, asOf: "2026-06-09" });
    expect(r.realizedGainEUR).toBe("0.00");
    expect(r.remainingLots[0].quantity).toBe("100"); // nothing sold yet
  });

  it("ignores trade movements before the holding opening baseline", () => {
    const r = realizedCapitalGains({
      openingLots: [
        {
          id: "opening",
          holdingId: "h",
          buyDate: "2020-01-01",
          quantity: "50",
          costBasisEUR: "500",
        },
      ],
      movements: [
        {
          id: "prebaseline_buy",
          type: "buy",
          holdingId: "h",
          quantity: "50",
          amount: "500",
          occurredAt: "2025-12-31",
        },
        {
          id: "sell",
          type: "sell",
          holdingId: "h",
          quantity: "100",
          amount: "2000",
          occurredAt: "2026-04-01",
        },
      ],
      asOf: "2026-06-09",
      holdingOpeningAsOf: { h: "2026-01-01" },
    });

    expect(r.realizedGainEUR).toBe("1500.00");
    expect(r.inputs).not.toContain("prebaseline_buy");
  });

  it("ignores opening tax lots dated after asOf", () => {
    const r = realizedCapitalGains({
      openingLots: [
        {
          id: "future_lot",
          holdingId: "h",
          buyDate: "2026-07-01",
          quantity: "100",
          costBasisEUR: "1000",
        },
      ],
      movements: [
        {
          id: "sell",
          type: "sell",
          holdingId: "h",
          quantity: "100",
          amount: "2000",
          occurredAt: "2026-04-01",
        },
      ],
      asOf: "2026-06-09",
    });

    expect(r.realizedGainEUR).toBe("2000.00");
    expect(r.inputs).not.toContain("future_lot");
  });

  it("honors append-only corrections (a superseded sell does not apply)", () => {
    const movements: LotMovement[] = [
      { id: "sellA", type: "sell", holdingId: "h", quantity: "100", amount: "2000", occurredAt: "2026-04-01" },
      { id: "sellB", type: "sell", holdingId: "h", quantity: "50", amount: "1000", occurredAt: "2026-04-02", correctsId: "sellA" },
    ];
    const r = realizedCapitalGains({ openingLots: opening, movements, asOf: "2026-06-09" });
    // only sellB applies: 50@10 (500) vs proceeds 1000 → 500
    expect(r.realizedGainEUR).toBe("500.00");
    expect(r.remainingLots[0].quantity).toBe("50");
  });
});

describe("progressiveTax (savings scale)", () => {
  it("taxes a base inside the first band", () => {
    expect(progressiveTax("5000", cfg.savings).toFixed(2)).toBe("950.00"); // 5000 × 19%
  });

  it("applies marginal rates across a band boundary", () => {
    // 6000 × 19% + 4000 × 21% = 1140 + 840 = 1980
    expect(progressiveTax("10000", cfg.savings).toFixed(2)).toBe("1980.00");
  });

  it("stacks three savings bands", () => {
    // 6000×19% + 44000×21% + 10000×23% = 1140 + 9240 + 2300 = 12680
    expect(progressiveTax("60000", cfg.savings).toFixed(2)).toBe("12680.00");
  });

  it("returns €0 for a zero or negative base", () => {
    expect(progressiveTax("0", cfg.savings).toFixed(2)).toBe("0.00");
    expect(progressiveTax("-100", cfg.savings).toFixed(2)).toBe("0.00");
  });
});

describe("general income tax (state + Cataluña)", () => {
  it("combined bottom marginal is 19% (9.5% state + 9.5% Cataluña), net of the personal minimum", () => {
    const r = taxES({
      snapshotId: "s",
      config: cfg,
      realizedCapitalGainsEUR: "0",
      pensionWithdrawalEUR: "10000",
      inputs: [],
    });
    // state: 10000×9.5% − 5550×9.5% = 950 − 527.25
    expect(r.value.generalStateTaxEUR).toBe("422.75");
    // total base 10000 ≤ 12450 ⇒ the Cataluña minimum is 6105:
    // 950 − 6105×9.5% = 950 − 579.975
    expect(r.value.generalAutonomicTaxEUR).toBe("370.03");
    expect(r.value.generalTaxEUR).toBe("792.78");
    expect(r.value.savingsTaxEUR).toBe("0.00");
    expect(r.value.minimums).toEqual({
      stateEUR: "5550.00",
      autonomicEUR: "6105.00",
      savingsOffsetEUR: "0.00", // the general base absorbed the whole minimum
    });
  });

  it("taxes a pension withdrawal across both scales, net of the minimums", () => {
    // base 30000: state = 1182.75 + 930 + 1470 = 3582.75, minus the minimum's
    //             527.25 → 3055.50
    //             cat   = 1187.50 + 1187.50 + 1280 = 3655.00; the total base
    //             exceeds 12450 so the Cataluña minimum stays 5550 →
    //             3655 − 527.25 = 3127.75
    const r = taxES({
      snapshotId: "s",
      config: cfg,
      realizedCapitalGainsEUR: "0",
      pensionWithdrawalEUR: "30000",
      inputs: [],
    });
    expect(r.value.generalStateTaxEUR).toBe("3055.50");
    expect(r.value.generalAutonomicTaxEUR).toBe("3127.75");
    expect(r.value.generalTaxEUR).toBe("6183.25");
    expect(r.value.minimums?.autonomicEUR).toBe("5550.00");
  });
});

describe("rentalIncome (rough model)", () => {
  it("applies the conservative 50% vivienda reduction to positive net yield", () => {
    const r = rentalIncome({
      properties: [
        { id: "p", rentMonthly: "1000", costsMonthly: "200", ownershipPct: "100", isPrimaryResidence: false },
      ],
      reductionRate: cfg.rentalReductionRate,
    });
    expect(r.grossEUR).toBe("12000.00");
    expect(r.deductibleEUR).toBe("2400.00");
    expect(r.netEUR).toBe("9600.00");
    expect(r.taxableEUR).toBe("4800.00"); // 9600 × 50%
  });

  it("passes a rental loss through unreduced", () => {
    const r = rentalIncome({
      properties: [
        { id: "p", rentMonthly: "500", costsMonthly: "800", ownershipPct: "100", isPrimaryResidence: false },
      ],
      reductionRate: cfg.rentalReductionRate,
    });
    expect(r.netEUR).toBe("-3600.00");
    expect(r.taxableEUR).toBe("-3600.00");
  });

  it("excludes the primary residence and scales by ownership share", () => {
    const r = rentalIncome({
      properties: [
        { id: "home", rentMonthly: "0", costsMonthly: "200", ownershipPct: "100", isPrimaryResidence: true },
        { id: "shared", rentMonthly: "1000", costsMonthly: "200", ownershipPct: "50", isPrimaryResidence: false },
      ],
      reductionRate: cfg.rentalReductionRate,
    });
    // only the 50% share counts: gross 6000, deductible 1200, net 4800, taxable 2400
    expect(r.taxableEUR).toBe("2400.00");
    expect(r.inputs).toEqual(["shared"]);
  });
});

describe("lossCarryForward (derived from per-disposal history)", () => {
  it("a prior-year net loss is available in the tax year", () => {
    const r = lossCarryForward({
      perDisposal: [gain("2024-03-01", "-4000"), gain("2024-09-01", "1000")],
      taxYear: "2026",
    });
    expect(r.availableEUR).toBe("3000.00");
    expect(r.byYear).toEqual([{ year: "2024", remainingEUR: "3000.00" }]);
    expect(r.expiredEUR).toBe("0.00");
  });

  it("intervening gains consume the pool oldest-first; the tax year itself is excluded", () => {
    const r = lossCarryForward({
      perDisposal: [
        gain("2023-05-01", "-5000"),
        gain("2024-02-01", "-1000"),
        gain("2025-06-01", "4500"), // eats 4500 of the 2023 loss
        gain("2026-01-15", "9999"), // tax-year disposal — not part of the carry
      ],
      taxYear: "2026",
    });
    expect(r.availableEUR).toBe("1500.00");
    expect(r.byYear).toEqual([
      { year: "2023", remainingEUR: "500.00" },
      { year: "2024", remainingEUR: "1000.00" },
    ]);
  });

  it("losses fall off the 4-year window and are reported as expired", () => {
    const r = lossCarryForward({
      perDisposal: [gain("2021-04-01", "-2000"), gain("2023-04-01", "-700")],
      taxYear: "2026", // window floor is 2022 — the 2021 loss expired
    });
    expect(r.availableEUR).toBe("700.00");
    expect(r.expiredEUR).toBe("2000.00");
  });

  it("the pre-ledger assumption is consumed first and never expires in-model", () => {
    const r = lossCarryForward({
      perDisposal: [gain("2024-07-01", "800")],
      taxYear: "2026",
      preLedgerLossEUR: "1000",
    });
    expect(r.availableEUR).toBe("200.00");
    expect(r.byYear).toEqual([{ year: "pre-ledger", remainingEUR: "200.00" }]);
  });
});

describe("taxES orchestrator", () => {
  it("stacks the savings and general bases and carries provenance", () => {
    const r = taxES({
      snapshotId: "s",
      config: cfg,
      realizedCapitalGainsEUR: "10000",
      rentalTaxableEUR: "4992",
      inputs: ["lot_a", "spend_b"],
    });
    expect(r.value.savingsBaseEUR).toBe("10000.00");
    // The 4992 general base is fully absorbed by the minimums (general tax 0);
    // the unabsorbed 558 of the STATE minimum credits the savings scale:
    // (6000×19% + 4000×21%) − 558×19% = 1980 − 106.02
    expect(r.value.savingsTaxEUR).toBe("1873.98");
    expect(r.value.generalBaseEUR).toBe("4992.00");
    expect(r.value.generalTaxEUR).toBe("0.00");
    expect(r.value.totalTaxEUR).toBe("1873.98");
    expect(r.value.minimums?.savingsOffsetEUR).toBe("558.00");
    expect(r.source).toBe("taxES.v1");
    expect(r.version).toBe("taxES.es-cat.2026.5");
    expect(r.inputs).toEqual(["lot_a", "spend_b"]);
  });

  it("adds the familyMinimum assumption to both sides of the minimum", () => {
    // general base 20000 (> 12450 ⇒ autonomic personal minimum stays 5550),
    // family minimum 2400 → state/autonomic minimum 7950 each.
    // state: scale(20000) = 1182.75 + 7550×12% = 2088.75
    //        credit scale(7950) = 7950×9.5% = 755.25 → 1333.50
    // cat:   scale(20000) = 1187.50 + 7500×12.5% = 2125.00
    //        credit scale_cat(7950) = 755.25 → 1369.75
    const r = taxES({
      snapshotId: "s",
      config: cfg,
      realizedCapitalGainsEUR: "0",
      pensionWithdrawalEUR: "20000",
      familyMinimumEUR: "2400",
      inputs: [],
    });
    expect(r.value.minimums).toEqual({
      stateEUR: "7950.00",
      autonomicEUR: "7950.00",
      savingsOffsetEUR: "0.00",
    });
    expect(r.value.generalStateTaxEUR).toBe("1333.50");
    expect(r.value.generalAutonomicTaxEUR).toBe("1369.75");
  });

  it("floors a net capital loss at a €0 savings base (no negative tax)", () => {
    const r = taxES({
      snapshotId: "s",
      config: cfg,
      realizedCapitalGainsEUR: "-5000",
      inputs: [],
    });
    expect(r.value.savingsBaseEUR).toBe("0.00");
    expect(r.value.savingsTaxEUR).toBe("0.00");
    expect(r.value.totalTaxEUR).toBe("0.00");
  });

  it("a prior-year carry-forward reduces the savings base and reports what's left", () => {
    const r = taxES({
      snapshotId: "s",
      config: cfg,
      realizedCapitalGainsEUR: "10000",
      lossCarryForwardEUR: "12000",
      inputs: [],
    });
    expect(r.value.savingsBaseEUR).toBe("0.00");
    expect(r.value.savingsTaxEUR).toBe("0.00");
    expect(r.value.lossCarryForwardUsedEUR).toBe("10000.00");
    expect(r.value.lossCarryForwardRemainingEUR).toBe("2000.00");
  });

  it("the carry-forward never pushes the base negative or applies to a loss year", () => {
    const r = taxES({
      snapshotId: "s",
      config: cfg,
      realizedCapitalGainsEUR: "-3000",
      lossCarryForwardEUR: "5000",
      inputs: [],
    });
    expect(r.value.savingsBaseEUR).toBe("0.00");
    expect(r.value.lossCarryForwardUsedEUR).toBe("0.00");
    expect(r.value.lossCarryForwardRemainingEUR).toBe("5000.00");
  });

  it("prints the config-driven exclusions and the income-only total without wealth inputs", () => {
    const r = taxES({
      snapshotId: "s",
      config: cfg,
      realizedCapitalGainsEUR: "10000",
      inputs: [],
    });
    expect(r.value.wealth).toBeUndefined();
    expect(r.value.incomeTaxEUR).toBe(r.value.totalTaxEUR);
    expect(r.value.exclusions).toEqual(cfg.exclusions);
  });
});
