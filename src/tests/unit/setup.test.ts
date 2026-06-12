import { describe, expect, it } from "vitest";
import {
  setupInputSchema,
  setupWarnings,
  validateSetupDates,
  type SetupInput,
} from "@/shared/setup";
import { buildSetupRows } from "@/server/setup";
import { computeSnapshot } from "@/calc/snapshot";

const TODAY = "2026-06-11";

const minimalInput = {
  baselineAsOf: "2026-06-01",
  accounts: [
    { type: "bank", name: "Bank", openingCash: "10000" },
  ],
  assumptions: [
    { key: "monthlySpend", value: "2000" },
    { key: "safeWithdrawalRate", value: "0.035" },
  ],
};

const fullInput = {
  ...minimalInput,
  accounts: [
    { type: "bank", name: "Bank", openingCash: "10000" },
    { type: "broker", name: "Broker", openingCash: "0" },
  ],
  holdings: [
    {
      accountIndex: 1,
      isin: "IE00BK5BQT80",
      ticker: "VWCE.DE",
      name: "Vanguard FTSE All-World",
      openingQuantity: "10",
      lots: [
        {
          buyDate: "2024-01-10",
          quantity: "10",
          price: "90",
          fees: "5",
          fxRate: "1",
        },
      ],
    },
  ],
  properties: [
    {
      name: "Apartment",
      value: "200000",
      purchasePrice: "150000",
      valuedAt: "2026-06-01",
    },
  ],
  liabilities: [{ propertyIndex: 0, balance: "80000", rate: "0.02" }],
  plannedEvents: [
    {
      type: "inheritance",
      date: "2030-01-01",
      amount: "50000",
      probability: "0.5",
    },
  ],
};

