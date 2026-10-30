import {
  deriveState,
  type DeriveMovement,
  type DeriveRevaluation,
} from "./derive";
import { valuation, type ValuationValue } from "./valuation";
import { netWorth, type AccountType, type NetWorthValue } from "./netWorth";
import { fire, type FireValue } from "./fire";
import {
  taxSummary,
  type Sale,
  type TaxLot,
  type TaxSettlement,
  type TaxValue,
} from "./tax";
import {
  attention,
  type AttentionValue,
  type ConfirmedValue,
} from "./attention";
import type { CalcResult } from "./types";
import { dec, type Money } from "./money";
import { isTimingUnknown, planLabel } from "@/shared/plans";

// The whole trust core in one call: today's position from the verified facts.
// Plans are context only and never move a number.

export type SnapshotFacts = {
  accounts: {
    id: string;
    type: AccountType;
    openingCash: Money;
    openingAsOf: string;
    name?: string;
  }[];
  holdings: {
    id: string;
    accountId: string;
    isin: string;
    openingQuantity: Money;
    openingAsOf: string;
    name?: string;
  }[];
  movements: DeriveMovement[];
  revaluations?: DeriveRevaluation[];
  properties: {
    id: string;
    value: Money;
    ownershipPct: Money;
    valuedAt: string;
    rentMonthly: Money;
    costsMonthly: Money;
    isPrimaryResidence: boolean;
    purchasePrice?: Money | null;
    inputId?: string;
    name?: string;
  }[];
  otherAssets?: {
    id: string;
    value: Money;
    includeInNetWorth: boolean;
    valuedAt: string;
    inputId?: string;
    name?: string;
  }[];
  liabilities: {
    id: string;
    propertyId: string | null;
    balance: Money;
    valuedAt?: string;
    inputId?: string;
    name?: string;
  }[];
  assumptions: { id: string; key: string; value: Money; lastReviewedAt: string }[];
  prices: { id: string; isin: string; price: Money; currency: string; asOf: string }[];
  fx: { id: string; quote: string; rate: Money; asOf: string }[];
  taxLots?: TaxLot[];
  sales?: Sale[];
  taxSettlements?: TaxSettlement[];
  plannedEvents?: {
    id: string;
    type: string;
    date: string;
    amount: Money;
    realisedAt?: string | null;
  }[];
  // Legacy monthly spend log: retained in the record, read by nothing.
  monthlySpend?: { id: string; month: string; amount: Money; createdAt: string }[];
};

export type StrategicSnapshot = {
  snapshotId: string;
  asOf: string;
  valuation: CalcResult<ValuationValue>;
  netWorth: CalcResult<NetWorthValue>;
  fire: CalcResult<FireValue>;
  tax: CalcResult<TaxValue>;
  attention: CalcResult<AttentionValue>;
};

function latestObservationDate(
  rows: DeriveRevaluation[],
  key: "accountId" | "holdingId",
  id: string,
  fallback: string,
  asOf: string,
): string {
  return rows
    .filter((row) => row[key] === id && row.valuedAt <= asOf && row.valuedAt >= fallback)
    .map((row) => row.valuedAt)
    .sort()
    .at(-1) ?? fallback;
}

