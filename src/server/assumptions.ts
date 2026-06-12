import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { assumptions } from "./db/schema";
import type { DbTransaction } from "./quicklog";
import { isoDate } from "@/shared/validation";

// The non-destructive assumption entry path for a live database. Assumptions
// are the one deliberately mutable fact kind: an upsert replaces the previous
// value (no history yet — see data-model.md's planned audit_log). Setting one
// refreshes lastReviewedAt, which is what data_quality's annual cadence reads.

const numberString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a decimal number");

export const assumptionInputSchema = z
  .object({
    key: z.string().min(1),
    value: numberString.nullish(),
    dateValue: isoDate.nullish(),
    conservativeValue: numberString.nullish(),
    optimisticValue: numberString.nullish(),
    source: z.string().min(1).default("user"),
    lastReviewedAt: isoDate.optional(),
  })
  .superRefine((input, context) => {
    if ((input.value == null) === (input.dateValue == null)) {
      context.addIssue({
        code: "custom",
        message: "exactly one of value or dateValue must be set",
      });
    }
    if (input.dateValue != null && (input.conservativeValue != null || input.optimisticValue != null)) {
      context.addIssue({
        code: "custom",
        message: "conservative/optimistic variants apply to numeric assumptions only",
      });
    }
  });

export type AssumptionInput = z.infer<typeof assumptionInputSchema>;

// Pure: the insert row and the on-conflict update set for one parsed input.
// On update, an omitted conservative/optimistic variant is preserved, not
// nulled — re-setting monthlySpend must not wipe its variants.
export function buildAssumptionUpsert(parsed: AssumptionInput, now: Date) {
  const values = {
    key: parsed.key,
    value: parsed.value ?? null,
    dateValue: parsed.dateValue ?? null,
    conservativeValue: parsed.conservativeValue ?? null,
    optimisticValue: parsed.optimisticValue ?? null,
    source: parsed.source,
    lastReviewedAt: parsed.lastReviewedAt ?? now.toISOString().slice(0, 10),
  };
  const set: Partial<typeof values> = { ...values };
  if (parsed.conservativeValue == null) delete set.conservativeValue;
  if (parsed.optimisticValue == null) delete set.optimisticValue;
  return { values, set };
}

export async function setAssumption(
  input: unknown,
  options: { database?: DbTransaction | typeof db; now?: Date } = {},
) {
  const parsed = assumptionInputSchema.parse(input);
  const database = options.database ?? db;
  const now = options.now ?? new Date();
  const { values, set } = buildAssumptionUpsert(parsed, now);
  const [row] = await database
    .insert(assumptions)
    .values(values)
    .onConflictDoUpdate({
      target: assumptions.key,
      set: { ...set, updatedAt: sql`now()` },
    })
    .returning();
  return row;
}
