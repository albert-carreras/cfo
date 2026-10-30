import { z } from "zod";
import { dec } from "@/calc/money";

// Client-importable Zod primitives shared by input surfaces (setup, Data,
// setup, manage). Server modules compose these; forms may reuse them for
// inline validation. No server imports allowed here.

export const decimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "must be a positive decimal number")
  .refine((value) => {
    try {
      return dec(value).greaterThan(0);
    } catch {
      return false;
    }
  }, "must be greater than zero");

export const nonNegativeDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal number");

export function isCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine(isCalendarDate, "must be a real calendar date");

export const monthString = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be YYYY-MM");

// Forgiving number entry: "124,000", "124.000", "€124k", "1 234,5" all read
// as intended. Comma groups of three digits are thousands; a dot is a
// thousands separator only for money (1.500 units is one and a half).
// Returns the input untouched when it can't be read, so the schema reports it.
export function normalizeNumberInput(raw: string, kind: "money" | "units" = "money"): string {
  let text = raw.trim().replace(/[\s€]/g, "");
  if (text === "") return "";
  let multiplier = 1;
  if (kind === "money" && /k$/i.test(text)) {
    multiplier = 1000;
    text = text.slice(0, -1);
  }
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    text = text.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    text = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, "") : text.replace(",", ".");
  } else if (lastDot >= 0 && kind === "money" && /^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return raw.trim();
  return multiplier === 1 ? text : (Number(text) * multiplier).toString();
}
