import Decimal from "decimal.js";
import { dec, type Money } from "./money";
import { effectiveMovements } from "./movements";

// The load-bearing projection: current state is DERIVED, never stored.
//   current cash/position = a dated opening baseline + every movement since.
// Pure: no I/O, no clock — `asOf` is passed in. Returns the derived state plus
// the ids of every row it consumed (provenance).

export type MovementType =
  | "deposit"
  | "withdraw"
  | "buy"
  | "sell"
  | "transfer"
  | "dividend"
  | "fee"
  | "expense";

// Effect of each movement type on the account's cash. `transfer` is the
// incoming destination leg; an own-account transfer uses `withdraw` on the
// source account plus `transfer` on the destination account.
const CASH_SIGN: Record<MovementType, number> = {
  deposit: 1,
  withdraw: -1,
  dividend: 1,
  fee: -1,
  expense: -1,
  buy: -1,
  sell: 1,
  transfer: 1,
};

export type DeriveAccount = {
  id: string;
  openingCash: Money;
  openingAsOf: string; // YYYY-MM-DD
};

// A dated value statement (e.g. a pension statement): the account's
// cash re-anchors to `value` at `valuedAt`, and only movements since that date
// apply — the opening-baseline rule, re-applied at a later date. Append-only:
// a re-statement is a NEW row, the newest effective one winning.
export type DeriveRevaluation = {
  id: string;
  accountId: string;
  value: Money;
  valuedAt: string; // YYYY-MM-DD
  createdAt: string; // ISO timestamp — tie-break for same-day re-statements
};

export type DeriveHolding = {
  id: string;
  accountId: string;
  openingQuantity: Money;
  openingAsOf: string;
};

export type DeriveMovement = {
  id: string;
  type: MovementType;
  accountId: string;
  holdingId: string | null;
  quantity: Money | null;
  amount: Money;
  occurredAt: string;
  correctsId: string | null;
};

export type DerivedState = {
  asOf: string;
  cashByAccount: Record<string, Money>; // accountId -> cash (cents-rounded)
  quantityByHolding: Record<string, Money>; // holdingId -> quantity (full precision)
  cashInputsByAccount: Record<string, string[]>;
  quantityInputsByHolding: Record<string, string[]>;
  inputs: string[]; // accounts + holdings + movements consumed (provenance)
};

// The newest statement effective by `asOf` (latest valuedAt; createdAt then id
// break ties), provided it postdates the opening baseline — an older statement
// is already superseded by the baseline itself.
function latestRevaluation(
  rows: DeriveRevaluation[],
  account: DeriveAccount,
  asOf: string,
): DeriveRevaluation | null {
  let latest: DeriveRevaluation | null = null;
  for (const row of rows) {
    if (row.accountId !== account.id) continue;
    if (row.valuedAt > asOf || row.valuedAt < account.openingAsOf) continue;
    if (
      !latest ||
      row.valuedAt > latest.valuedAt ||
      (row.valuedAt === latest.valuedAt &&
        (row.createdAt > latest.createdAt ||
          (row.createdAt === latest.createdAt && row.id > latest.id)))
    ) {
      latest = row;
    }
  }
  return latest;
}

export function deriveState(args: {
  accounts: DeriveAccount[];
  holdings: DeriveHolding[];
  movements: DeriveMovement[];
  revaluations?: DeriveRevaluation[];
  asOf: string;
}): DerivedState {
  const { accounts, holdings, movements, revaluations = [], asOf } = args;

  const cash = new Map<string, Decimal>();
  const qty = new Map<string, Decimal>();
  const openingByAccount = new Map<string, string>();
  const openingByHolding = new Map<string, string>();
  const cashInputs = new Map<string, string[]>();
  const quantityInputs = new Map<string, string[]>();
  const inputs: string[] = [];

  for (const a of accounts) {
    // Re-anchor: the latest dated value statement replaces the
    // opening baseline — the statement value already includes every movement
    // up to its date, so only movements since then apply.
    const reval = latestRevaluation(revaluations, a, asOf);
    cash.set(a.id, dec(reval ? reval.value : a.openingCash));
    openingByAccount.set(a.id, reval ? reval.valuedAt : a.openingAsOf);
    cashInputs.set(a.id, reval ? [a.id, reval.id] : [a.id]);
    inputs.push(a.id);
    if (reval) inputs.push(reval.id);
  }
  for (const h of holdings) {
    qty.set(h.id, dec(h.openingQuantity));
    openingByHolding.set(h.id, h.openingAsOf);
    quantityInputs.set(h.id, [h.id]);
    inputs.push(h.id);
  }

  const applicable = effectiveMovements(movements, asOf);

  for (const m of applicable) {
    const accountCash = cash.get(m.accountId);
    const accountOpening = openingByAccount.get(m.accountId);
    if (accountCash && (!accountOpening || m.occurredAt >= accountOpening)) {
      cash.set(m.accountId, accountCash.plus(dec(m.amount).times(CASH_SIGN[m.type])));
      cashInputs.get(m.accountId)?.push(m.id);
      inputs.push(m.id);
    }

    if (m.holdingId && m.quantity) {
      const holdingQty = qty.get(m.holdingId);
      const holdingOpening = openingByHolding.get(m.holdingId);
      const sign = m.type === "buy" ? 1 : m.type === "sell" ? -1 : 0;
      if (
        holdingQty &&
        sign !== 0 &&
        (!holdingOpening || m.occurredAt >= holdingOpening)
      ) {
        qty.set(m.holdingId, holdingQty.plus(dec(m.quantity).times(sign)));
        quantityInputs.get(m.holdingId)?.push(m.id);
        if (!inputs.includes(m.id)) inputs.push(m.id);
      }
    }
  }

  return {
    asOf,
    cashByAccount: Object.fromEntries(
      [...cash].map(([k, v]) => [k, v.toFixed(2)]),
    ),
    quantityByHolding: Object.fromEntries(
      [...qty].map(([k, v]) => [k, v.toString()]),
    ),
    cashInputsByAccount: Object.fromEntries(cashInputs),
    quantityInputsByHolding: Object.fromEntries(quantityInputs),
    inputs,
  };
}
