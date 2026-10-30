import { describe, expect, it } from "vitest";
import { normalizeNumberInput } from "@/shared/validation";

describe("forgiving number entry", () => {
  it("reads common money spellings", () => {
    expect(normalizeNumberInput("124,000")).toBe("124000");
    expect(normalizeNumberInput("124.000")).toBe("124000");
    expect(normalizeNumberInput("€ 124 000")).toBe("124000");
    expect(normalizeNumberInput("124k")).toBe("124000");
    expect(normalizeNumberInput("1.234,56")).toBe("1234.56");
    expect(normalizeNumberInput("1,234.56")).toBe("1234.56");
    expect(normalizeNumberInput("93,5")).toBe("93.5");
  });

  it("never reads a units dot as thousands", () => {
    expect(normalizeNumberInput("1.500", "units")).toBe("1.500");
    expect(normalizeNumberInput("1,321", "units")).toBe("1321");
    expect(normalizeNumberInput("12,5", "units")).toBe("12.5");
    expect(normalizeNumberInput("1,321,000", "units")).toBe("1321000");
  });

  it("leaves junk for the schema to reject", () => {
    expect(normalizeNumberInput("abc")).toBe("abc");
    expect(normalizeNumberInput("")).toBe("");
  });
});
