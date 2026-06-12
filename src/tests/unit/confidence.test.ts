import { describe, expect, it } from "vitest";
import {
  confidence,
  confidenceObservation,
  type ConfidenceObservation,
} from "@/calc/confidence";
import { computeSnapshot } from "@/calc/snapshot";
import { facts, FIXTURE_AS_OF } from "../fixtures";

// A perfect day: runway at/above the 300-month target, safe spend covers
// actual spend, data quality Good ⇒ raw composite 100.
function perfect(asOf: string, id = `s-${asOf}`): ConfidenceObservation {
  return {
    snapshotId: id,
    asOf,
    runwayMonths: 320,
    monthlySpendEUR: "3000.00",
    safeMonthlySpendEUR: "4000.00",
    dataQuality: "Good",
  };
}

// A crashed day: runway 180/300 ⇒ 60, coverage 0.8 ⇒ 80, Good ⇒ 100.
// Raw = 80·0.5 + 60·0.3 + 100·0.2 = 78.
function crashed(asOf: string, id = `s-${asOf}`): ConfidenceObservation {
  return {
    snapshotId: id,
    asOf,
    runwayMonths: 180,
    monthlySpendEUR: "3000.00",
    safeMonthlySpendEUR: "2400.00",
    dataQuality: "Good",
  };
}

function day(i: number): string {
  const d = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
  return d.toISOString().slice(0, 10);
}

describe("confidence (the SLOW score, principle #11)", () => {
  it("a single observation: smoothed == raw", () => {
    const r = confidence({ snapshotId: "s", observations: [perfect(day(0))] });
    expect(r.value.score).toBe(100);
    expect(r.value.rawScore).toBe(100);
    expect(r.value.observations).toBe(1);
    expect(r.source).toBe("confidence.v1");
    expect(r.version).toBe("confidence.2026.0");
  });

  it("one crash day NUDGES the score, it does not crater it", () => {
    const r = confidence({
      snapshotId: "s",
      observations: [perfect(day(0)), crashed(day(1))],
    });
    expect(r.value.rawScore).toBe(78); // today is genuinely worse…
    expect(r.value.score).toBe(99); // …but the smoothed score barely moves
  });

  it("a sustained crash shows half its size after one half-life (30 days)", () => {
    const observations = [
      perfect(day(0)),
      ...Array.from({ length: 30 }, (_, i) => crashed(day(i + 1))),
    ];
    const r = confidence({ snapshotId: "s", observations });
    // EMA: 78 + (100 − 78) · 0.5^(30/30) = 89, exactly halfway down.
    expect(r.value.score).toBe(89);
  });

  it("is gap-aware: one observation 30 days later decays the same as 30 daily ones", () => {
    const r = confidence({
      snapshotId: "s",
      observations: [perfect(day(0)), crashed(day(30))],
    });
    expect(r.value.score).toBe(89);
  });

  it("a same-day duplicate changes nothing", () => {
    const base = confidence({
      snapshotId: "s",
      observations: [perfect(day(0)), crashed(day(1), "s-a")],
    });
    const dup = confidence({
      snapshotId: "s",
      observations: [perfect(day(0)), crashed(day(1), "s-a"), crashed(day(1), "s-b")],
    });
    expect(dup.value.score).toBe(base.value.score);
  });

  it("sorts unsorted input — the EMA is deterministic regardless of query order", () => {
    const asc = confidence({
      snapshotId: "s",
      observations: [perfect(day(0)), crashed(day(1)), crashed(day(2))],
    });
    const shuffled = confidence({
      snapshotId: "s",
      observations: [crashed(day(2)), perfect(day(0)), crashed(day(1))],
    });
    expect(shuffled.value.score).toBe(asc.value.score);
  });

  it("missing inputs reweight, never crater: no spend logged ⇒ data quality only", () => {
    const r = confidence({
      snapshotId: "s",
      observations: [
        {
          snapshotId: "s-0",
          asOf: day(0),
          runwayMonths: null,
          monthlySpendEUR: "0.00",
          safeMonthlySpendEUR: null,
          dataQuality: "Partial",
        },
      ],
    });
    expect(r.value.score).toBe(70); // the Partial data-quality score, alone
    expect(r.value.components).toHaveLength(1);
    expect(r.value.components[0].key).toBe("dataQuality");
    expect(r.value.components[0].weight).toBe(1);
  });

  it("degraded data quality lowers the composite (principle #7: a separate signal, but a component)", () => {
    const good = confidence({ snapshotId: "s", observations: [perfect(day(0))] });
    const poor = confidence({
      snapshotId: "s",
      observations: [{ ...perfect(day(0)), dataQuality: "Poor" }],
    });
    expect(poor.value.score).toBeLessThan(good.value.score);
    expect(poor.value.score).toBe(86); // 100·0.8 + 30·0.2
  });

  it("carries provenance: inputs are the snapshot ids it smoothed over", () => {
    const r = confidence({
      snapshotId: "s",
      observations: [perfect(day(0), "snap-a"), crashed(day(1), "snap-b")],
    });
    expect(r.inputs).toEqual(["snap-a", "snap-b"]);
    expect(r.value.firstObservedAt).toBe(day(0));
  });

  it("refuses to compute from nothing", () => {
    expect(() => confidence({ snapshotId: "s", observations: [] })).toThrow();
  });

  it("adapts a real snapshot into an observation", () => {
    const snap = computeSnapshot({
      snapshotId: "s",
      asOf: FIXTURE_AS_OF,
      reviewDue: false,
      facts,
    });
    const obs = confidenceObservation(snap);
    expect(obs.snapshotId).toBe("s");
    expect(obs.asOf).toBe(FIXTURE_AS_OF);
    expect(obs.runwayMonths).toBe(snap.fire.value.runwayMonths);
    expect(obs.dataQuality).toBe("Good");
    // The fixture plan is only part-way to FIRE (safe spend covers ~32% of
    // the spend assumption, runway ~109/300 months) with Good data — so plan
    // soundness honestly sits mid-scale. Deterministic, so exact.
    const r = confidence({ snapshotId: "s", observations: [obs] });
    expect(r.value.score).toBe(47);
  });
});
