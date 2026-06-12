import { describe, expect, it } from "vitest";
import { formatEUR, formatEURCoarse, formatYearsCoarse } from "@/calc/money";

describe("coarse formatting (the surface thinks in years and percent)", () => {
  it("rounds EUR amounts to three significant figures (~nearest €1k on a net worth)", () => {
    expect(formatEURCoarse("868520.00")).toBe("€869,000");
    expect(formatEURCoarse("1234567.89")).toBe("€1,230,000");
    expect(formatEURCoarse("3216.44")).toBe("€3,220");
    expect(formatEURCoarse("943.21")).toBe("€943");
    expect(formatEURCoarse("0")).toBe("€0");
    expect(formatEURCoarse("-123456")).toBe("-€123,000");
  });

  it("a ±€1,000/month imprecision does not move the coarse figure", () => {
    expect(formatEURCoarse("868520.00")).toBe(formatEURCoarse("869120.00"));
  });

  it("keeps the exact formatter exact (full precision lives in the depth)", () => {
    expect(formatEUR("868520.00")).toBe("€868,520.00");
  });

  it("presents runway in years — one decimal under a decade, whole years above", () => {
    expect(formatYearsCoarse(6.67)).toBe("6.7 years");
    expect(formatYearsCoarse(29.04)).toBe("29 years");
    expect(formatYearsCoarse(10)).toBe("10 years");
    expect(formatYearsCoarse(1.5)).toBe("1.5 years");
  });
});
