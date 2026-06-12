import { describe, expect, it } from "vitest";
import { decisionOutcomes, type DecisionThen } from "@/calc/decisionOutcome";
import type { SnapshotSummary } from "@/calc/materialChange";

// The accountability loop's arithmetic: a decision's pinned summary
// vs the current one. Pure and boring on purpose — the deltas are Calculated;
// what they mean is the review's Judgment, elsewhere.

const current: SnapshotSummary = {
  asOf: "2026-07-01",
  totalNetWorthEUR: "550000.00",
  fireCountedEUR: "300000.00",
  runwayMonths: 132,
  status: "stable",
};

function decision(overrides: Partial<DecisionThen> = {}): DecisionThen {
  return {
    id: "dec_a",
    question: "Monthly review 2026-06 — recommendation",
    decidedOn: "2026-06-01",
    reviewed: true,
    chosenAction: "kept the position",
    then: {
      asOf: "2026-06-01",
      totalNetWorthEUR: "500000.00",
      runwayMonths: 120,
      status: "review_soon",
    },
    ...overrides,
  };
}

describe("decisionOutcomes", () => {
  it("measures Δ net worth, Δ runway and status then → now per decision", () => {
    const result = decisionOutcomes({
      snapshotId: "snap_1",
      current,
      decisions: [decision()],
    });

    expect(result.value.comparedAsOf).toBe("2026-07-01");
    expect(result.value.outcomes).toHaveLength(1);
    const o = result.value.outcomes[0];
    expect(o).toMatchObject({
      decisionId: "dec_a",
      decidedOn: "2026-06-01",
      reviewed: true,
      chosenAction: "kept the position",
      netWorthThenEUR: "500000.00",
      netWorthNowEUR: "550000.00",
      netWorthDeltaEUR: "50000.00",
      netWorthDeltaPct: "10.00",
      runwayThenMonths: 120,
      runwayNowMonths: 132,
      runwayDeltaMonths: 12,
      statusThen: "review_soon",
      statusNow: "stable",
    });
  });

  it("carries provenance: the decision ids as inputs, versioned source", () => {
    const result = decisionOutcomes({
      snapshotId: "snap_1",
      current,
      decisions: [decision(), decision({ id: "dec_b", decidedOn: "2026-05-01" })],
    });
    expect(result.snapshotId).toBe("snap_1");
    expect(result.source).toBe("decisionOutcome.v1");
    expect(result.version).toBe("decisionOutcome.2026.1");
    expect(result.inputs.sort()).toEqual(["dec_a", "dec_b"]);
  });

  it("orders outcomes oldest decision first, ties broken by id", () => {
    const result = decisionOutcomes({
      snapshotId: "snap_1",
      current,
      decisions: [
        decision({ id: "dec_late", decidedOn: "2026-06-15" }),
        decision({ id: "dec_b", decidedOn: "2026-05-01" }),
        decision({ id: "dec_a", decidedOn: "2026-05-01" }),
      ],
    });
    expect(result.value.outcomes.map((o) => o.decisionId)).toEqual([
      "dec_a",
      "dec_b",
      "dec_late",
    ]);
  });

  it("a zero then-net-worth yields a null percentage, never a division blowup", () => {
    const result = decisionOutcomes({
      snapshotId: "snap_1",
      current,
      decisions: [
        decision({
          then: {
            asOf: "2026-06-01",
            totalNetWorthEUR: "0.00",
            runwayMonths: null,
            status: "data_stale",
          },
        }),
      ],
    });
    const o = result.value.outcomes[0];
    expect(o.netWorthDeltaEUR).toBe("550000.00");
    expect(o.netWorthDeltaPct).toBeNull();
    expect(o.runwayDeltaMonths).toBeNull();
    expect(o.runwayThenMonths).toBeNull();
  });

  it("a negative move is signed, and an unknown current runway stays null", () => {
    const result = decisionOutcomes({
      snapshotId: "snap_1",
      current: { ...current, totalNetWorthEUR: "450000.00", runwayMonths: null },
      decisions: [decision()],
    });
    const o = result.value.outcomes[0];
    expect(o.netWorthDeltaEUR).toBe("-50000.00");
    expect(o.netWorthDeltaPct).toBe("-10.00");
    expect(o.runwayDeltaMonths).toBeNull();
  });

  it("no journaled decisions is an empty, honest result", () => {
    const result = decisionOutcomes({
      snapshotId: "snap_1",
      current,
      decisions: [],
    });
    expect(result.value.outcomes).toEqual([]);
    expect(result.inputs).toEqual([]);
  });
});
