import { describe, expect, it } from "vitest";
import { status } from "@/calc/status";
import type { DataQualityValue } from "@/calc/dataQuality";

const goodDq: DataQualityValue = {
  score: "Good",
  missing: [],
  missingRequired: [],
  flags: [],
  stalestInputDays: 10,
};

// A plan that holds: spend at/below the safe monthly draw.
const calm = {
  snapshotId: "s",
  runwayMonths: 120,
  monthlySpendEUR: "900",
  safeMonthlySpendEUR: "1000.00",
  dataQuality: goodDq,
  reviewDue: false,
};

describe("status engine", () => {
  it("is Stable when runway is healthy, spend is within the safe rate, data is fresh", () => {
    const r = status(calm);
    expect(r.value.status).toBe("stable");
  });

  it("is Review soon when a review is due", () => {
    const r = status({ ...calm, reviewDue: true });
    expect(r.value.status).toBe("review_soon");
  });

  it("is Action recommended below the comfortable runway floor", () => {
    const r = status({ ...calm, runwayMonths: 12 });
    expect(r.value.status).toBe("action_recommended");
  });

  it("is Urgent below the hard runway floor", () => {
    const r = status({ ...calm, runwayMonths: 3 });
    expect(r.value.status).toBe("urgent");
  });

  // The overspend rules ("base-case FIRE no longer holds"):

  it("is Action recommended when the spend assumption exceeds safe spend beyond the tolerance", () => {
    // +20% over the safe draw, past the 10% tolerance.
    const r = status({ ...calm, monthlySpendEUR: "1200" });
    expect(r.value.status).toBe("action_recommended");
    // Coarse by design: the reason speaks in percent, never in cents.
    expect(r.value.reason).toContain("20% above the safe monthly spend");
  });

  it("is Review soon when the assumption sits above safe spend but inside the tolerance band", () => {
    // +5% over the safe draw, inside the 10% band.
    const r = status({ ...calm, monthlySpendEUR: "1050" });
    expect(r.value.status).toBe("review_soon");
    expect(r.value.reason).toContain("tolerance");
  });

  it("overspend needs both sides: a missing assumption or SWR disables the rule, never fakes it", () => {
    expect(
      status({ ...calm, monthlySpendEUR: null }).value.status,
    ).toBe("stable");
    expect(
      status({ ...calm, monthlySpendEUR: "1200", safeMonthlySpendEUR: null })
        .value.status,
    ).toBe("stable");
  });

  it("a low runway floor still outranks the overspend rule (worst signal first)", () => {
    const r = status({ ...calm, runwayMonths: 12, monthlySpendEUR: "1200" });
    expect(r.value.reason).toContain("comfortable floor");
  });

  it("Data stale takes precedence over everything (honest staleness beats false calm)", () => {
    const staleDq: DataQualityValue = {
      score: "Poor",
      missing: ["Monthly spend assumption"],
      missingRequired: ["Monthly spend assumption"],
      flags: [],
      stalestInputDays: 400,
    };
    // Even with a dangerously low runway and a wild overspend, staleness wins.
    const r = status({
      ...calm,
      runwayMonths: 2,
      monthlySpendEUR: "5000",
      dataQuality: staleDq,
    });
    expect(r.value.status).toBe("data_stale");
  });
});
