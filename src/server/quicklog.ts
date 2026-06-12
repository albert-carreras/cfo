import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { computeSnapshot } from "@/calc/snapshot";
import { deriveState } from "@/calc/derive";
import { dec } from "@/calc/money";
import { db } from "./db";
import {
  accounts,
  holdings,
  monthlySpend,
  movements,
  revaluations,
} from "./db/schema";
import { loadFacts } from "./facts";
import {
  isReviewDue,
  latestStrategicSnapshot,
  persistSnapshot,
} from "./snapshots";
import { runPicture } from "./picture";
import { MOVEMENT_TYPES } from "@/shared/quicklog";
import {
  decimalString,
  isoDate,
  monthString,
  nonNegativeDecimalString,
} from "@/shared/validation";

export { MOVEMENT_TYPES } from "@/shared/quicklog";

// The single write path into the ledger. Each intent has a transaction-scoped
// primitive (validate + append, no recompute) and a thin public wrapper that
// runs it in its own transaction and promotes one snapshot. Compound flows
// (realise a planned event, dispose a property) compose the primitives inside
// ONE transaction with ONE final recomputeAndPromote, so a snapshot can never
// capture a half-applied state.

export const movementInputSchema = z
  .object({
    type: z.enum(MOVEMENT_TYPES),
    accountId: z.string().min(1),
    holdingId: z.string().min(1).nullish(),
    quantity: decimalString.nullish(),
    amount: decimalString,
    currency: z.literal("EUR").default("EUR"),
    occurredAt: isoDate,
    note: z.string().nullish(),
    correctsId: z.string().min(1).nullish(),
  })
  .superRefine((value, context) => {
    const tradesHolding = value.type === "buy" || value.type === "sell";
    if (tradesHolding && (!value.holdingId || !value.quantity)) {
      context.addIssue({
        code: "custom",
        message: "buy/sell movements need a holdingId and a positive quantity",
      });
    }
    if (!tradesHolding && (value.holdingId || value.quantity)) {
      context.addIssue({
        code: "custom",
        message: "only buy/sell movements may include a holdingId or quantity",
      });
    }
  });

export type MovementInput = z.infer<typeof movementInputSchema>;

export const monthlySpendInputSchema = z.object({
  month: monthString,
  amount: decimalString,
  note: z.string().nullish(),
});

export type MonthlySpendInput = z.infer<typeof monthlySpendInputSchema>;

// Own-account transfer: ONE intent that writes BOTH legs — withdraw
// on the source, transfer on the destination — atomically in one transaction,
// so a transfer can never create or destroy money via a missing leg.
export const transferInputSchema = z
  .object({
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amount: decimalString,
    occurredAt: isoDate,
    note: z.string().nullish(),
  })
  .superRefine((value, context) => {
    if (value.fromAccountId === value.toAccountId) {
      context.addIssue({
        code: "custom",
        message: "a transfer needs two different accounts",
      });
    }
  });

export type TransferInput = z.infer<typeof transferInputSchema>;

// Dated value statement: re-anchors a pension account — value =
// this statement + movements since its date. Append-only, like the ledger.
export const revaluationInputSchema = z.object({
  accountId: z.string().min(1),
  value: nonNegativeDecimalString,
  valuedAt: isoDate,
  note: z.string().nullish(),
});

export type RevaluationInput = z.infer<typeof revaluationInputSchema>;

export class QuickLogInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuickLogInputError";
  }
}

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// Recompute the full snapshot from the transaction's view of the facts and
// promote it as today's strategic snapshot. Every user-intent transaction
// ends with exactly one call to this.
export async function recomputeAndPromote(database: DbTransaction, now: Date) {
  const asOf = utcDate(now);
  const [bundle, previous] = await Promise.all([
    loadFacts(database),
    latestStrategicSnapshot(database),
  ]);
  const snapshot = computeSnapshot({
    snapshotId: createId(),
    asOf,
    reviewDue: isReviewDue(previous?.computedAt ?? null, asOf),
    facts: bundle.facts,
    propertyNameById: bundle.propertyNameById,
    holdingNameById: bundle.holdingNameById,
  });

  await persistSnapshot("strategic", snapshot, {
    computedAt: now,
    dedupeKey: `strategic:${asOf}`,
    database,
  });
  return snapshot;
}

