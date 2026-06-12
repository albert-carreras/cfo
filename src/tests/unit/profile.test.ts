import { describe, expect, it } from "vitest";
import { ageAt, profile } from "@/calc/profile";

describe("ageAt", () => {
  it("computes completed years", () => {
    expect(ageAt("1985-04-09", "2026-06-10")).toBe(41);
  });

  it("is exact around the birthday", () => {
    expect(ageAt("1985-04-09", "2026-04-08")).toBe(40); // day before
    expect(ageAt("1985-04-09", "2026-04-09")).toBe(41); // on the day
    expect(ageAt("1985-04-09", "2026-04-10")).toBe(41); // day after
  });

  it("handles Feb-29 birthdates in non-leap years", () => {
    expect(ageAt("1992-02-29", "2026-02-28")).toBe(33); // not yet
    expect(ageAt("1992-02-29", "2026-03-01")).toBe(34); // passed
    expect(ageAt("1992-02-29", "2028-02-29")).toBe(36); // leap-year birthday
  });
});

describe("profile calculator", () => {
  it("returns a versioned CalcResult citing the birthDate assumption", () => {
    const result = profile({
      snapshotId: "s",
      asOf: "2026-06-10",
      birthDate: { id: "assum_birth", date: "1985-04-09" },
    });
    expect(result.value).toEqual({ birthDate: "1985-04-09", ageYears: 41 });
    expect(result.source).toBe("profile.v1");
    expect(result.version).toBe("profile.2026.0");
    expect(result.inputs).toEqual(["assum_birth"]);
    expect(result.snapshotId).toBe("s");
  });

  it("degrades to null age with no birthDate (and cites nothing)", () => {
    const result = profile({ snapshotId: "s", asOf: "2026-06-10", birthDate: null });
    expect(result.value).toEqual({ birthDate: null, ageYears: null });
    expect(result.inputs).toEqual([]);
  });
});
