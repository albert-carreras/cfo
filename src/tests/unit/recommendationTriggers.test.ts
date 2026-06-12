import { describe, expect, it } from "vitest";
import type { ConcentrationValue } from "@/calc/concentration";
import { recommendationTriggers } from "@/calc/recommendationTriggers";
import { computeSnapshot } from "@/calc/snapshot";
import { facts, FIXTURE_AS_OF } from "../fixtures";

// The deterministic conditions that PERMIT the review to recommend. No fired
// trigger ⇒ no recommendation (enforced in reviewSchema validation) — so these
// conditions are the whole recommendation surface and must be exact.

const calmConcentration: ConcentrationValue = {
  investableEUR: "100000.00",
  totalEUR: "200000.00",
  positions: [],
  brokers: [],
  realEstate: { pct: 30, valueEUR: "60000.00", ceilingPct: 65, above: false },
  spain: { pct: 30, valueEUR: "60000.00", ceilingPct: 70, above: false },
};

function run(over: Partial<Parameters<typeof recommendationTriggers>[0]> = {}) {
  return recommendationTriggers({
    snapshotId: "snap_trig",
    concentration: calmConcentration,
    liquidEUR: "20000.00",
    monthlySpendEUR: "3000.00",
    safeMonthlySpendEUR: "3500.00",
    realizedGainsEUR: "0.00",
    unrealized: [],
    inputs: [],
    ...over,
  });
}

describe("recommendationTriggers", () => {
  it("fires nothing on a calm snapshot — informative silence", () => {
    expect(run().value.fired).toEqual([]);
  });

  it("fires per concentration dimension above its ceiling", () => {
    const result = run({
      concentration: {
        ...calmConcentration,
        positions: [
          { holdingId: "h1", isin: "IE000", pct: 40, valueEUR: "40000.00", ceilingPct: 25, above: true },
        ],
        brokers: [
          { accountId: "a1", pct: 70, valueEUR: "70000.00", ceilingPct: 60, above: true },
        ],
        realEstate: { pct: 70, valueEUR: "140000.00", ceilingPct: 65, above: true },
        spain: { pct: 75, valueEUR: "150000.00", ceilingPct: 70, above: true },
      },
    });
    expect(result.value.fired.map((f) => f.id)).toEqual([
      "concentration-position",
      "concentration-broker",
      "concentration-real-estate",
      "concentration-spain",
    ]);
    // The offending facts ride along as provenance.
    expect(result.value.fired[0].sourceIds).toContain("h1");
  });

  it("fires cash drag only above the months ceiling, and only with a spend assumption", () => {
    // 24 months × 3,000 = 72,000.
    expect(
      run({ liquidEUR: "73000.00" }).value.fired.map((f) => f.id),
    ).toEqual(["cash-drag"]);
    expect(run({ liquidEUR: "72000.00" }).value.fired).toEqual([]);
    expect(
      run({ liquidEUR: "990000.00", monthlySpendEUR: null }).value.fired,
    ).toEqual([]);
  });

  it("fires overspend when the assumption exceeds the safe draw", () => {
    const result = run({ safeMonthlySpendEUR: "2500.00" });
    expect(result.value.fired.map((f) => f.id)).toEqual(["overspend"]);
  });

  it("fires harvestable losses only when realized gains exist to offset", () => {
    const loser = {
      holdingId: "h2",
      costBasisEUR: "10000.00",
      valueEUR: "8000.00",
      sourceIds: ["h2", "lot_x"],
    };
    // A loss with no gains: nothing to harvest against.
    expect(run({ unrealized: [loser] }).value.fired).toEqual([]);
    const result = run({ unrealized: [loser], realizedGainsEUR: "5000.00" });
    expect(result.value.fired.map((f) => f.id)).toEqual(["harvestable-losses"]);
    expect(result.value.fired[0].sourceIds).toContain("lot_x");
    // Gains but no losers: nothing either.
    expect(run({ realizedGainsEUR: "5000.00" }).value.fired).toEqual([]);
  });

  it("the fixture snapshot fires concentration (VWCE, single broker) and overspend", () => {
    const snapshot = computeSnapshot({
      snapshotId: "snap_fix",
      asOf: FIXTURE_AS_OF,
      reviewDue: false,
      facts,
      withScenarios: false,
    });
    expect(
      snapshot.recommendationTriggers!.value.fired.map((f) => f.id),
    ).toEqual(["concentration-position", "concentration-broker", "overspend"]);
    expect(snapshot.recommendationTriggers!.source).toBe(
      "recommendationTriggers.v1",
    );
  });
});
