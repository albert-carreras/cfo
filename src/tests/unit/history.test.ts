import { describe, expect, it } from "vitest";
import { netWorthDeltaLabel } from "@/shared/history";

describe("netWorthDeltaLabel", () => {
  it("returns null when there is no earlier snapshot", () => {
    expect(netWorthDeltaLabel("100000.00", null)).toBeNull();
    expect(netWorthDeltaLabel("100000.00", undefined)).toBeNull();
  });

  it("signs and rounds a gain", () => {
    expect(netWorthDeltaLabel("102019.40", "100000.00")).toBe("+€2,019");
  });

  it("signs a loss with a minus sign", () => {
    expect(netWorthDeltaLabel("98000.00", "100000.00")).toBe("−€2,000");
  });

  it("marks no change", () => {
    expect(netWorthDeltaLabel("100000.00", "100000.00")).toBe("±€0");
  });
});
