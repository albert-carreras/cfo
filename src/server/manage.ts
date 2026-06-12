import { eq, isNull, and } from "drizzle-orm";
import { z } from "zod";
import { dec, type Money } from "@/calc/money";
import { deriveState } from "@/calc/derive";
import {
  accounts,
  holdings,
  liabilities,
  properties,
  taxLots,
} from "./db/schema";
import { loadFacts } from "./facts";
import {
  appendMovementTx,
  recomputeAndPromote,
  intentTransaction,
  type DbTransaction,
} from "./quicklog";
import {
  setAssumption,
  type AssumptionInput,
} from "./assumptions";
import {
  ASSUMPTION_RANGES,
  setupAccountSchema,
  setupLotSchema,
  setupPropertySchema,
} from "@/shared/setup";
import {
  decimalString,
  isoDate,
  nonNegativeDecimalString,
} from "@/shared/validation";

// /manage — fact maintenance for a live install. Add-later facts (an account
// or holding opened after the baseline carries its own openingAsOf — the
// derive engine already honors per-row baselines), soft-close flows
// (disposedAt only, nothing is ever deleted), and assumption edits. Every
// user intent is one transaction ending in one recomputeAndPromote.

export class ManageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManageInputError";
  }
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// --- Add-later facts -------------------------------------------------------

export const addAccountSchema = setupAccountSchema.extend({
  openingAsOf: isoDate,
});

export async function addAccount(input: unknown, now = new Date()) {
  const value = addAccountSchema.parse(input);
  if (value.openingAsOf > utcDate(now)) {
    throw new ManageInputError("account opening date cannot be in the future");
  }
  return intentTransaction(async (tx) => {
    const [row] = await tx
      .insert(accounts)
      .values({
        type: value.type,
        name: value.name,
        currency: value.currency,
        openingCash: value.openingCash,
        openingAsOf: value.openingAsOf,
      })
      .returning();
    await recomputeAndPromote(tx, now);
    return row;
  });
}

export const addHoldingSchema = z.object({
  accountId: z.string().min(1),
  isin: z.string().trim().min(1),
  ticker: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1),
  currency: z.string().trim().min(1).default("EUR"),
  openingQuantity: nonNegativeDecimalString,
  openingAsOf: isoDate,
  acknowledgeUnpriced: z.boolean().default(false),
  lots: z.array(setupLotSchema).default([]),
});

export async function addHolding(input: unknown, now = new Date()) {
  const value = addHoldingSchema.parse(input);
  if (value.openingAsOf > utcDate(now)) {
    throw new ManageInputError("holding opening date cannot be in the future");
  }
  if (
    !value.ticker &&
    !value.acknowledgeUnpriced &&
    dec(value.openingQuantity).greaterThan(0)
  ) {
    throw new ManageInputError(
      "a held position needs a feed ticker, or an explicit acknowledgement that it will be unpriced",
    );
  }
  for (const lot of value.lots) {
    if (lot.buyDate > value.openingAsOf) {
      throw new ManageInputError(
        "open lots are purchases you already held at the holding's opening date",
      );
    }
  }
  return intentTransaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.id, value.accountId))
      .limit(1);
    if (!account || account.disposedAt) {
      throw new ManageInputError("account does not exist or is closed");
    }
    const [row] = await tx
      .insert(holdings)
      .values({
        accountId: value.accountId,
        isin: value.isin,
        ticker: value.ticker ?? null,
        name: value.name,
        currency: value.currency,
        openingQuantity: value.openingQuantity,
        openingAsOf: value.openingAsOf,
      })
      .returning();
    if (value.lots.length > 0) {
      await tx.insert(taxLots).values(
        value.lots.map((lot) => ({
          holdingId: row.id,
          buyDate: lot.buyDate,
          quantity: lot.quantity,
          price: lot.price,
          fees: lot.fees,
          fxRate: lot.fxRate,
          costBasisEUR: dec(lot.price)
            .times(lot.quantity)
            .times(lot.fxRate)
            .plus(lot.fees)
            .toString(),
        })),
      );
    }
    await recomputeAndPromote(tx, now);
    return row;
  });
}