describe("setup input schema", () => {
  it("accepts a minimal valid input", () => {
    expect(setupInputSchema.safeParse(minimalInput).success).toBe(true);
  });

  it("accepts the full input", () => {
    expect(setupInputSchema.safeParse(fullInput).success).toBe(true);
  });

  it("requires monthlySpend and safeWithdrawalRate", () => {
    const r = setupInputSchema.safeParse({
      ...minimalInput,
      assumptions: [{ key: "monthlySpend", value: "2000" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes("safeWithdrawalRate"))).toBe(true);
    }
  });

  it("rejects an out-of-range safe withdrawal rate (typo guard)", () => {
    const r = setupInputSchema.safeParse({
      ...minimalInput,
      assumptions: [
        { key: "monthlySpend", value: "2000" },
        { key: "safeWithdrawalRate", value: "0.35" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a holding referencing a missing account", () => {
    const r = setupInputSchema.safeParse({
      ...fullInput,
      holdings: [{ ...fullInput.holdings[0], accountIndex: 9 }],
    });
    expect(r.success).toBe(false);
  });

  it("requires a ticker or an explicit unpriced acknowledgement", () => {
    const noTicker = {
      ...fullInput.holdings[0],
      ticker: null,
      acknowledgeUnpriced: false,
    };
    expect(
      setupInputSchema.safeParse({ ...fullInput, holdings: [noTicker] }).success,
    ).toBe(false);
    expect(
      setupInputSchema.safeParse({
        ...fullInput,
        holdings: [{ ...noTicker, acknowledgeUnpriced: true }],
      }).success,
    ).toBe(true);
  });

  it("rejects a mortgage referencing a missing property", () => {
    const r = setupInputSchema.safeParse({
      ...fullInput,
      liabilities: [{ propertyIndex: 5, balance: "80000" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-EUR account cash", () => {
    const r = setupInputSchema.safeParse({
      ...minimalInput,
      accounts: [
        { type: "bank", name: "Bank", openingCash: "10000", currency: "USD" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate assumption keys and bad probabilities", () => {
    expect(
      setupInputSchema.safeParse({
        ...minimalInput,
        assumptions: [
          ...minimalInput.assumptions,
          { key: "monthlySpend", value: "3000" },
        ],
      }).success,
    ).toBe(false);
    expect(
      setupInputSchema.safeParse({
        ...fullInput,
        plannedEvents: [
          { type: "inheritance", date: "2030-01-01", amount: "1", probability: "1.5" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("validateSetupDates", () => {
  function parsed(input: unknown): SetupInput {
    return setupInputSchema.parse(input);
  }

  it("passes the full input", () => {
    expect(validateSetupDates(parsed(fullInput), TODAY)).toEqual([]);
  });

  it("rejects a future baseline", () => {
    const errors = validateSetupDates(
      parsed({ ...minimalInput, baselineAsOf: "2027-01-01" }),
      TODAY,
    );
    expect(errors.some((e) => e.includes("future"))).toBe(true);
  });

  it("rejects a lot bought after the holding's opening baseline", () => {
    const errors = validateSetupDates(
      parsed({
        ...fullInput,
        holdings: [
          {
            ...fullInput.holdings[0],
            lots: [{ ...fullInput.holdings[0].lots[0], buyDate: "2026-06-05" }],
          },
        ],
      }),
      TODAY,
    );
    expect(errors.some((e) => e.includes("lot bought after"))).toBe(true);
  });

  it("rejects an implausible birthDate", () => {
    const errors = validateSetupDates(
      parsed({
        ...minimalInput,
        assumptions: [
          ...minimalInput.assumptions,
          { key: "birthDate", dateValue: "2030-01-01" },
        ],
      }),
      TODAY,
    );
    expect(errors.some((e) => e.includes("birthDate"))).toBe(true);
  });
});

describe("setupWarnings", () => {
  it("warns when lots do not cover the opening quantity", () => {
    const input = setupInputSchema.parse({
      ...fullInput,
      holdings: [{ ...fullInput.holdings[0], openingQuantity: "25" }],
    });
    const warnings = setupWarnings(input);
    expect(warnings.some((w) => w.includes("lots sum to 10"))).toBe(true);
  });

  it("warns on a held position without lots, stays quiet otherwise", () => {
    const noLots = setupInputSchema.parse({
      ...fullInput,
      holdings: [{ ...fullInput.holdings[0], lots: [] }],
    });
    expect(setupWarnings(noLots).some((w) => w.includes("no open lots"))).toBe(true);
    expect(setupWarnings(setupInputSchema.parse(fullInput))).toEqual([]);
  });
});

describe("buildSetupRows", () => {
  function sequentialIds() {
    let n = 0;
    return () => `id_${n++}`;
  }

  it("resolves index references and derives the cost basis server-side", () => {
    const rows = buildSetupRows(setupInputSchema.parse(fullInput), sequentialIds());
    expect(rows.holdings[0].accountId).toBe(rows.accounts[1].id);
    expect(rows.liabilities[0].propertyId).toBe(rows.properties[0].id);
    // 90 × 10 × 1 + 5 — never client-supplied.
    expect(rows.taxLots[0].costBasisEUR).toBe("905");
    expect(rows.taxLots[0].holdingId).toBe(rows.holdings[0].id);
    // Defaults applied: per-entity openingAsOf falls back to the baseline.
    expect(rows.accounts[0].openingAsOf).toBe("2026-06-01");
    expect(rows.assumptions.every((a) => a.lastReviewedAt === "2026-06-01")).toBe(true);
  });

  it("feeds computeSnapshot directly — the first snapshot is correct and sourced", () => {
    const rows = buildSetupRows(setupInputSchema.parse(fullInput), sequentialIds());
    const snapshot = computeSnapshot({
      snapshotId: "snap_setup_test",
      asOf: TODAY,
      reviewDue: false,
      facts: {
        ...rows,
        movements: [],
        monthlySpend: [],
        revaluations: [],
        assumptions: rows.assumptions.filter(
          (a): a is (typeof rows.assumptions)[number] & { value: string } =>
            a.value !== null,
        ),
        prices: [
          {
            id: "price_test",
            isin: "IE00BK5BQT80",
            price: "100",
            currency: "EUR",
            asOf: "2026-06-10",
          },
        ],
        fx: [],
      },
    });

    // 10000 cash + 10 × 100 holding + 200000 property − 80000 mortgage.
    expect(snapshot.netWorth.value.totalEUR).toBe("131000.00");
    // Provenance traces to the generated rows.
    expect(snapshot.netWorth.inputs).toContain(rows.accounts[0].id);
    expect(snapshot.netWorth.inputs).toContain(rows.properties[0].id);
    // The required assumptions are present, so the snapshot is not born stale.
    expect(snapshot.dataQuality.value.missing).toEqual([]);
  });
});