export function computeSnapshot(args: {
  snapshotId: string;
  asOf: string;
  facts: SnapshotFacts;
}): StrategicSnapshot {
  const { snapshotId, asOf, facts } = args;
  const observations = facts.revaluations ?? [];

  const derived = deriveState({
    accounts: facts.accounts,
    holdings: facts.holdings,
    movements: facts.movements,
    revaluations: observations,
    asOf,
  });

  const val = valuation({
    snapshotId,
    asOf,
    holdings: facts.holdings,
    quantityByHolding: derived.quantityByHolding,
    quantityInputsByHolding: derived.quantityInputsByHolding,
    prices: facts.prices,
    fx: facts.fx,
  });

  const tax = taxSummary({
    snapshotId,
    asOf,
    sales: facts.sales ?? [],
    settlements: facts.taxSettlements ?? [],
  });

  const accountByHolding = new Map(
    facts.holdings.map((holding) => [holding.id, holding.accountId]),
  );
  const nw = netWorth({
    snapshotId,
    accounts: facts.accounts,
    cashByAccount: derived.cashByAccount,
    cashInputsByAccount: derived.cashInputsByAccount,
    holdingValues: val.value.holdings.map((holding) => ({
      holdingId: holding.holdingId,
      accountId: accountByHolding.get(holding.holdingId) ?? "",
      valueEUR: holding.valueEUR,
      inputs: holding.inputs,
    })),
    properties: facts.properties,
    liabilities: facts.liabilities,
    otherAssets: facts.otherAssets,
    taxDueEUR: tax.value.dueEUR,
    taxInputs: tax.inputs,
  });

  const byKey = (key: string) =>
    facts.assumptions.find((assumption) => assumption.key === key);
  const spend = byKey("monthlySpend");
  const swr = byKey("safeWithdrawalRate");
  const fr = fire({
    snapshotId,
    availableEUR: nw.value.availableEUR,
    monthlySpendEUR: spend?.value ?? null,
    safeWithdrawalRate: swr?.value ?? null,
    inputs: [
      ...nw.inputs,
      ...[spend?.id, swr?.id].filter((id): id is string => Boolean(id)),
    ],
  });

  const values: ConfirmedValue[] = [
    ...facts.accounts.map((account) => ({
      id: account.id,
      kind: account.type === "pension" ? ("pension" as const) : ("cash" as const),
      name: account.name ?? "Account",
      lastConfirmed: latestObservationDate(
        observations,
        "accountId",
        account.id,
        account.openingAsOf,
        asOf,
      ),
    })),
    ...facts.holdings
      .filter((holding) => dec(derived.quantityByHolding[holding.id] ?? 0).greaterThan(0))
      .map((holding) => ({
        id: holding.id,
        kind: "units" as const,
        name: `${holding.name ?? holding.isin} units`,
        lastConfirmed: latestObservationDate(
          observations,
          "holdingId",
          holding.id,
          holding.openingAsOf,
          asOf,
        ),
      })),
    ...facts.properties.map((property) => ({
      id: property.id,
      kind: "property" as const,
      name: property.name ?? "Property",
      lastConfirmed: property.valuedAt,
    })),
    ...facts.liabilities.map((liability) => ({
      id: liability.id,
      kind: "debt" as const,
      name: liability.name ?? "Debt",
      lastConfirmed: liability.valuedAt ?? asOf,
    })),
    ...(facts.otherAssets ?? []).map((asset) => ({
      id: asset.id,
      kind: "otherAsset" as const,
      name: asset.name ?? "Other asset",
      lastConfirmed: asset.valuedAt,
    })),
  ];

  const nameByHolding = new Map(
    facts.holdings.map((holding) => [holding.id, holding.name ?? holding.isin]),
  );
  const att = attention({
    snapshotId,
    asOf,
    values,
    prices: val.value.holdings
      .filter((holding) => dec(holding.quantity).greaterThan(0))
      .map((holding) => ({
        holdingId: holding.holdingId,
        name: nameByHolding.get(holding.holdingId) ?? holding.isin,
        priceAsOf: holding.priced ? holding.valuationAsOf : null,
      })),
    negativeCash: facts.accounts
      .filter((account) => dec(derived.cashByAccount[account.id] ?? 0).isNegative())
      .map((account) => ({ accountId: account.id, name: account.name ?? "Account" })),
    tax: tax.value,
    plans: (facts.plannedEvents ?? [])
      .filter((plan) => !plan.realisedAt)
      .map((plan) => ({
        id: plan.id,
        label: planLabel(plan.type),
        date: isTimingUnknown(plan.date) ? null : plan.date,
      })),
    monthlySpend: spend ? { lastReviewedAt: spend.lastReviewedAt } : null,
    safeWithdrawalRate: swr ? { lastReviewedAt: swr.lastReviewedAt } : null,
    fire: fr.value,
    inputs: [...new Set([...nw.inputs, ...fr.inputs, ...tax.inputs])],
  });

  return {
    snapshotId,
    asOf,
    valuation: val,
    netWorth: nw,
    fire: fr,
    tax,
    attention: att,
  };
}

// The one-word status stored with each snapshot row.
export function snapshotStatus(snapshot: StrategicSnapshot): "ok" | "attention" {
  return snapshot.attention.value.items.length === 0 ? "ok" : "attention";
}
