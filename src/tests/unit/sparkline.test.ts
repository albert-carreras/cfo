import { describe, expect, it } from "vitest";
import { sparklinePoints } from "@/shared/sparkline";

describe("sparklinePoints", () => {
  it("returns null for fewer than two points", () => {
    expect(sparklinePoints([], { width: 120, height: 28 })).toBeNull();
    expect(sparklinePoints([5], { width: 120, height: 28 })).toBeNull();
  });

  it("maps an ascending series bottom-left to top-right", () => {
    const points = sparklinePoints([0, 100], { width: 120, height: 28, pad: 2 });
    expect(points).toBe("2,26 118,2");
  });

  it("spreads points evenly across the width", () => {
    const points = sparklinePoints([0, 50, 100], {
      width: 120,
      height: 28,
      pad: 2,
    });
    const xs = points!.split(" ").map((p) => Number(p.split(",")[0]));
    expect(xs).toEqual([2, 60, 118]);
  });

  it("centres a flat series vertically", () => {
    const points = sparklinePoints([42, 42, 42], {
      width: 120,
      height: 28,
      pad: 2,
    });
    const ys = points!.split(" ").map((p) => Number(p.split(",")[1]));
    expect(ys).toEqual([14, 14, 14]);
  });
});
