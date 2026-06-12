import { describe, expect, it } from "vitest";
import { computeSnapshot, type SnapshotFacts } from "@/calc/snapshot";
import { facts, FIXTURE_AS_OF } from "../fixtures";

function snapshot(f: SnapshotFacts, reviewDue = false) {
  return computeSnapshot({ snapshotId: "s", asOf: FIXTURE_AS_OF, reviewDue, facts: f });
}

describe("strategic snapshot (the end-to-end recompute)", () => {
  it("computes the baseline fixture deterministically — and says overspend honestly", () => {
    const snap = snapshot(facts);

    expect(snap.valuation.value.totalEUR).toBe("328974.00");
    expect(snap.netWorth.value.totalEUR).toBe("869920.00");
    expect(snap.netWorth.value.fireCountedEUR).toBe("348520.00");
    // Pension re-anchored to the Q2 statement; excluded from FIRE.
    expect(snap.netWorth.value.lockedEUR).toBe("86400.00");
    // Spend is the coarse ASSUMPTION, not the latest logged month.
    expect(snap.fire.value.monthlySpendEUR).toBe("3200.00");
    expect(snap.fire.value.runwayMonths).toBe(108.9); // 348520 / 3200
    expect(snap.fire.value.runwayMonthsConservative).toBe(96.8); // / 3600
    expect(snap.fire.value.runwayMonthsOptimistic).toBe(124.5); // / 2800
    expect(snap.dataQuality.value.score).toBe("Good");
    // The fixture spends ~3× its safe monthly draw (€1,016.52): the honest
    // status is the overspend Action — the very signal the coarse-spend design exists to say.
    expect(snap.status.value.status).toBe("action_recommended");
    expect(snap.status.value.reason).toContain("above the safe monthly spend");
  });

  it("recomputes net worth after a movement; a logged month no longer moves runway", () => {
    const before = snapshot(facts);

    // Log one expense (cash out) and a (much higher) month's spend.
    const after = snapshot({
      ...facts,
      movements: [
        ...facts.movements,
        {
          id: "mov_test_expense",
          type: "expense",
          accountId: "acc_bank",
          holdingId: null,
          quantity: null,
          amount: "2000",
          occurredAt: "2026-06-08",
          correctsId: null,
        },
      ],
      monthlySpend: [
        ...facts.monthlySpend,
        { id: "spend_2026_06", month: "2026-06", amount: "4000", createdAt: "2026-06-09T09:00:00.000Z" },
      ],
    });

    // Net worth dropped by exactly the €2,000 expense.
    expect(after.netWorth.value.totalEUR).toBe("867920.00");
    expect(
      Number(before.netWorth.value.totalEUR) - Number(after.netWorth.value.totalEUR),
    ).toBe(2000);

    // Runway recomputed off the smaller asset pile at the UNCHANGED assumption
    // — the logged month is calibration, never the runway input.
    expect(after.fire.value.monthlySpendEUR).toBe("3200.00");
    expect(after.fire.value.runwayMonths).toBe(108.3); // 346520 / 3200
    expect(after.fire.value.runwayMonths!).toBeLessThan(before.fire.value.runwayMonths!);
  });

  it("ties every figure to its provenance (snapshot id + input rows)", () => {
    const snap = snapshot(facts);
    expect(snap.netWorth.inputs).toContain("acc_bank");
    expect(snap.netWorth.inputs).toContain("mov_dep_bank");
    expect(snap.netWorth.inputs).toContain("price_vwce");
    expect(snap.netWorth.inputs).toContain("fx_usd");
    expect(snap.netWorth.inputs).toContain("prop_home");
    expect(snap.valuation.inputs).toContain("price_vwce");
    expect(snap.fire.inputs).toContain("mov_dep_bank");
    expect(snap.fire.inputs).toContain("price_vwce");
    expect(snap.fire.inputs).toContain("assum_spend"); // the spend assumption
    expect(snap.fire.inputs).not.toContain("spend_2026_05"); // logs only calibrate
    expect(snap.fire.inputs).toContain("assum_swr");
    // fire.v2: the real-view assumption pair joins the provenance; the
    // OBSERVED inflation row stays out (it is calibration, not an input).
    expect(snap.fire.inputs).toContain("assum_return");
    expect(snap.fire.inputs).toContain("assum_lri");
    expect(snap.fire.inputs).not.toContain("assum_inflation");
    expect(snap.dataQuality.inputs).toContain("price_vwce");
    expect(snap.dataQuality.inputs).toContain("prop_home");
    expect(snap.dataQuality.inputs).toContain("assum_return");
    expect(snap.dataQuality.inputs).not.toContain("market-prices");
    // The pension's value traces to the revaluation row it re-anchored on.
    expect(snap.netWorth.inputs).toContain("reval_pension_q2");
    expect(snap.netWorth.source).toBe("netWorth.v1");
    expect(snap.netWorth.version).toBe("netWorth.2026.2");
  });

  it("goes Data stale when the price feed breaks (prices past the weekly grace)", () => {
    const snap = snapshot({
      ...facts,
      prices: facts.prices.map((p) => ({ ...p, asOf: "2026-05-01" })), // 39 days old
    });
    expect(snap.dataQuality.value.missingRequired).toContain("Market prices");
    expect(snap.status.value.status).toBe("data_stale");
  });

  it("goes Data stale when a held holding has no FX rate for its price currency", () => {
    const snap = snapshot({ ...facts, fx: [] }); // SMH is priced in USD
    expect(snap.dataQuality.value.missingRequired).toContain("Market prices");
    expect(snap.status.value.status).toBe("data_stale");
  });

  it("goes Data stale when the FX used by a current price is stale", () => {
    const snap = snapshot({
      ...facts,
      fx: facts.fx.map((rate) => ({ ...rate, asOf: "2025-01-01" })),
    });
    expect(snap.dataQuality.value.missingRequired).toContain("Market prices");
    expect(snap.status.value.status).toBe("data_stale");
  });

  it("does not invent an SWR and reports the verified assumption as missing", () => {
    const snap = snapshot({
      ...facts,
      assumptions: facts.assumptions.filter(
        (assumption) => assumption.key !== "safeWithdrawalRate",
      ),
    });
    expect(snap.fire.value.safeWithdrawalRate).toBeNull();
    expect(snap.fire.value.safeMonthlySpendEUR).toBeNull();
    expect(snap.dataQuality.value.missingRequired).toContain(
      "Safe withdrawal rate",
    );
    expect(snap.status.value.status).toBe("data_stale");
  });

  it("flags the tax tables on year-rollover — a soft flag, not Data stale", () => {
    // Within the covered year: the tables are current, nothing flagged.
    const covered = snapshot(facts);
    expect(covered.dataQuality.value.missing).not.toContain(
      "Tax tables (taxES.es-cat.2026.5, taxIP.es-cat.2026.1)",
    );

    // Roll into 2027: the 2026 tables no longer cover the tax year. The flag
    // shows (deterministically, no AI) but it is NOT a required input — stale
    // tables make the tax ESTIMATE stale, not net worth.
    const rolled = computeSnapshot({
      snapshotId: "s",
      asOf: "2027-01-02",
      reviewDue: false,
      facts: {
        ...facts,
        // keep the other inputs fresh so only the tax flag is in play
        prices: facts.prices.map((p) => ({ ...p, asOf: "2027-01-01" })),
        fx: facts.fx.map((rate) => ({ ...rate, asOf: "2027-01-01" })),
        monthlySpend: facts.monthlySpend.map((row) => ({
          ...row,
          month: "2026-12",
          createdAt: "2027-01-01",
        })),
        assumptions: facts.assumptions.map((a) => ({
          ...a,
          lastReviewedAt: "2026-12-01",
        })),
      },
    });
    expect(rolled.dataQuality.value.missing).toContain(
      "Tax tables (taxES.es-cat.2026.5, taxIP.es-cat.2026.1)",
    );
    expect(rolled.dataQuality.value.missingRequired).not.toContain(
      "Tax tables (taxES.es-cat.2026.5, taxIP.es-cat.2026.1)",
    );

    // The registry fell back to the latest available tables: the estimate is
    // still computed (under 2026 tables) and stays honestly labelled 2026 —
    // never relabelled as a 2027 calculation.
    expect(rolled.taxES.version).toBe("taxES.es-cat.2026.5");
    expect(rolled.taxES.value.year).toBe(2026);
  });

  // ---- coarse spend & the honest status engine ----

  // An assumption below the safe monthly draw (€1,016.52) — the plan holds.
  const calmFacts: SnapshotFacts = {
    ...facts,
    assumptions: facts.assumptions.map((assumption) =>
      assumption.key === "monthlySpend"
        ? { ...assumption, value: "1000" }
        : assumption,
    ),
  };

  it("stays calm and honest with no spend logged for 3+ months (exit criterion)", () => {
    const snap = snapshot({ ...calmFacts, monthlySpend: [] });

    // A quiet ledger can no longer flip the home to Data stale: runway runs on
    // the assumption (annual cadence), and the missing logs raise nothing.
    expect(snap.fire.value.runwayMonths).toBe(348.5); // 348520 / 1000
    expect(snap.dataQuality.value.score).toBe("Good");
    expect(snap.dataQuality.value.flags).toEqual([]);
    expect(snap.status.value.status).toBe("stable");
  });

  it("goes Data stale only when the spend ASSUMPTION itself is missing or past its annual review", () => {
    const missing = snapshot({
      ...facts,
      assumptions: facts.assumptions.filter((a) => a.key !== "monthlySpend"),
    });
    expect(missing.fire.value.runwayMonths).toBeNull();
    expect(missing.dataQuality.value.missingRequired).toContain(
      "Monthly spend assumption",
    );
    expect(missing.status.value.status).toBe("data_stale");

    const unreviewed = snapshot({
      ...facts,
      assumptions: facts.assumptions.map((assumption) =>
        assumption.key === "monthlySpend"
          ? { ...assumption, lastReviewedAt: "2025-01-01" } // > 370 days before asOf
          : assumption,
      ),
    });
    expect(unreviewed.dataQuality.value.missingRequired).toContain(
      "Monthly spend assumption",
    );
    expect(unreviewed.status.value.status).toBe("data_stale");
  });

  it("flips to Action recommended when the assumption sits above the safe rate (exit criterion)", () => {
    // The fixture assumption (€3,200) is ~215% above the €1,016.52 safe draw.
    const snap = snapshot(facts);
    expect(snap.status.value.status).toBe("action_recommended");

    // Inside the 10% tolerance band: above safe, but only worth a review.
    const inBand = snapshot({
      ...facts,
      assumptions: facts.assumptions.map((assumption) =>
        assumption.key === "monthlySpend"
          ? { ...assumption, value: "1100" } // +8.2% over €1,016.52
          : assumption,
      ),
    });
    expect(inBand.status.value.status).toBe("review_soon");
    expect(inBand.status.value.reason).toContain("tolerance");
  });

  it("raises a SOFT calibration flag when logged spend diverges from the assumption — never Data stale", () => {
    // Three logged months averaging ~€3,133 against a €1,000 assumption.
    const snap = snapshot({
      ...calmFacts,
      monthlySpend: [
        ...facts.monthlySpend,
        { id: "spend_2026_03", month: "2026-03", amount: "3100", createdAt: "2026-04-02T09:00:00.000Z" },
      ],
    });

    expect(snap.dataQuality.value.flags).toHaveLength(1);
    expect(snap.dataQuality.value.flags[0]).toContain("Spend assumption looks off");
    expect(snap.dataQuality.value.score).toBe("Partial"); // soft: a nudge, not an alarm
    expect(snap.dataQuality.value.missingRequired).toEqual([]);
    expect(snap.status.value.status).toBe("stable"); // structurally not Data stale
    // Provenance: the flag cites the logged months and the assumption.
    expect(snap.dataQuality.inputs).toEqual(
      expect.arrayContaining(["spend_2026_03", "spend_2026_05", "assum_spend"]),
    );
  });

  it("stays silent with too few logged months to calibrate (the log is optional)", () => {
    // The fixture's two logged months are below the 3-month minimum.
    const snap = snapshot(calmFacts);
    expect(snap.dataQuality.value.flags).toEqual([]);
    expect(snap.dataQuality.value.score).toBe("Good");
  });

  // ---- ledger & asset integrity ----

  it("a two-leg transfer moves cash between accounts but never net worth", () => {
    const without = snapshot({
      ...facts,
      movements: facts.movements.filter((m) => m.id !== "mov_tr_out" && m.id !== "mov_tr_in"),
    });
    const withTransfer = snapshot(facts);

    expect(withTransfer.netWorth.value.totalEUR).toBe(without.netWorth.value.totalEUR);
    // Both legs show up in the cash provenance of their accounts.
    expect(withTransfer.netWorth.inputs).toContain("mov_tr_out");
    expect(withTransfer.netWorth.inputs).toContain("mov_tr_in");
  });

  it("pension freshness tracks the latest revaluation, not the immovable opening (exit criterion)", () => {
    // 137 days after the opening statement: without a revaluation the pension
    // is past its quarterly cadence; the Q2 statement keeps it fresh.
    const at = (f: SnapshotFacts) =>
      computeSnapshot({ snapshotId: "s", asOf: "2026-08-15", reviewDue: false, facts: f });

    const stale = at({ ...facts, revaluations: [] });
    expect(stale.dataQuality.value.missing).toContain("Pension value");
    expect(stale.dataQuality.value.missingRequired).not.toContain("Pension value"); // soft

    const fresh = at(facts);
    expect(fresh.dataQuality.value.missing).not.toContain("Pension value");
    // The freshness reading cites the statement it relied on.
    expect(fresh.dataQuality.inputs).toContain("reval_pension_q2");
  });

  it("warns (soft flag, never Data stale) when an account's cash goes negative", () => {
    const snap = snapshot({
      ...facts,
      movements: [
        ...facts.movements,
        {
          id: "mov_overdraw",
          type: "withdraw",
          accountId: "acc_bank",
          holdingId: null,
          quantity: null,
          amount: "50000",
          occurredAt: "2026-06-08",
          correctsId: null,
        },
      ],
    });

    expect(
      snap.dataQuality.value.flags.some((flag) =>
        flag.includes("Cash is negative in Bank — current account"),
      ),
    ).toBe(true);
    expect(snap.dataQuality.value.missingRequired).toEqual([]);
    expect(snap.status.value.status).not.toBe("data_stale");
    // Provenance: the flag cites the movements that drove the balance negative.
    expect(snap.dataQuality.inputs).toContain("mov_overdraw");
  });

  it("estimates tax: no sells/dividends ⇒ €0 savings; rentals drive a small general tax", () => {
    const snap = snapshot(facts);
    const tax = snap.taxES.value;
    // Rental A (4500 taxable) + Rental B 50% share (1740) = 6240 general base.
    expect(tax.generalBaseEUR).toBe("6240.00");
    expect(tax.savingsTaxEUR).toBe("0.00");
    // 6240 in the bottom 9.5% + 9.5% bracket, net of the personal minimums
    // (state 5,550; Cataluña 6,105 on a total base ≤ 12,450):
    // (592.80 − 527.25) + (592.80 − 579.975) = 65.55 + 12.825.
    expect(tax.generalTaxEUR).toBe("78.38");
    expect(tax.totalTaxEUR).toBe("78.38");
    expect(snap.taxES.source).toBe("taxES.v1");
    expect(snap.taxES.version).toBe("taxES.es-cat.2026.5");
    // Provenance cites the rental properties it used.
    expect(snap.taxES.inputs).toEqual(
      expect.arrayContaining(["prop_rent_a", "prop_rent_b"]),
    );
  });

  it("a realised pension withdrawal feeds the general base; a bank withdraw does not", () => {
    const baseline = snapshot(facts);
    const withdraw = (id: string, accountId: string) => ({
      id,
      type: "withdraw" as const,
      accountId,
      holdingId: null,
      quantity: null,
      amount: "12000",
      occurredAt: "2026-06-05",
      correctsId: null,
    });

    const rescate = snapshot({
      ...facts,
      movements: [...facts.movements, withdraw("mov_rescate", "acc_pension")],
    });
    // 6,240 rental base + the 12,000 rescate.
    expect(rescate.taxES.value.generalBaseEUR).toBe("18240.00");
    expect(Number(rescate.taxES.value.totalTaxEUR)).toBeGreaterThan(
      Number(baseline.taxES.value.totalTaxEUR),
    );
    // Provenance cites the withdraw leg.
    expect(rescate.taxES.inputs).toContain("mov_rescate");

    // The same withdraw on a bank account is just spending — no rescate.
    const bank = snapshot({
      ...facts,
      movements: [...facts.movements, withdraw("mov_cash_out", "acc_bank")],
    });
    expect(bank.taxES.value.generalBaseEUR).toBe("6240.00");
    expect(bank.taxES.value.totalTaxEUR).toBe(baseline.taxES.value.totalTaxEUR);
  });

  // ---- wealth tax & loss carry-forward ----

  it("models wealth tax honestly: the fixture sits just under the €500k mínimo", () => {
    const snap = snapshot(facts);
    const wealth = snap.taxES.value.wealth!;
    // 869,920 net worth − 86,400 pension − 300,000 vivienda cap = 483,520.
    expect(wealth.netBaseEUR).toBe("483520.00");
    expect(wealth.exemptions.pensionEUR).toBe("86400.00");
    expect(wealth.exemptions.primaryResidenceEUR).toBe("300000.00"); // 320k capped
    expect(wealth.taxableEUR).toBe("0.00");
    expect(wealth.quotaEUR).toBe("0.00");
    // €0 IP ⇒ the headline is still the income tax alone.
    expect(snap.taxES.value.totalTaxEUR).toBe(snap.taxES.value.incomeTaxEUR);
    expect(snap.taxES.value.exclusions!.length).toBeGreaterThan(0);
    // The wealth base's provenance includes the net-worth rows.
    expect(snap.taxES.inputs).toEqual(expect.arrayContaining(["prop_home"]));
  });

  it("a higher home valuation pushes the IP over the mínimo and into the total", () => {
    const snap = snapshot({
      ...facts,
      properties: facts.properties.map((p) =>
        p.id === "prop_home" ? { ...p, value: "720000" } : p,
      ),
    });
    const wealth = snap.taxES.value.wealth!;
    // Net worth 1,269,920 − 86,400 − 300,000 = 883,520 → taxable 383,520.
    expect(wealth.taxableEUR).toBe("383520.00");
    // 877.41 at €334,252.88 + 49,267.12 × 0.525% = 1,136.06.
    expect(wealth.quotaEUR).toBe("1136.06");
    expect(wealth.limitReductionEUR).toBe("0.00"); // cap 0.6×6,240 not binding
    expect(snap.taxES.value.totalTaxEUR).toBe("1214.44"); // 78.38 + 1,136.06
  });

  it("the lossCarryForward assumption surfaces as available losses with provenance", () => {
    const snap = snapshot({
      ...facts,
      assumptions: [
        ...facts.assumptions,
        {
          id: "assum_loss_carry",
          key: "lossCarryForward",
          value: "10000",
          lastReviewedAt: "2026-05-01",
        },
      ],
    });
    // No 2026 gains in the fixture — nothing consumed, all of it still there.
    expect(snap.taxES.value.lossCarryForwardUsedEUR).toBe("0.00");
    expect(snap.taxES.value.lossCarryForwardRemainingEUR).toBe("10000.00");
    expect(snap.taxES.inputs).toContain("assum_loss_carry");
  });

  it("excludes a corrected dividend from the savings base", () => {
    const snap = snapshot({
      ...facts,
      movements: [
        ...facts.movements,
        {
          id: "div_original",
          type: "dividend",
          accountId: "acc_broker",
          holdingId: null,
          quantity: null,
          amount: "100",
          occurredAt: "2026-06-01",
          correctsId: null,
        },
        {
          id: "div_correction",
          type: "dividend",
          accountId: "acc_broker",
          holdingId: null,
          quantity: null,
          amount: "80",
          occurredAt: "2026-06-01",
          correctsId: "div_original",
        },
      ],
    });

    expect(snap.taxES.value.savingsBaseEUR).toBe("80.00");
    expect(snap.taxES.inputs).toContain("div_correction");
    expect(snap.taxES.inputs).not.toContain("div_original");
  });

  it("excludes dividends before the account opening baseline", () => {
    const snap = snapshot({
      ...facts,
      movements: [
        ...facts.movements,
        {
          id: "div_prebaseline",
          type: "dividend",
          accountId: "acc_broker",
          holdingId: null,
          quantity: null,
          amount: "100",
          occurredAt: "2025-12-31",
          correctsId: null,
        },
      ],
    });

    expect(snap.taxES.value.savingsBaseEUR).toBe("0.00");
    expect(snap.taxES.inputs).not.toContain("div_prebaseline");
  });

  it("retains opening tax basis after a holding leaves valuation", () => {
    const snap = snapshot({
      ...facts,
      holdings: facts.holdings.filter(
        (holding) => holding.id !== "hold_aggh",
      ),
      holdingOpeningAsOf: { hold_aggh: "2026-01-01" },
      movements: [
        ...facts.movements,
        {
          id: "sell_disposed_aggh",
          type: "sell",
          accountId: "acc_broker",
          holdingId: "hold_aggh",
          quantity: "100",
          amount: "1000",
          occurredAt: "2026-06-01",
          correctsId: null,
        },
      ],
    });

    expect(
      snap.valuation.value.holdings.some(
        (holding) => holding.holdingId === "hold_aggh",
      ),
    ).toBe(false);
    expect(snap.taxES.value.savingsBaseEUR).toBe("480.00");
    expect(snap.taxES.inputs).toEqual(
      expect.arrayContaining(["lot_aggh_1", "sell_disposed_aggh"]),
    );
  });

});
