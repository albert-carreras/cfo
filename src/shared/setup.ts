import { z } from "zod";
import { dec } from "@/calc/money";
import {
  decimalString,
  isoDate,
  nonNegativeDecimalString,
} from "./validation";

// The /setup wizard's input contract — pure and client-importable, so the
// wizard validates live with the exact schema the server commits with.
// Cross-references between steps travel as array indices; ids are minted
// server-side at commit (src/server/setup.ts).

export const ACCOUNT_TYPES = ["bank", "broker", "pension", "manual"] as const;
export const PLANNED_EVENT_TYPES = [
  "house_purchase",
  "property_sale",
  "job_exit",
  "pension_withdrawal",
  "rental_start",
  "inheritance",
] as const;

export const percentString = nonNegativeDecimalString.refine(
  (v) => dec(v).greaterThan(0) && dec(v).lessThanOrEqualTo(100),
  "must be between 0 (exclusive) and 100",
);

export const probabilityString = nonNegativeDecimalString.refine(
  (v) => dec(v).lessThanOrEqualTo(1),
  "must be between 0 and 1",
);

export const setupAccountSchema = z.object({
  type: z.enum(ACCOUNT_TYPES),
  name: z.string().trim().min(1),
  // Cash is EUR-only for now: net worth treats account cash as EUR directly.
  // Non-EUR cash needs an FX-aware valuation path before it can be accepted.
  currency: z.literal("EUR").default("EUR"),
  openingCash: nonNegativeDecimalString,
  openingAsOf: isoDate.nullish(),
});

export const setupLotSchema = z.object({
  buyDate: isoDate,
  quantity: decimalString,
  price: nonNegativeDecimalString,
  fees: nonNegativeDecimalString.default("0"),
  fxRate: decimalString.default("1"),
});

export const setupHoldingSchema = z.object({
  accountIndex: z.number().int().nonnegative(),
  isin: z.string().trim().min(1),
  ticker: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1),
  currency: z.string().trim().min(1).default("EUR"),
  openingQuantity: nonNegativeDecimalString,
  openingAsOf: isoDate.nullish(),
  // No ticker ⇒ the daily feed cannot price it. That is allowed, but only as
  // an explicit choice — data_quality then reports the missing price honestly.
  acknowledgeUnpriced: z.boolean().default(false),
  lots: z.array(setupLotSchema).default([]),
});

export const setupPropertySchema = z.object({
  name: z.string().trim().min(1),
  value: decimalString,
  purchasePrice: nonNegativeDecimalString.nullish(),
  ownershipPct: percentString.default("100"),
  rentMonthly: nonNegativeDecimalString.default("0"),
  costsMonthly: nonNegativeDecimalString.default("0"),
  isPrimaryResidence: z.boolean().default(false),
  valuedAt: isoDate,
});

export const setupLiabilitySchema = z.object({
  propertyIndex: z.number().int().nonnegative().nullish(),
  rate: nonNegativeDecimalString.nullish(),
  balance: decimalString,
  payment: nonNegativeDecimalString.nullish(),
});

export const setupAssumptionSchema = z
  .object({
    key: z.string().trim().min(1),
    value: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, "must be a decimal number")
      .nullish(),
    dateValue: isoDate.nullish(),
    source: z.string().trim().min(1).default("user (initial setup)"),
  })
  .superRefine((input, context) => {
    if ((input.value == null) === (input.dateValue == null)) {
      context.addIssue({
        code: "custom",
        message: "exactly one of value or dateValue must be set",
      });
    }
  });

export const setupPlannedEventSchema = z.object({
  type: z.enum(PLANNED_EVENT_TYPES),
  date: isoDate,
  amount: nonNegativeDecimalString,
  probability: probabilityString.default("1"),
  includedInBaseCase: z.boolean().default(false),
  note: z.string().nullish(),
});

// Key-specific sanity ranges for the assumptions the calculators consume.
// Coarse by design — these reject typos (a 35% SWR), not opinions.
export const ASSUMPTION_RANGES: Record<string, { min: string; max: string }> = {
  safeWithdrawalRate: { min: "0", max: "0.2" },
  expectedReturn: { min: "-0.5", max: "0.5" },
  inflation: { min: "-0.1", max: "0.3" },
  longRunInflation: { min: "-0.1", max: "0.3" },
  interestRate: { min: "-0.1", max: "0.3" },
  monthlySpend: { min: "0", max: "1000000" },
  monthlySpendConservative: { min: "0", max: "1000000" },
  monthlySpendOptimistic: { min: "0", max: "1000000" },
  lossCarryForward: { min: "0", max: "1000000000" },
  familyMinimum: { min: "0", max: "100000" },
};