export const addPropertySchema = setupPropertySchema.extend({
  mortgage: z
    .object({
      rate: nonNegativeDecimalString.nullish(),
      balance: decimalString,
      payment: nonNegativeDecimalString.nullish(),
    })
    .nullish(),
});

export type AddPropertyInput = z.infer<typeof addPropertySchema>;

// Transaction-scoped — reused by the house-purchase realisation flow.
export async function addPropertyTx(
  tx: DbTransaction,
  value: AddPropertyInput,
  now: Date,
) {
  if (value.valuedAt > utcDate(now)) {
    throw new ManageInputError("property valuation date cannot be in the future");
  }
  const [row] = await tx
    .insert(properties)
    .values({
      name: value.name,
      value: value.value,
      purchasePrice: value.purchasePrice ?? null,
      ownershipPct: value.ownershipPct,
      rentMonthly: value.rentMonthly,
      costsMonthly: value.costsMonthly,
      isPrimaryResidence: value.isPrimaryResidence,
      valuedAt: value.valuedAt,
    })
    .returning();
  if (value.mortgage) {
    await tx.insert(liabilities).values({
      type: "mortgage" as const,
      propertyId: row.id,
      rate: value.mortgage.rate ?? null,
      balance: value.mortgage.balance,
      payment: value.mortgage.payment ?? null,
    });
  }
  return row;
}

export async function addProperty(input: unknown, now = new Date()) {
  const value = addPropertySchema.parse(input);
  return intentTransaction(async (tx) => {
    const row = await addPropertyTx(tx, value, now);
    await recomputeAndPromote(tx, now);
    return row;
  });
}

// --- Dispose preconditions (pure, tested) ----------------------------------

// A holding may close only at exactly zero derived quantity — closing it with
// value left would silently delete money from the snapshot.
export function canDisposeHolding(derivedQuantity: Money): boolean {
  return dec(derivedQuantity).isZero();
}

// An account may close only with exactly zero derived cash and no live
// holdings: disposed accounts vanish from loadFacts, so nonzero cash would
// vanish with them and orphaned holdings would lose their account type.
export function canDisposeAccount(
  derivedCash: Money,
  liveHoldingCount: number,
): { ok: boolean; reason: string | null } {
  if (!dec(derivedCash).isZero()) {
    return {
      ok: false,
      reason: `account still holds ${derivedCash} EUR — transfer or withdraw it first`,
    };
  }
  if (liveHoldingCount > 0) {
    return {
      ok: false,
      reason: `account still has ${liveHoldingCount} live holding(s) — sell or dispose them first`,
    };
  }
  return { ok: true, reason: null };
}

// --- Soft-close flows -------------------------------------------------------

export const disposePropertySchema = z.object({
  propertyId: z.string().min(1),
  proceedsAccountId: z.string().min(1),
  amount: decimalString,
  occurredAt: isoDate,
  note: z.string().nullish(),
});

export type DisposePropertyInput = z.infer<typeof disposePropertySchema>;

// Transaction-scoped: deposit the proceeds (an ordinary ledger row, fully
// validated by the movement primitive), then soft-close the property and its
// mortgages. Composable — the realise-planned-event flow reuses it.
export async function disposePropertyTx(
  tx: DbTransaction,
  value: DisposePropertyInput,
  now: Date,
  options: { plannedEventId?: string } = {},
) {
  const [property] = await tx
    .select()
    .from(properties)
    .where(eq(properties.id, value.propertyId))
    .limit(1);
  if (!property || property.disposedAt) {
    throw new ManageInputError("property does not exist or is already disposed");
  }

  const movement = await appendMovementTx(
    tx,
    {
      type: "deposit",
      accountId: value.proceedsAccountId,
      amount: value.amount,
      currency: "EUR",
      occurredAt: value.occurredAt,
      note: value.note ?? `Sale proceeds — ${property.name}`,
    },
    now,
    options,
  );

  await tx
    .update(properties)
    .set({ disposedAt: now })
    .where(eq(properties.id, value.propertyId));
  await tx
    .update(liabilities)
    .set({ disposedAt: now })
    .where(
      and(
        eq(liabilities.propertyId, value.propertyId),
        isNull(liabilities.disposedAt),
      ),
    );

  return { property, movement };
}

