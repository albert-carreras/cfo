import { describe, expect, it } from "vitest";
import {
  EDITABLE_ASSUMPTION_KEYS,
  orderAssumptionRows,
  type AssumptionRow,
} from "./assumptionKeys";

function row(key: string, value: string | null = "1"): AssumptionRow {
  return { key, value, dateValue: null, lastReviewedAt: "2026-06-11" };
}

describe("orderAssumptionRows", () => {
  it("orders set rows by the editable-keys order, not alphabetically", () => {
    const rows = [row("inflation"), row("monthlySpend"), row("expectedReturn")];
    const ordered = orderAssumptionRows(rows).filter((r) => r.value !== null);
    expect(ordered.map((r) => r.key)).toEqual([
      "monthlySpend",
      "expectedReturn",
      "inflation",
    ]);
  });

  it("includes every editable key, unset ones as empty rows", () => {
    const ordered = orderAssumptionRows([row("monthlySpend", "2200")]);
    expect(ordered.map((r) => r.key)).toEqual([...EDITABLE_ASSUMPTION_KEYS]);
    expect(ordered[0]).toEqual(row("monthlySpend", "2200"));
    const birthDate = ordered.find((r) => r.key === "birthDate");
    expect(birthDate).toEqual({
      key: "birthDate",
      value: null,
      dateValue: null,
      lastReviewedAt: null,
    });
  });

  it("appends script-only keys alphabetically after the editable ones", () => {
    const ordered = orderAssumptionRows([row("zCustom"), row("aCustom")]);
    expect(ordered.slice(EDITABLE_ASSUMPTION_KEYS.length).map((r) => r.key)).toEqual([
      "aCustom",
      "zCustom",
    ]);
  });
});
