import { z } from "zod";
import { dec } from "@/calc/money";

// Client-importable Zod primitives shared by every input surface (quick-log,
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