export async function disposeProperty(input: unknown, now = new Date()) {
  const value = disposePropertySchema.parse(input);
  return intentTransaction(async (tx) => {
    const result = await disposePropertyTx(tx, value, now);
    await recomputeAndPromote(tx, now);
    return result;
  });
}

export async function disposeHolding(input: unknown, now = new Date()) {
  const value = z.object({ holdingId: z.string().min(1) }).parse(input);
  return intentTransaction(async (tx) => {
    const [holding] = await tx
      .select()
      .from(holdings)
      .where(eq(holdings.id, value.holdingId))
      .limit(1);
    if (!holding || holding.disposedAt) {
      throw new ManageInputError("holding does not exist or is already disposed");
    }
    const { facts } = await loadFacts(tx);
    const state = deriveState({
      accounts: facts.accounts,
      holdings: facts.holdings,
      movements: facts.movements,
      revaluations: facts.revaluations,
      asOf: utcDate(now),
    });
    const quantity = state.quantityByHolding[value.holdingId] ?? "0";
    if (!canDisposeHolding(quantity)) {
      throw new ManageInputError(
        `holding still has quantity ${quantity} — log the sale first`,
      );
    }
    await tx
      .update(holdings)
      .set({ disposedAt: now })
      .where(eq(holdings.id, value.holdingId));
    await recomputeAndPromote(tx, now);
    return holding;
  });
}

export async function disposeAccount(input: unknown, now = new Date()) {
  const value = z.object({ accountId: z.string().min(1) }).parse(input);
  return intentTransaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.id, value.accountId))
      .limit(1);
    if (!account || account.disposedAt) {
      throw new ManageInputError("account does not exist or is already closed");
    }
    const { facts } = await loadFacts(tx);
    const state = deriveState({
      accounts: facts.accounts,
      holdings: facts.holdings,
      movements: facts.movements,
      revaluations: facts.revaluations,
      asOf: utcDate(now),
    });
    const cash = state.cashByAccount[value.accountId] ?? "0";
    const liveHoldings = facts.holdings.filter(
      (h) => h.accountId === value.accountId,
    ).length;
    const check = canDisposeAccount(cash, liveHoldings);
    if (!check.ok) {
      throw new ManageInputError(check.reason ?? "account cannot be closed");
    }
    await tx
      .update(accounts)
      .set({ disposedAt: now })
      .where(eq(accounts.id, value.accountId));
    await recomputeAndPromote(tx, now);
    return account;
  });
}

// --- Assumptions -----------------------------------------------------------

import { EDITABLE_ASSUMPTION_KEYS } from "@/shared/assumptionKeys";
export { EDITABLE_ASSUMPTION_KEYS };

export async function setAssumptionAndRecompute(
  input: AssumptionInput,
  now = new Date(),
) {
  if (
    !(EDITABLE_ASSUMPTION_KEYS as readonly string[]).includes(input.key)
  ) {
    throw new ManageInputError(`assumption key "${input.key}" is not editable here`);
  }
  const range = ASSUMPTION_RANGES[input.key];
  if (range && input.value != null) {
    const v = dec(input.value);
    if (v.lessThanOrEqualTo(range.min) || v.greaterThan(range.max)) {
      throw new ManageInputError(
        `${input.key} must be in (${range.min}, ${range.max}]`,
      );
    }
  }
  return intentTransaction(async (tx) => {
    const row = await setAssumption(input, { database: tx, now });
    await recomputeAndPromote(tx, now);
    return row;
  });
}
