import {
  deriveState,
  type DeriveMovement,
  type DeriveRevaluation,
} from "./derive";
import { valuation, type ValuationValue } from "./valuation";
import { netWorth, type AccountType, type NetWorthValue } from "./netWorth";
import { fire, type FireValue } from "./fire";
import {
  dataQuality,
  type DataQualityValue,
  type FreshnessInput,
  type SoftFlag,
} from "./dataQuality";
import { status, type StatusValue } from "./status";
import { concentration, type ConcentrationValue } from "./concentration";
import type { CalcResult } from "./types";
import { dec, type Money } from "./money";

// The deliberately small trust core. It describes the current position; future
// decisions belong in the exported context pack, not in an in-app scenario
// engine. Legacy movements still replay so existing data remains valid, while
// dated observations can re-anchor account balances and holding quantities.

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
  }[];
  accountOpeningAsOf?: Record<string, string>;
  holdingOpeningAsOf?: Record<string, string>;
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
  }[];
  otherAssets?: {
    id: string;
    value: Money;
    includeInNetWorth: boolean;
    valuedAt: string;
    inputId?: string;
  }[];
  liabilities: {
    id: string;
    propertyId: string | null;
    balance: Money;
    valuedAt?: string;
    inputId?: string;
  }[];
  assumptions: { id: string; key: string; value: Money; lastReviewedAt: string }[];
  prices: { id: string; isin: string; price: Money; currency: string; asOf: string }[];
  fx: { id: string; quote: string; rate: Money; asOf: string }[];
  // Retained as source data for exports and compatibility; the current-state
  // trust core does not require either history.
  monthlySpend: { id: string; month: string; amount: Money; createdAt: string }[];
  taxLots?: {
    id: string;
    holdingId: string;
    buyDate: string;
    quantity: Money;
    costBasisEUR: Money;
  }[];
  plannedEvents?: {
    id: string;
    type: string;
    date: string;
    amount: Money;
    probability: Money;
    includedInBaseCase: boolean;
    realisedAt?: string | null;
  }[];
};

export type StrategicSnapshot = {
  snapshotId: string;
  asOf: string;
  valuation: CalcResult<ValuationValue>;
  netWorth: CalcResult<NetWorthValue>;
  fire: CalcResult<FireValue>;
  dataQuality: CalcResult<DataQualityValue>;
  status: CalcResult<StatusValue>;
  concentration: CalcResult<ConcentrationValue>;
};

function minDate(dates: string[]): string | null {
  return dates.length === 0 ? null : dates.reduce((a, b) => (a < b ? a : b));
}

function latestObservationDate(
  rows: DeriveRevaluation[],
  key: "accountId" | "holdingId",
  id: string,
  fallback: string,
  asOf: string,
): string {
  return rows
    .filter((row) => row[key] === id && row.valuedAt <= asOf)
    .map((row) => row.valuedAt)
    .sort()
    .at(-1) ?? fallback;
}

