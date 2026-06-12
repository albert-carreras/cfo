import { dec, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";

// Buckets net worth by account type + property equity. Pure.
//   liquid     = bank + manual cash
//   investable = broker cash + broker holdings
//   locked     = pension cash + pension holdings (not counted in base FIRE)
//   illiquid   = property equity (value × ownership − mortgage balance)
//   fireCounted= liquid + investable (excludes locked + any inflow not in the
//                base case — e.g. an inheritance is never in base FIRE)

export type AccountType = "bank" | "broker" | "pension" | "manual";

export type NwAccount = { id: string; type: AccountType };
export type NwHoldingValue = {
  holdingId: string;
  accountId: string;
  valueEUR: Money;
  inputs?: string[];
};
export type NwProperty = { id: string; value: Money; ownershipPct: Money };
export type NwLiability = { id: string; propertyId: string | null; balance: Money };

export type NetWorthValue = {
  liquidEUR: Money;
  investableEUR: Money;
  lockedEUR: Money;
  illiquidEUR: Money;
  totalEUR: Money;
  fireCountedEUR: Money;
  propertyEquity: { propertyId: string; equityEUR: Money }[];
};

export function netWorth(args: {
  snapshotId: string;
  accounts: NwAccount[];
  cashByAccount: Record<string, Money>;
  cashInputsByAccount?: Record<string, string[]>;
  holdingValues: NwHoldingValue[];
  properties: NwProperty[];
  liabilities: NwLiability[];
}): CalcResult<NetWorthValue> {
  const {
    snapshotId,
    accounts,
    cashByAccount,
    cashInputsByAccount = {},
    holdingValues,
    properties,
    liabilities,
  } = args;

  const typeById = new Map(accounts.map((a) => [a.id, a.type]));
  const inputs = new Set<string>();

  let liquid = dec(0);
  let investable = dec(0);
  let locked = dec(0);

  for (const a of accounts) {
    for (const id of cashInputsByAccount[a.id] ?? [a.id]) inputs.add(id);
    const cash = dec(cashByAccount[a.id] ?? 0);
    if (a.type === "bank" || a.type === "manual") liquid = liquid.plus(cash);
    else if (a.type === "broker") investable = investable.plus(cash);
    else if (a.type === "pension") locked = locked.plus(cash);
  }

  for (const hv of holdingValues) {
    for (const id of hv.inputs ?? [hv.holdingId]) inputs.add(id);
    const type = typeById.get(hv.accountId);
    const value = dec(hv.valueEUR);
    if (type === "pension") locked = locked.plus(value);
    else investable = investable.plus(value); // broker (or any non-pension) holdings
  }

  // Mortgage balances by the property they encumber.
  const debtByProperty = new Map<string, ReturnType<typeof dec>>();
  for (const l of liabilities) {
    if (!l.propertyId) continue;
    inputs.add(l.id);
    debtByProperty.set(
      l.propertyId,
      (debtByProperty.get(l.propertyId) ?? dec(0)).plus(dec(l.balance)),
    );
  }

  let illiquid = dec(0);
  const propertyEquity = properties.map((p) => {
    inputs.add(p.id);
    const gross = dec(p.value).times(dec(p.ownershipPct)).dividedBy(100);
    const equity = gross.minus(debtByProperty.get(p.id) ?? dec(0));
    illiquid = illiquid.plus(equity);
    return { propertyId: p.id, equityEUR: equity.toFixed(2) };
  });

  const total = liquid.plus(investable).plus(locked).plus(illiquid);
  const fireCounted = liquid.plus(investable);

  return {
    snapshotId,
    value: {
      liquidEUR: liquid.toFixed(2),
      investableEUR: investable.toFixed(2),
      lockedEUR: locked.toFixed(2),
      illiquidEUR: illiquid.toFixed(2),
      totalEUR: total.toFixed(2),
      fireCountedEUR: fireCounted.toFixed(2),
      propertyEquity,
    },
    source: VERSIONS.netWorth.source,
    version: VERSIONS.netWorth.version,
    inputs: [...inputs],
  };
}
