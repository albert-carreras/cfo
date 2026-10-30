import { dec, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";

// Buckets net worth the way a person reads it. Pure.
//   cash        = cash in every non-pension account (bank, savings, broker cash)
//   investments = securities held in non-pension accounts
//   pension     = pension cash + pension securities (locked)
//   property    = owned share of each property − its linked mortgage
//   other       = other assets explicitly included
//   taxDue      = estimated tax on realised gains not yet paid
//   total       = all of the above − general (non-mortgage) debt − taxDue
//   available   = cash + investments − general debt − taxDue: what a
//                 spending plan can actually draw on

export type AccountType = "bank" | "broker" | "pension" | "manual";

export type NwAccount = { id: string; type: AccountType };
export type NwHoldingValue = {
  holdingId: string;
  accountId: string;
  valueEUR: Money;
  inputs?: string[];
};
export type NwProperty = {
  id: string;
  value: Money;
  ownershipPct: Money;
  inputId?: string;
};
export type NwLiability = {
  id: string;
  propertyId: string | null;
  balance: Money;
  inputId?: string;
};
export type NwOtherAsset = {
  id: string;
  value: Money;
  includeInNetWorth: boolean;
  inputId?: string;
};

export type NetWorthValue = {
  cashEUR: Money;
  investmentsEUR: Money;
  pensionEUR: Money;
  propertyEquityEUR: Money;
  otherAssetsEUR: Money;
  debtEUR: Money; // gross: mortgages + general loans
  taxDueEUR: Money;
  totalEUR: Money;
  availableEUR: Money;
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
  otherAssets?: NwOtherAsset[];
  taxDueEUR?: Money;
  taxInputs?: string[];
}): CalcResult<NetWorthValue> {
  const {
    snapshotId,
    accounts,
    cashByAccount,
    cashInputsByAccount = {},
    holdingValues,
    properties,
    liabilities,
    otherAssets = [],
    taxDueEUR = "0",
    taxInputs = [],
  } = args;

  const typeById = new Map(accounts.map((a) => [a.id, a.type]));
  const inputs = new Set<string>(taxInputs);

  let cash = dec(0);
  let investments = dec(0);
  let pension = dec(0);

  for (const a of accounts) {
    for (const id of cashInputsByAccount[a.id] ?? [a.id]) inputs.add(id);
    const balance = dec(cashByAccount[a.id] ?? 0);
    if (a.type === "pension") pension = pension.plus(balance);
    else cash = cash.plus(balance);
  }

  for (const hv of holdingValues) {
    for (const id of hv.inputs ?? [hv.holdingId]) inputs.add(id);
    const value = dec(hv.valueEUR);
    if (typeById.get(hv.accountId) === "pension") pension = pension.plus(value);
    else investments = investments.plus(value);
  }

  // Mortgages reduce their property's equity; general loans come off the
  // total once.
  const debtByProperty = new Map<string, ReturnType<typeof dec>>();
  let generalDebt = dec(0);
  let totalDebt = dec(0);
  for (const l of liabilities) {
    inputs.add(l.inputId ?? l.id);
    totalDebt = totalDebt.plus(dec(l.balance));
    if (l.propertyId) {
      debtByProperty.set(
        l.propertyId,
        (debtByProperty.get(l.propertyId) ?? dec(0)).plus(dec(l.balance)),
      );
    } else {
      generalDebt = generalDebt.plus(dec(l.balance));
    }
  }

  let propertyEquity = dec(0);
  const perProperty = properties.map((p) => {
    inputs.add(p.inputId ?? p.id);
    const share = dec(p.value).times(dec(p.ownershipPct)).dividedBy(100);
    const equity = share.minus(debtByProperty.get(p.id) ?? dec(0));
    propertyEquity = propertyEquity.plus(equity);
    return { propertyId: p.id, equityEUR: equity.toFixed(2) };
  });

  let other = dec(0);
  for (const asset of otherAssets) {
    inputs.add(asset.inputId ?? asset.id);
    if (asset.includeInNetWorth) other = other.plus(dec(asset.value));
  }

  const taxDue = dec(taxDueEUR);
  const total = cash
    .plus(investments)
    .plus(pension)
    .plus(propertyEquity)
    .plus(other)
    .minus(generalDebt)
    .minus(taxDue);
  const available = cash.plus(investments).minus(generalDebt).minus(taxDue);

  return {
    snapshotId,
    value: {
      cashEUR: cash.toFixed(2),
      investmentsEUR: investments.toFixed(2),
      pensionEUR: pension.toFixed(2),
      propertyEquityEUR: propertyEquity.toFixed(2),
      otherAssetsEUR: other.toFixed(2),
      debtEUR: totalDebt.toFixed(2),
      taxDueEUR: taxDue.toFixed(2),
      totalEUR: total.toFixed(2),
      availableEUR: available.toFixed(2),
      propertyEquity: perProperty,
    },
    source: VERSIONS.netWorth.source,
    version: VERSIONS.netWorth.version,
    inputs: [...inputs],
  };
}