export function computeSnapshot(args: {
  snapshotId: string;
  asOf: string;
  reviewDue: boolean;
  facts: SnapshotFacts;
  // Kept in the public call shape while old callers are migrated; names are
  // presentation data and no longer feed counterfactual calculators.
  propertyNameById?: Record<string, string>;
  holdingNameById?: Record<string, string>;
  withScenarios?: boolean;
}): StrategicSnapshot {
  const { snapshotId, asOf, reviewDue, facts } = args;
  const observations = facts.revaluations ?? [];

  const derived = deriveState({
    accounts: facts.accounts.map((account) => ({
      id: account.id,
      openingCash: account.openingCash,
      openingAsOf: account.openingAsOf,
    })),
    holdings: facts.holdings.map((holding) => ({
      id: holding.id,
      accountId: holding.accountId,
      openingQuantity: holding.openingQuantity,
      openingAsOf: holding.openingAsOf,
    })),
    movements: facts.movements,
    revaluations: observations,
    asOf,
  });

  const val = valuation({
    snapshotId,
    asOf,
    holdings: facts.holdings.map((holding) => ({
      id: holding.id,
      isin: holding.isin,
    })),
    quantityByHolding: derived.quantityByHolding,
    quantityInputsByHolding: derived.quantityInputsByHolding,
    prices: facts.prices,
    fx: facts.fx,
  });

  const accountByHolding = new Map(
    facts.holdings.map((holding) => [holding.id, holding.accountId]),
  );
  const nw = netWorth({
    snapshotId,
    accounts: facts.accounts.map((account) => ({
      id: account.id,
      type: account.type,
    })),
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
  });

  const byKey = (key: string) =>
    facts.assumptions.find((assumption) => assumption.key === key);
  const spend = byKey("monthlySpend");
  const spendConservative = byKey("monthlySpendConservative");
  const spendOptimistic = byKey("monthlySpendOptimistic");
  const swr = byKey("safeWithdrawalRate");
  const expectedReturn = byKey("expectedReturn");
  const longRunInflation = byKey("longRunInflation");

  const fr = fire({
    snapshotId,
    liquidEUR: nw.value.liquidEUR,
    investableEUR: nw.value.investableEUR,
    fireCountedEUR: nw.value.fireCountedEUR,
    monthlySpendEUR: spend?.value ?? null,
    monthlySpendConservativeEUR: spendConservative?.value ?? null,
    monthlySpendOptimisticEUR: spendOptimistic?.value ?? null,
    safeWithdrawalRate: swr?.value ?? null,
    expectedReturnAnnual: expectedReturn?.value ?? null,
    longRunInflationAnnual: longRunInflation?.value ?? null,
    inputs: [
      ...nw.inputs,
      ...[
        spend?.id,
        spendConservative?.id,
        spendOptimistic?.id,
        swr?.id,
        expectedReturn?.id,
        longRunInflation?.id,
      ].filter((id): id is string => Boolean(id)),
    ],
  });

  const freshness: FreshnessInput[] = [
    {
      id: spend?.id ?? "monthly-spend-assumption",
      sourceIds: spend ? [spend.id] : undefined,
      label: "Monthly spend assumption",
      lastUpdated: spend?.lastReviewedAt ?? null,
      cadence: "annually",
      required: true,
    },
    {
      id: swr?.id ?? "safe-withdrawal-rate",
      sourceIds: swr ? [swr.id] : undefined,
      label: "Safe withdrawal rate",
      lastUpdated: swr?.lastReviewedAt ?? null,
      cadence: "annually",
      required: true,
    },
  ];

  const held = val.value.holdings.filter((holding) =>
    dec(holding.quantity).greaterThan(0),
  );
  if (held.length > 0) {
    const anyUnpriced = held.some(
      (holding) => !holding.priced || holding.valuationAsOf === null,
    );
    freshness.push({
      id: "market-prices",
      sourceIds: held.flatMap((holding) => holding.inputs),
      label: "Market prices",
      lastUpdated: anyUnpriced
        ? null
        : minDate(held.map((holding) => holding.valuationAsOf as string)),
      cadence: "weekly",
      required: true,
    });
  }

  for (const account of facts.accounts) {
    freshness.push({
      id: `account-${account.id}`,
      sourceIds: derived.cashInputsByAccount[account.id],
      label: `${account.name ?? "Account"} balance`,
      lastUpdated: latestObservationDate(
        observations,
        "accountId",
        account.id,
        account.openingAsOf,
        asOf,
      ),
      cadence: "quarterly",
      required: false,
    });
  }

  for (const holding of facts.holdings) {
    freshness.push({
      id: `holding-${holding.id}`,
      sourceIds: derived.quantityInputsByHolding[holding.id],
      label: "Investment quantities",
      lastUpdated: latestObservationDate(
        observations,
        "holdingId",
        holding.id,
        holding.openingAsOf,
        asOf,
      ),
      cadence: "annually",
      required: false,
    });
  }

  if (facts.properties.length > 0) {
    freshness.push({
      id: "property-valuations",
      sourceIds: facts.properties.map((property) => property.inputId ?? property.id),
      label: "Property valuations",
      lastUpdated: minDate(facts.properties.map((property) => property.valuedAt)),
      cadence: "annually",
      required: false,
    });
  }
  if (facts.liabilities.length > 0) {
    freshness.push({
      id: "liability-balances",
      sourceIds: facts.liabilities.map((liability) => liability.inputId ?? liability.id),
      label: "Debt balances",
      lastUpdated: minDate(
        facts.liabilities
          .map((liability) => liability.valuedAt)
          .filter((date): date is string => Boolean(date)),
      ),
      cadence: "quarterly",
      required: false,
    });
  }
  if ((facts.otherAssets?.length ?? 0) > 0) {
    freshness.push({
      id: "other-asset-valuations",
      sourceIds: facts.otherAssets?.map((asset) => asset.inputId ?? asset.id),
      label: "Other asset values",
      lastUpdated: minDate((facts.otherAssets ?? []).map((asset) => asset.valuedAt)),
      cadence: "annually",
      required: false,
    });
  }

  const otherAssumptions = facts.assumptions.filter(
    (assumption) =>
      assumption.key !== "safeWithdrawalRate" &&
      !assumption.key.startsWith("monthlySpend"),
  );
  if (otherAssumptions.length > 0) {
    freshness.push({
      id: "assumptions",
      sourceIds: otherAssumptions.map((assumption) => assumption.id),
      label: "Planning inputs",
      lastUpdated: minDate(
        otherAssumptions.map((assumption) => assumption.lastReviewedAt),
      ),
      cadence: "annually",
      required: false,
    });
  }

  const flags: SoftFlag[] = [];
  for (const account of facts.accounts) {
    const cash = derived.cashByAccount[account.id];
    if (cash !== undefined && dec(cash).isNegative()) {
      flags.push({
        id: `negative-cash-${account.id}`,
        sourceIds: derived.cashInputsByAccount[account.id],
        label: `Cash is negative in ${account.name ?? account.id} — confirm the balance`,
      });
    }
  }

  const dq = dataQuality({ snapshotId, asOf, inputs: freshness, flags });
  const st = status({
    snapshotId,
    runwayMonths: fr.value.runwayMonths,
    monthlySpendEUR: spend?.value ?? null,
    safeMonthlySpendEUR: fr.value.safeMonthlySpendEUR,
    dataQuality: dq.value,
    reviewDue,
  });
  const conc = concentration({
    snapshotId,
    holdings: val.value.holdings
      .filter((holding) => dec(holding.quantity).greaterThan(0))
      .map((holding) => ({
        holdingId: holding.holdingId,
        accountId: accountByHolding.get(holding.holdingId) ?? "",
        isin: holding.isin,
        valueEUR: holding.valueEUR,
        inputs: holding.inputs,
      })),
    accounts: facts.accounts,
    cashByAccount: derived.cashByAccount,
    netWorth: nw.value,
    netWorthInputs: nw.inputs,
  });

  return {
    snapshotId,
    asOf,
    valuation: val,
    netWorth: nw,
    fire: fr,
    dataQuality: dq,
    status: st,
    concentration: conc,
  };
}