// Every user intent runs in ONE transaction ending in recomputeAndPromote —
// and /picture must follow the promoted snapshot, not just the daily feed.
// This wraps the intent transaction and refreshes the picture AFTER commit
// (runPicture reads committed rows). It never throws: the picture is a
// narrative about the facts, never a reason a logged fact fails. Its own
// material-change/month-roll gate bounds provider calls, so routine logs
// skip the model and a pile-moving one refreshes the story immediately.
export async function intentTransaction<T>(
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  const result = await db.transaction(fn);
  try {
    await runPicture({ force: false });
  } catch {
    // never block the intent on the narrative
  }
  return result;
}

// Transaction-scoped primitive: validates and appends one movement row.
// No recompute — the enclosing transaction owns the single recomputeAndPromote.
export async function appendMovementTx(
  tx: DbTransaction,
  value: MovementInput,
  now: Date,
  // Forecast → fact lineage: set only by the realise-planned-event flow.
  options: { plannedEventId?: string } = {},
) {
  const today = utcDate(now);
  if (value.occurredAt > today) {
    throw new QuickLogInputError("movement date cannot be in the future");
  }

  const [account] = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.id, value.accountId))
    .limit(1);
  if (!account || account.disposedAt) {
    throw new QuickLogInputError("account does not exist or is closed");
  }
  if (value.occurredAt < account.openingAsOf) {
    throw new QuickLogInputError(
      "movement date cannot precede the account opening baseline",
    );
  }

  if (value.correctsId) {
    const [[target], [existingCorrection]] = await Promise.all([
      tx
        .select({ id: movements.id })
        .from(movements)
        .where(eq(movements.id, value.correctsId))
        .limit(1),
      tx
        .select({ id: movements.id })
        .from(movements)
        .where(eq(movements.correctsId, value.correctsId))
        .limit(1),
    ]);
    if (!target) {
      throw new QuickLogInputError("corrected movement does not exist");
    }
    if (existingCorrection) {
      throw new QuickLogInputError("movement has already been corrected");
    }
  }

  if (value.holdingId) {
    const [holding] = await tx
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.id, value.holdingId),
          eq(holdings.accountId, value.accountId),
        ),
      )
      .limit(1);
    if (!holding || holding.disposedAt) {
      throw new QuickLogInputError(
        "holding does not exist, is closed, or belongs to another account",
      );
    }
    if (value.occurredAt < holding.openingAsOf) {
      throw new QuickLogInputError(
        "movement date cannot precede the holding opening baseline",
      );
    }
  }

  const [row] = await tx
    .insert(movements)
    .values({
      type: value.type,
      accountId: value.accountId,
      holdingId: value.holdingId ?? null,
      quantity: value.quantity ?? null,
      amount: value.amount,
      currency: "EUR",
      occurredAt: value.occurredAt,
      note: value.note ?? null,
      correctsId: value.correctsId ?? null,
      plannedEventId: options.plannedEventId ?? null,
    })
    .returning();

  const { facts } = await loadFacts(tx);
  const state = deriveState({
    accounts: facts.accounts,
    holdings: facts.holdings,
    movements: facts.movements,
    asOf: today,
  });
  const negativeHolding = Object.entries(state.quantityByHolding).find(
    ([, quantity]) => dec(quantity).isNegative(),
  );
  if (negativeHolding) {
    throw new QuickLogInputError(
      `movement would make holding ${negativeHolding[0]} negative`,
    );
  }

  return row;
}

// Append-only: every call adds a row. A correction is a new row with correctsId.
export async function appendMovement(input: unknown, now = new Date()) {
  const value = movementInputSchema.parse(input);
  return intentTransaction(async (tx) => {
    const row = await appendMovementTx(tx, value, now);
    await recomputeAndPromote(tx, now);
    return row;
  });
}