export const REQUIRED_ASSUMPTION_KEYS = [
  "monthlySpend",
  "safeWithdrawalRate",
] as const;

export const setupInputSchema = z
  .object({
    baselineAsOf: isoDate,
    accounts: z.array(setupAccountSchema).min(1, "at least one account"),
    holdings: z.array(setupHoldingSchema).default([]),
    properties: z.array(setupPropertySchema).default([]),
    liabilities: z.array(setupLiabilitySchema).default([]),
    assumptions: z.array(setupAssumptionSchema).default([]),
    plannedEvents: z.array(setupPlannedEventSchema).default([]),
  })
  .superRefine((input, context) => {
    for (const [i, holding] of input.holdings.entries()) {
      const account = input.accounts[holding.accountIndex];
      if (!account) {
        context.addIssue({
          code: "custom",
          path: ["holdings", i],
          message: "holding references a missing account",
        });
      }
      if (
        !holding.ticker &&
        !holding.acknowledgeUnpriced &&
        dec(holding.openingQuantity).greaterThan(0)
      ) {
        context.addIssue({
          code: "custom",
          path: ["holdings", i],
          message:
            "a held position needs a feed ticker, or an explicit acknowledgement that it will be unpriced",
        });
      }
    }
    for (const [i, liability] of input.liabilities.entries()) {
      if (
        liability.propertyIndex != null &&
        !input.properties[liability.propertyIndex]
      ) {
        context.addIssue({
          code: "custom",
          path: ["liabilities", i],
          message: "mortgage references a missing property",
        });
      }
    }
    const keys = new Set(input.assumptions.map((a) => a.key));
    if (keys.size !== input.assumptions.length) {
      context.addIssue({ code: "custom", message: "duplicate assumption keys" });
    }
    for (const required of REQUIRED_ASSUMPTION_KEYS) {
      if (!keys.has(required)) {
        context.addIssue({
          code: "custom",
          message: `the ${required} assumption is required — without it the first snapshot is born Data stale`,
        });
      }
    }
    for (const [i, assumption] of input.assumptions.entries()) {
      const range = ASSUMPTION_RANGES[assumption.key];
      if (range && assumption.value != null) {
        const v = dec(assumption.value);
        if (v.lessThanOrEqualTo(range.min) || v.greaterThan(range.max)) {
          context.addIssue({
            code: "custom",
            path: ["assumptions", i],
            message: `${assumption.key} must be in (${range.min}, ${range.max}]`,
          });
        }
      }
    }
  });

export type SetupInput = z.infer<typeof setupInputSchema>;

// Pure date sanity against the commit-time clock (the schema stays clock-free).
export function validateSetupDates(input: SetupInput, today: string): string[] {
  const errors: string[] = [];
  if (input.baselineAsOf > today) errors.push("baseline date is in the future");
  for (const account of input.accounts) {
    if ((account.openingAsOf ?? input.baselineAsOf) > today) {
      errors.push(`account "${account.name}" opens in the future`);
    }
  }
  for (const holding of input.holdings) {
    const openingAsOf = holding.openingAsOf ?? input.baselineAsOf;
    if (openingAsOf > today) {
      errors.push(`holding "${holding.name}" opens in the future`);
    }
    for (const lot of holding.lots) {
      if (lot.buyDate > openingAsOf) {
        errors.push(
          `holding "${holding.name}" has a lot bought after its opening baseline — open lots are the purchases you still held at the baseline`,
        );
      }
    }
  }
  for (const property of input.properties) {
    if (property.valuedAt > today) {
      errors.push(`property "${property.name}" is valued in the future`);
    }
  }
  for (const assumption of input.assumptions) {
    if (assumption.key === "birthDate" && assumption.dateValue != null) {
      if (assumption.dateValue >= today || assumption.dateValue < "1900-01-01") {
        errors.push("birthDate must be a past date");
      }
    }
  }
  return errors;
}

// Soft (non-blocking) review-screen notes: things worth a second look that the
// data model deliberately allows — surfaced before commit, never refused.
export function setupWarnings(input: SetupInput): string[] {
  const warnings: string[] = [];
  for (const holding of input.holdings) {
    if (holding.lots.length === 0) {
      if (dec(holding.openingQuantity).greaterThan(0)) {
        warnings.push(
          `"${holding.name}" has no open lots — without them a future sale has no FIFO cost basis`,
        );
      }
      continue;
    }
    const lotSum = holding.lots.reduce(
      (sum, lot) => sum.plus(lot.quantity),
      dec("0"),
    );
    if (!lotSum.equals(holding.openingQuantity)) {
      warnings.push(
        `"${holding.name}" lots sum to ${lotSum.toString()} but the opening quantity is ${holding.openingQuantity}`,
      );
    }
  }
  return warnings;
}
