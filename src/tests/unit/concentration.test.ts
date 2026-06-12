import { describe, expect, it } from "vitest";
import { concentration } from "@/calc/concentration";
import { computeSnapshot } from "@/calc/snapshot";
import { facts, FIXTURE_AS_OF } from "../fixtures";

// Concentration classifies where the pile clusters against the versioned
// ceilings (25% position / 60% broker / 65% RE / 70% Spain). Checked against
// the committed fixture: investable 331,720 (VWCE 252,054 · SMH 74,520 ·
// AGGH 2,400 · broker cash 2,746), net worth 869,920, property equity 435,000.

const snapshot = computeSnapshot({
  snapshotId: "snap_conc",
  asOf: FIXTURE_AS_OF,
  reviewDue: false,
  facts,
  withScenarios: false,
});

const value = snapshot.concentration!.value;

describe("concentration", () => {
  it("classifies single positions against the investable pile", () => {
    const byHolding = Object.fromEntries(
      value.positions.map((p) => [p.holdingId, p]),
    );
    expect(byHolding.hold_vwce.pct).toBe(76);
    expect(byHolding.hold_vwce.above).toBe(true); // 76% > 25%
    expect(byHolding.hold_smh.pct).toBe(22.5);
    expect(byHolding.hold_smh.above).toBe(false);
    expect(byHolding.hold_aggh.above).toBe(false);
    expect(value.investableEUR).toBe("331720.00");
  });

  it("classifies the single broker (cash + holdings) against investable", () => {
    expect(value.brokers).toHaveLength(1);
    expect(value.brokers[0]).toMatchObject({
      accountId: "acc_broker",
      pct: 100,
      above: true, // 100% > 60%
    });
  });

  it("classifies real estate and Spain exposure against net worth", () => {
    // 435,000 / 869,920 = 50.0% — under both ceilings.
    expect(value.realEstate).toMatchObject({ pct: 50, above: false });
    expect(value.spain).toMatchObject({ pct: 50, above: false });
    expect(value.totalEUR).toBe("869920.00");
  });

  it("carries provenance and the version", () => {
    expect(snapshot.concentration!.source).toBe("concentration.v1");
    expect(snapshot.concentration!.inputs).toContain("acc_broker");
  });

  it("classifies nothing when there is nothing to classify (no shaming empty piles)", () => {
    const empty = concentration({
      snapshotId: "snap_empty",
      holdings: [],
      accounts: [],
      cashByAccount: {},
      netWorth: { investableEUR: "0.00", totalEUR: "0.00", illiquidEUR: "0.00" },
      netWorthInputs: [],
    });
    expect(empty.value.positions).toEqual([]);
    expect(empty.value.brokers).toEqual([]);
    expect(empty.value.realEstate).toBeNull();
    expect(empty.value.spain).toBeNull();
  });

  it("counts ES-ISIN holdings into Spain exposure", () => {
    const result = concentration({
      snapshotId: "snap_es",
      holdings: [
        {
          holdingId: "h_es",
          accountId: "a1",
          isin: "ES0113900J37",
          valueEUR: "50000.00",
          inputs: ["h_es"],
        },
      ],
      accounts: [{ id: "a1", type: "broker" }],
      cashByAccount: { a1: "0.00" },
      netWorth: {
        investableEUR: "50000.00",
        totalEUR: "100000.00",
        illiquidEUR: "30000.00",
      },
      netWorthInputs: [],
    });
    // (30,000 equity + 50,000 ES holding) / 100,000 = 80% > 70%.
    expect(result.value.spain).toMatchObject({ pct: 80, above: true });
  });
});
