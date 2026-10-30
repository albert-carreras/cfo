import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import { deriveState, type MovementType } from "@/calc/derive";
import { dec, type Money } from "@/calc/money";
import { accounts, holdings, movements, revaluations } from "./db/schema";
import { loadFacts } from "./facts";
import { RecordError, utcDate, type DbTransaction } from "./write";

// Transaction-scoped primitives that append to the record. They validate and
// write; the calling flow owns the single recompute at the end. Movements and
// observations are append-only (enforced by database triggers); a mistake is
// fixed by a newer observation, never by editing a row.

export async function currentState(tx: DbTransaction, asOf: string) {
  const { facts } = await loadFacts(tx, asOf);
  return deriveState({
    accounts: facts.accounts,
    holdings: facts.holdings,
    movements: facts.movements,
    revaluations: facts.revaluations,
    asOf,
  });
}

export async function liveAccount(tx: DbTransaction, id: string) {
  const [row] = await tx.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  if (!row || row.disposedAt) throw new RecordError("That account doesn't exist or is closed.");
  return row;
}

export async function liveHolding(tx: DbTransaction, id: string) {
  const [row] = await tx.select().from(holdings).where(eq(holdings.id, id)).limit(1);
  if (!row || row.disposedAt) {
    throw new RecordError("That investment doesn't exist or is closed.");
  }
  return row;
}

export async function appendMovementTx(
  tx: DbTransaction,
  value: {
    type: MovementType;
    accountId: string;
    holdingId?: string | null;
    quantity?: Money | null;
    amount: Money;
    occurredAt: string;
    note?: string | null;
    transferGroupId?: string | null;
  },
  now: Date,
) {
  if (value.occurredAt > utcDate(now)) {
    throw new RecordError("The date can't be in the future.");
  }
  if (!dec(value.amount).greaterThan(0)) {
    throw new RecordError("The amount must be more than zero.");
  }
  const account = await liveAccount(tx, value.accountId);
  if (value.occurredAt < account.openingAsOf) {
    throw new RecordError(
      `${account.name} was added to the record on ${account.openingAsOf} with its balance at that date, so anything earlier is already included. Use a later date.`,
    );
  }
  if (value.holdingId) {
    const [holding] = await tx
      .select()
      .from(holdings)
      .where(and(eq(holdings.id, value.holdingId), eq(holdings.accountId, value.accountId)))
      .limit(1);
    if (!holding || holding.disposedAt) {
      throw new RecordError("That investment doesn't exist in this account.");
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
      transferGroupId: value.transferGroupId ?? null,
    })
    .returning();

  const state = await currentState(tx, utcDate(now));
  const negative = Object.entries(state.quantityByHolding).find(([, quantity]) =>
    dec(quantity).isNegative(),
  );
  if (negative) throw new RecordError("That would leave an investment with negative units.");
  return row;
}

// Both legs of an own-account transfer, written together with a shared group
// id, so a transfer can never create or destroy money.
export async function appendTransferTx(
  tx: DbTransaction,
  value: {
    fromAccountId: string;
    toAccountId: string;
    amount: Money;
    occurredAt: string;
    note?: string | null;
  },
  now: Date,
) {
  if (value.fromAccountId === value.toAccountId) {
    throw new RecordError("Pick two different accounts.");
  }
  const rows = await tx
    .select()
    .from(accounts)
    .where(inArray(accounts.id, [value.fromAccountId, value.toAccountId]));
  if (rows.length !== 2 || rows.some((row) => row.disposedAt)) {
    throw new RecordError("Both accounts must exist and be open.");
  }
  const transferGroupId = createId();
  const out = await appendMovementTx(
    tx,
    {
      type: "withdraw",
      accountId: value.fromAccountId,
      amount: value.amount,
      occurredAt: value.occurredAt,
      note: value.note,
      transferGroupId,
    },
    now,
  );
  const into = await appendMovementTx(
    tx,
    {
      type: "transfer",
      accountId: value.toAccountId,
      amount: value.amount,
      occurredAt: value.occurredAt,
      note: value.note,
      transferGroupId,
    },
    now,
  );
  return [out, into];
}

export type ObservationType = "account" | "holding" | "property" | "liability" | "other_asset";

export async function appendObservationTx(
  tx: DbTransaction,
  value: {
    assetType: ObservationType;
    assetId: string;
    value: Money;
    valuedAt: string;
    note?: string | null;
  },
  now: Date,
) {
  if (value.valuedAt > utcDate(now)) {
    throw new RecordError("The date can't be in the future.");
  }
  if (dec(value.value).isNegative()) {
    throw new RecordError("Values can't be negative.");
  }
  const [row] = await tx
    .insert(revaluations)
    .values({
      assetType: value.assetType,
      assetId: value.assetId,
      value: dec(value.value).toString(),
      valuedAt: value.valuedAt,
      note: value.note ?? null,
    })
    .returning();
  return row;
}
