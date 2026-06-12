import { describe, expect, it } from "vitest";
import {
  decimalString,
  isCalendarDate,
  isoDate,
  monthString,
  nonNegativeDecimalString,
} from "@/shared/validation";

describe("shared validation primitives", () => {
  it("decimalString requires a strictly positive decimal", () => {
    expect(decimalString.safeParse("0.01").success).toBe(true);
    expect(decimalString.safeParse("0").success).toBe(false);
    expect(decimalString.safeParse("-5").success).toBe(false);
    expect(decimalString.safeParse("1,5").success).toBe(false);
  });

  it("nonNegativeDecimalString allows zero", () => {
    expect(nonNegativeDecimalString.safeParse("0").success).toBe(true);
    expect(nonNegativeDecimalString.safeParse("-1").success).toBe(false);
  });

  it("isoDate rejects impossible calendar dates", () => {
    expect(isoDate.safeParse("2026-06-11").success).toBe(true);
    expect(isoDate.safeParse("2026-02-30").success).toBe(false);
    expect(isoDate.safeParse("11/06/2026").success).toBe(false);
    expect(isCalendarDate("2024-02-29")).toBe(true); // leap day
    expect(isCalendarDate("2026-02-29")).toBe(false);
  });

  it("monthString is YYYY-MM with a real month", () => {
    expect(monthString.safeParse("2026-06").success).toBe(true);
    expect(monthString.safeParse("2026-13").success).toBe(false);
    expect(monthString.safeParse("2026-6").success).toBe(false);
  });
});