// Transaction-scoped primitive: both transfer legs, shared transferGroupId.
export async function appendTransferTx(
  tx: DbTransaction,
  value: TransferInput,
  now: Date,
  // Forecast → fact lineage: set only by the realise-planned-event flow,
  // stamped on BOTH legs.
  options: { plannedEventId?: string } = {},
) {
  const today = utcDate(now);
  if (value.occurredAt > today) {
    throw new QuickLogInputError("transfer date cannot be in the future");
  }

  const rows = await tx
    .select()
    .from(accounts)
    .where(inArray(accounts.id, [value.fromAccountId, value.toAccountId]));
  const from = rows.find((row) => row.id === value.fromAccountId);
  const to = rows.find((row) => row.id === value.toAccountId);
  if (!from || from.disposedAt) {
    throw new QuickLogInputError("source account does not exist or is closed");
  }
  if (!to || to.disposedAt) {
    throw new QuickLogInputError(
      "destination account does not exist or is closed",
    );
  }
  if (value.occurredAt < from.openingAsOf || value.occurredAt < to.openingAsOf) {
    throw new QuickLogInputError(
      "transfer date cannot precede either account's opening baseline",
    );
  }

  const transferGroupId = createId();
  const legs = await tx
    .insert(movements)
    .values([
      {
        type: "withdraw" as const,
        accountId: from.id,
        amount: value.amount,
        currency: "EUR",
        occurredAt: value.occurredAt,
        note: value.note ?? null,
        transferGroupId,
        plannedEventId: options.plannedEventId ?? null,
      },
      {
        type: "transfer" as const,
        accountId: to.id,
        amount: value.amount,
        currency: "EUR",
        occurredAt: value.occurredAt,
        note: value.note ?? null,
        transferGroupId,
        plannedEventId: options.plannedEventId ?? null,
      },
    ])
    .returning();

  return { transferGroupId, legs };
}

// Both legs in ONE transaction with a shared transferGroupId — quick-log can
// no longer produce a one-sided transfer. Negative cash on the source is a
// warn-not-block concern: the snapshot's soft data-quality flag carries it.
export async function appendTransfer(input: unknown, now = new Date()) {
  const value = transferInputSchema.parse(input);
  return intentTransaction(async (tx) => {
    const result = await appendTransferTx(tx, value, now);
    await recomputeAndPromote(tx, now);
    return result;
  });
}

// Transaction-scoped primitive: one pension statement row.
export async function logRevaluationTx(
  tx: DbTransaction,
  value: RevaluationInput,
  now: Date,
) {
  const today = utcDate(now);
  if (value.valuedAt > today) {
    throw new QuickLogInputError("revaluation date cannot be in the future");
  }

  const [account] = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.id, value.accountId))
    .limit(1);
  if (!account || account.disposedAt) {
    throw new QuickLogInputError("account does not exist or is closed");
  }
  if (account.type !== "pension") {
    throw new QuickLogInputError(
      "revaluations are for pension accounts — cash accounts stay derived from the ledger",
    );
  }
  if (value.valuedAt < account.openingAsOf) {
    throw new QuickLogInputError(
      "revaluation date cannot precede the account opening baseline",
    );
  }

  const [row] = await tx
    .insert(revaluations)
    .values({
      assetType: "account" as const,
      assetId: value.accountId,
      value: value.value,
      valuedAt: value.valuedAt,
      note: value.note ?? null,
    })
    .returning();

  return row;
}

// Append-only revaluation entry: pension statements only for now — bank/broker
// cash is exact and must stay derived from the ledger, never re-stated.
export async function logRevaluation(input: unknown, now = new Date()) {
  const value = revaluationInputSchema.parse(input);
  return intentTransaction(async (tx) => {
    const row = await logRevaluationTx(tx, value, now);
    await recomputeAndPromote(tx, now);
    return row;
  });
}

// Transaction-scoped primitive: one monthly-spend calibration row.
export async function logMonthlySpendTx(
  tx: DbTransaction,
  value: MonthlySpendInput,
  now: Date,
) {
  const currentMonth = utcDate(now).slice(0, 7);
  if (value.month > currentMonth) {
    throw new QuickLogInputError(
      "monthly spend cannot be logged for a future month",
    );
  }

  const [row] = await tx
    .insert(monthlySpend)
    .values({
      month: value.month,
      amount: value.amount,
      note: value.note ?? null,
    })
    .returning();
  return row;
}

export async function logMonthlySpend(input: unknown, now = new Date()) {
  const value = monthlySpendInputSchema.parse(input);
  return intentTransaction(async (tx) => {
    const row = await logMonthlySpendTx(tx, value, now);
    await recomputeAndPromote(tx, now);
    return row;
  });
}
