import { describe, expect, it } from "vitest";
import { selectTaxConfigs } from "@/calc/config/taxRegistry";
import { TAX_ES_CAT_2026 } from "@/calc/config/taxES.es-cat.2026";
import { TAX_IP_CAT_2026 } from "@/calc/config/taxIP.es-cat.2026";

// The tax tables are selected BY YEAR — a snapshot never silently computes a
// new year under old tables without saying so: the fallback flag feeds the
// soft "tax tables stale" freshness entry, and the selected config keeps its
// own year/version label.

describe("selectTaxConfigs", () => {
  it("returns the exact year's tables when they exist", () => {
    const r = selectTaxConfigs(2026);
    expect(r.income).toBe(TAX_ES_CAT_2026);
    expect(r.wealth).toBe(TAX_IP_CAT_2026);
    expect(r.fallback).toBe(false);
  });

  it("falls back to the latest available year ≤ the requested one, flagged", () => {
    const r = selectTaxConfigs(2027);
    expect(r.income).toBe(TAX_ES_CAT_2026);
    expect(r.income.year).toBe(2026); // the label stays honest
    expect(r.fallback).toBe(true);
  });

  it("falls back to the oldest tables for a pre-registry year, flagged", () => {
    const r = selectTaxConfigs(2020);
    expect(r.income).toBe(TAX_ES_CAT_2026);
    expect(r.fallback).toBe(true);
  });
});
