// Planned major changes: context for decisions, never a number in today's
// position. A plan may be recorded before its timing or amount is known: a
// far-future date stands in for "timing unknown" and a zero amount for
// "amount TBD". These helpers keep one reading everywhere.

export const PLAN_TYPES = [
  "house_purchase",
  "property_sale",
  "job_exit",
  "pension_withdrawal",
  "rental_start",
  "inheritance",
] as const;

export type PlanType = (typeof PLAN_TYPES)[number];

const PLAN_LABELS: Record<PlanType, string> = {
  house_purchase: "House purchase",
  property_sale: "Property sale",
  job_exit: "Work change",
  pension_withdrawal: "Pension withdrawal",
  rental_start: "Rental start",
  inheritance: "Inheritance",
};

export function planLabel(type: string): string {
  return PLAN_LABELS[type as PlanType] ?? type;
}

// Any planned-event date on or after this reads as "timing unknown".
export const PLAN_TIMING_UNKNOWN_FROM = "2049-01-01";

// The concrete sentinels written when "timing unknown" / "amount TBD" is
// ticked, so nobody has to remember a magic value.
export const PLAN_TIMING_UNKNOWN_DATE = "2050-01-01";
export const PLAN_AMOUNT_TBD = "0";

export function isTimingUnknown(date: string): boolean {
  return date >= PLAN_TIMING_UNKNOWN_FROM;
}

export function isAmountTBD(amount: string | number): boolean {
  return Number(amount) === 0;
}
