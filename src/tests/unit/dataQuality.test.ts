import { describe, expect, it } from "vitest";
import { dataQuality, type FreshnessInput } from "@/calc/dataQuality";

const asOf = "2026-06-09";

describe("dataQuality", () => {
  it("scores Good when every input is within its cadence", () => {
    const inputs: FreshnessInput[] = [
      { id: "spend", label: "Monthly spending", lastUpdated: "2026-05-01", cadence: "monthly", required: true },
      { id: "props", label: "Property valuations", lastUpdated: "2026-04-01", cadence: "quarterly", required: false },
    ];
    const r = dataQuality({ snapshotId: "s", asOf, inputs });
    expect(r.value.score).toBe("Good");
    expect(r.value.missing).toEqual([]);
    expect(r.value.missingRequired).toEqual([]);
  });

  it("flags a never-entered required input as missing+required", () => {
    const inputs: FreshnessInput[] = [
      { id: "spend", label: "Monthly spending", lastUpdated: null, cadence: "monthly", required: true },
    ];
    const r = dataQuality({ snapshotId: "s", asOf, inputs });
    expect(r.value.missing).toContain("Monthly spending");
    expect(r.value.missingRequired).toContain("Monthly spending");
  });

  it("flags a past-cadence input as stale and reports the stalest age", () => {
    const inputs: FreshnessInput[] = [
      // 2025-01-01 is well over a year old → past the annual cadence
      { id: "assum", label: "Assumptions", lastUpdated: "2025-01-01", cadence: "annually", required: false },
      { id: "spend", label: "Monthly spending", lastUpdated: "2026-06-01", cadence: "monthly", required: true },
    ];
    const r = dataQuality({ snapshotId: "s", asOf, inputs });
    expect(r.value.missing).toContain("Assumptions");
    expect(r.value.stalestInputDays).toBe(524); // 2025-01-01 → 2026-06-09
  });

  // Soft advisory flags (spend calibration):

  it("a soft flag downgrades Good to Partial but is never required", () => {
    const inputs: FreshnessInput[] = [
      { id: "spend", label: "Monthly spend assumption", lastUpdated: "2026-05-01", cadence: "annually", required: true },
    ];
    const r = dataQuality({
      snapshotId: "s",
      asOf,
      inputs,
      flags: [
        { id: "spend-calibration", sourceIds: ["spend_1", "assum_spend"], label: "Spend assumption looks off" },
      ],
    });
    expect(r.value.score).toBe("Partial");
    expect(r.value.flags).toEqual(["Spend assumption looks off"]);
    expect(r.value.missing).toEqual([]); // a flag is advice, not staleness
    expect(r.value.missingRequired).toEqual([]);
    expect(r.inputs).toEqual(expect.arrayContaining(["spend_1", "assum_spend"]));
  });

  it("soft flags can never reach Poor — they are structurally barred from Data stale", () => {
    const inputs: FreshnessInput[] = [
      { id: "spend", label: "Monthly spend assumption", lastUpdated: "2026-05-01", cadence: "annually", required: true },
    ];
    const flags = ["a", "b", "c", "d"].map((id) => ({ id, label: id }));
    const r = dataQuality({ snapshotId: "s", asOf, inputs, flags });
    expect(r.value.score).toBe("Partial");
    expect(r.value.missingRequired).toEqual([]);
  });
});
