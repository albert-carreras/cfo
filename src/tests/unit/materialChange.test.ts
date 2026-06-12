import { describe, expect, it } from "vitest";
import {
  materialChange,
  type SnapshotSummary,
} from "@/calc/materialChange";

const base: SnapshotSummary = {
  asOf: "2026-06-01",
  totalNetWorthEUR: "868520.00",
  runwayMonths: 112.4,
  status: "stable",
};

function current(overrides: Partial<SnapshotSummary> = {}): SnapshotSummary {
  return { ...base, asOf: "2026-06-09", ...overrides };
}

describe("materialChange (the daily→monthly firewall)", () => {
  it("is material when no strategic snapshot exists yet", () => {
    const r = materialChange({ snapshotId: "s", previous: null, current: current() });
    expect(r.value.material).toBe(true);
    expect(r.value.changes[0].kind).toBe("first_snapshot");
    expect(r.value.comparedTo).toBeNull();
  });

  it("a quiet day is NOT material — the calm surface stays put", () => {
    const r = materialChange({
      snapshotId: "s",
      previous: base,
      current: current({ totalNetWorthEUR: "871000.00", runwayMonths: 112.9 }),
    });
    expect(r.value.material).toBe(false);
    expect(r.value.changes).toEqual([]);
    expect(r.value.comparedTo).toBe("2026-06-01");
    expect(r.value.netWorthDeltaPct).toBe("0.29");
  });

  it("a ≥5% net-worth move is material (both directions)", () => {
    const down = materialChange({
      snapshotId: "s",
      previous: base,
      current: current({ totalNetWorthEUR: "820000.00" }), // −5.6%
    });
    expect(down.value.material).toBe(true);
    expect(down.value.changes[0].kind).toBe("net_worth_move");

    const up = materialChange({
      snapshotId: "s",
      previous: base,
      current: current({ totalNetWorthEUR: "915000.00" }), // +5.4%
    });
    expect(up.value.material).toBe(true);
  });

  it("a 4.9% move is NOT material — the threshold is exact", () => {
    const r = materialChange({
      snapshotId: "s",
      previous: base,
      current: current({ totalNetWorthEUR: "825951.00" }), // −4.9009%
    });
    expect(r.value.material).toBe(false);
  });

  it("runway crossing below the 18-month floor is material", () => {
    const r = materialChange({
      snapshotId: "s",
      previous: { ...base, runwayMonths: 20 },
      current: current({ runwayMonths: 17.5 }),
    });
    expect(r.value.material).toBe(true);
    expect(r.value.changes[0].kind).toBe("runway_floor_crossed");
  });

  it("runway already below the floor does not re-fire every day", () => {
    const r = materialChange({
      snapshotId: "s",
      previous: { ...base, runwayMonths: 17 },
      current: current({ runwayMonths: 16 }),
    });
    expect(r.value.material).toBe(false);
  });

  it("status worsening into the action band is material; cadence churn is not", () => {
    const worse = materialChange({
      snapshotId: "s",
      previous: base,
      current: current({ status: "urgent" }),
    });
    expect(worse.value.material).toBe(true);
    expect(worse.value.changes[0].kind).toBe("status_worsened");

    const review = materialChange({
      snapshotId: "s",
      previous: base,
      current: current({ status: "review_soon" }),
    });
    expect(review.value.material).toBe(false);

    const recovered = materialChange({
      snapshotId: "s",
      previous: { ...base, status: "urgent" },
      current: current({ status: "stable" }),
    });
    expect(recovered.value.material).toBe(false);
  });

  // ---- the liquid+investable pile gets its own threshold ----

  it("an equity-only crash diluted by property equity IS material via fireCountedEUR", () => {
    // 12% liquid crash inside an RE-heavy portfolio: total moves only −4.8%
    // (under the net-worth threshold) — exactly the gap the fireCounted threshold closes.
    const r = materialChange({
      snapshotId: "s",
      previous: { ...base, fireCountedEUR: "348520.00" },
      current: current({
        totalNetWorthEUR: "826697.60", // −4.8% (not material on its own)
        fireCountedEUR: "306697.60", // −12.0%
      }),
    });
    expect(r.value.material).toBe(true);
    expect(r.value.changes).toHaveLength(1);
    expect(r.value.changes[0].kind).toBe("fire_counted_move");
  });

  it("a sub-threshold liquid move is NOT material", () => {
    const r = materialChange({
      snapshotId: "s",
      previous: { ...base, fireCountedEUR: "348520.00" },
      current: current({ fireCountedEUR: "335000.00" }), // −3.9%
    });
    expect(r.value.material).toBe(false);
  });

  it("skips the fireCounted check quietly against a legacy stored summary", () => {
    // Older persisted summaries lack fireCountedEUR — never a crash.
    const r = materialChange({
      snapshotId: "s",
      previous: base, // no fireCountedEUR
      current: current({ fireCountedEUR: "200000.00" }),
    });
    expect(r.value.material).toBe(false);
  });

  it("carries its source/version like every calculator", () => {
    const r = materialChange({ snapshotId: "s", previous: base, current: current() });
    expect(r.source).toBe("materialChange.v1");
    expect(r.version).toBe("materialChange.2026.1");
    expect(r.snapshotId).toBe("s");
  });
});
