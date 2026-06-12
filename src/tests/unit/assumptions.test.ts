import { describe, expect, it } from "vitest";
import {
  assumptionInputSchema,
  buildAssumptionUpsert,
} from "@/server/assumptions";

const NOW = new Date("2026-06-11T10:00:00.000Z");

describe("assumption input schema", () => {
  it("accepts a numeric assumption", () => {
    const r = assumptionInputSchema.safeParse({
      key: "safeWithdrawalRate",
      value: "0.035",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.source).toBe("user"); // default applied
  });

  it("accepts a date-typed assumption", () => {
    expect(
      assumptionInputSchema.safeParse({ key: "birthDate", dateValue: "1985-04-09" })
        .success,
    ).toBe(true);
  });

  it("requires exactly one of value or dateValue", () => {
    expect(assumptionInputSchema.safeParse({ key: "x" }).success).toBe(false);
    expect(
      assumptionInputSchema.safeParse({
        key: "x",
        value: "1",
        dateValue: "2026-01-01",
      }).success,
    ).toBe(false);
  });

  it("rejects variants on a date-typed assumption", () => {
    expect(
      assumptionInputSchema.safeParse({
        key: "birthDate",
        dateValue: "1985-04-09",
        conservativeValue: "1",
      }).success,
    ).toBe(false);
  });

  it("rejects malformed numbers and dates", () => {
    expect(
      assumptionInputSchema.safeParse({ key: "x", value: "three" }).success,
    ).toBe(false);
    expect(
      assumptionInputSchema.safeParse({ key: "x", dateValue: "27/02/1990" })
        .success,
    ).toBe(false);
  });
});

describe("buildAssumptionUpsert", () => {
  it("defaults lastReviewedAt to today", () => {
    const parsed = assumptionInputSchema.parse({
      key: "monthlySpend",
      value: "2200",
    });
    const { values } = buildAssumptionUpsert(parsed, NOW);
    expect(values.lastReviewedAt).toBe("2026-06-11");
    expect(values.value).toBe("2200");
    expect(values.dateValue).toBeNull();
  });

  it("preserves omitted conservative/optimistic variants on update", () => {
    const parsed = assumptionInputSchema.parse({
      key: "monthlySpend",
      value: "2400",
    });
    const { values, set } = buildAssumptionUpsert(parsed, NOW);
    // The insert row nulls them; the conflict-update set must NOT touch them,
    // so re-setting monthlySpend never wipes its conservative/optimistic variants.
    expect(values.conservativeValue).toBeNull();
    expect(values.optimisticValue).toBeNull();
    expect("conservativeValue" in set).toBe(false);
    expect("optimisticValue" in set).toBe(false);
    expect(set.value).toBe("2400");
  });

  it("updates a variant when explicitly provided", () => {
    const parsed = assumptionInputSchema.parse({
      key: "monthlySpend",
      value: "2400",
      conservativeValue: "2800",
    });
    const { set } = buildAssumptionUpsert(parsed, NOW);
    expect(set.conservativeValue).toBe("2800");
    expect("optimisticValue" in set).toBe(false);
  });
});
