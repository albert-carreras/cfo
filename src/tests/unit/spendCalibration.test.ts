import { describe, expect, it } from "vitest";
import { spendCalibration } from "@/calc/spendCalibration";

const asOf = "2026-06-09";

const log = (id: string, month: string, amount: string, createdAt?: string) => ({
  id,
  month,
  amount,
  createdAt: createdAt ?? `${month}-28T09:00:00.000Z`,
});

describe("spendCalibration (the optional log checks the assumption)", () => {
  it("averages the trailing window and stays quiet inside the ±25% band", () => {
    const r = spendCalibration({
      asOf,
      assumptionEUR: "3200",
      logs: [
        log("s3", "2026-03", "3000"),
        log("s4", "2026-04", "3200"),
        log("s5", "2026-05", "3100"),
      ],
    });
    expect(r).not.toBeNull();
    expect(r!.trailingAvgEUR).toBe("3100.00");
    expect(r!.monthsUsed).toBe(3);
    expect(r!.divergencePct).toBe("-3.1"); // logs run slightly under
    expect(r!.divergent).toBe(false);
    expect(r!.inputs).toEqual(["s3", "s4", "s5"]);
  });

  it("flags a divergence past the threshold, in either direction", () => {
    const high = spendCalibration({
      asOf,
      assumptionEUR: "2000",
      logs: [
        log("s3", "2026-03", "3000"),
        log("s4", "2026-04", "3200"),
        log("s5", "2026-05", "3100"),
      ],
    });
    expect(high!.divergent).toBe(true);
    expect(Number(high!.divergencePct)).toBeGreaterThan(25);

    const low = spendCalibration({
      asOf,
      assumptionEUR: "5000",
      logs: [
        log("s3", "2026-03", "3000"),
        log("s4", "2026-04", "3200"),
        log("s5", "2026-05", "3100"),
      ],
    });
    expect(low!.divergent).toBe(true);
    expect(Number(low!.divergencePct)).toBeLessThan(-25);
  });

  it("returns null below the minimum logged months — one odd month cannot flag", () => {
    const r = spendCalibration({
      asOf,
      assumptionEUR: "3200",
      logs: [log("s5", "2026-05", "9000"), log("s4", "2026-04", "9000")],
    });
    expect(r).toBeNull();
  });

  it("returns null without a positive assumption (nothing to calibrate against)", () => {
    const logs = [
      log("s3", "2026-03", "3000"),
      log("s4", "2026-04", "3200"),
      log("s5", "2026-05", "3100"),
    ];
    expect(spendCalibration({ asOf, assumptionEUR: null, logs })).toBeNull();
    expect(spendCalibration({ asOf, assumptionEUR: "0", logs })).toBeNull();
  });

  it("ignores months outside the trailing window and rows not yet effective", () => {
    const r = spendCalibration({
      asOf,
      assumptionEUR: "3200",
      logs: [
        log("old", "2025-11", "9000"), // before the 6-month window (Jan–Jun)
        log("s3", "2026-03", "3000"),
        log("s4", "2026-04", "3200"),
        log("s5", "2026-05", "3100"),
        log("future", "2026-06", "9000", "2026-06-10T09:00:00.000Z"), // created after asOf
      ],
    });
    expect(r!.monthsUsed).toBe(3);
    expect(r!.inputs).toEqual(["s3", "s4", "s5"]);
  });

  it("a re-logged month supersedes the earlier figure (append-only correction)", () => {
    const r = spendCalibration({
      asOf,
      assumptionEUR: "3000",
      logs: [
        log("s3", "2026-03", "3000"),
        log("s4_v1", "2026-04", "9000", "2026-05-02T09:00:00.000Z"),
        log("s4_v2", "2026-04", "3000", "2026-05-03T09:00:00.000Z"),
        log("s5", "2026-05", "3000"),
      ],
    });
    expect(r!.trailingAvgEUR).toBe("3000.00");
    expect(r!.inputs).toEqual(["s3", "s4_v2", "s5"]);
    expect(r!.divergent).toBe(false);
  });

  it("the window crosses a year boundary correctly", () => {
    const r = spendCalibration({
      asOf: "2026-02-15",
      assumptionEUR: "3000",
      logs: [
        log("s9", "2025-09", "3000"),
        log("s11", "2025-11", "3000"),
        log("s1", "2026-01", "3000"),
      ],
    });
    expect(r!.monthsUsed).toBe(3); // Sep 2025 … Feb 2026 are all in the window
  });
});
