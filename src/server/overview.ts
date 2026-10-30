import { createId } from "@paralleldrive/cuid2";
import { desc } from "drizzle-orm";
import { deriveState } from "@/calc/derive";
import { dec, formatEURWhole, formatUnits, type Money } from "@/calc/money";
import { computeSnapshot } from "@/calc/snapshot";
import { fifoCostBasis } from "@/calc/tax";
import { db } from "./db";
import { dataUpdates } from "./db/schema";
import { loadFacts } from "./facts";
import { netWorthSeries } from "./snapshots";
import { utcDate } from "./write";
import { ACCOUNT_TYPE_LABELS, type AccountTypeKey } from "@/shared/inputs";
import { isAmountTBD, isTimingUnknown, planLabel } from "@/shared/plans";

// Everything a screen (or the export) needs, computed once from the record:
// the snapshot plus each item with its current value and when it was last
// confirmed. Read-only.

const TYPE_ORDER: Record<AccountTypeKey, number> = { bank: 0, manual: 1, broker: 2, pension: 3 };

export async function loadOverview(now = new Date()) {
  const asOf = utcDate(now);
  const bundle = await loadFacts(db, asOf);
  const { facts, rows } = bundle;
  const snapshot = computeSnapshot({ snapshotId: createId(), asOf, facts });
  const state = deriveState({
    accounts: facts.accounts,
    holdings: facts.holdings,
    movements: facts.movements,
    revaluations: facts.revaluations,
    asOf,
  });

  const confirmed = (assetType: string, assetId: string, opening: string) =>
    rows.revaluations
      .filter(
        (row) =>
          row.assetType === assetType &&
          row.assetId === assetId &&
          row.valuedAt <= asOf &&
          row.valuedAt >= opening,
      )
      .map((row) => row.valuedAt)
      .sort()
      .at(-1) ?? opening;

  const valuationByHolding = new Map(
    snapshot.valuation.value.holdings.map((row) => [row.holdingId, row]),
  );
  const liveSales = rows.sales.filter((row) => !row.voidedAt);

  const holdings = rows.holdings
    .filter((row) => !row.disposedAt)
    .map((row) => {
      const units = state.quantityByHolding[row.id] ?? row.openingQuantity;
      const line = valuationByHolding.get(row.id);
      const soldUnits = liveSales
        .filter((sale) => sale.holdingId === row.id)
        .reduce((acc, sale) => acc.plus(sale.quantity), dec(0));
      const lots = rows.taxLots.filter((lot) => lot.holdingId === row.id);
      const costBasisEUR = dec(units).greaterThan(0)
        ? fifoCostBasis({ lots, alreadySold: soldUnits.toString(), quantity: units })
        : null;
      const valueEUR = line?.valueEUR ?? "0.00";
      return {
        id: row.id,
        accountId: row.accountId,
        name: row.name,
        ticker: row.ticker,
        label: row.ticker ?? row.name,
        units,
        priced: line?.priced ?? false,
        priceEUR: line?.priceEUR ?? null,
        priceAsOf: line?.priceAsOf ?? null,
        valueEUR,
        costBasisEUR,
        // No price, no gain: a missing price is not a loss.
        gainEUR:
          costBasisEUR === null || !line?.priced
            ? null
            : dec(valueEUR).minus(costBasisEUR).toFixed(2),
        lots: lots.sort((a, b) => a.buyDate.localeCompare(b.buyDate)),
        confirmedAt: confirmed("holding", row.id, row.openingAsOf),
        openingAsOf: row.openingAsOf,
      };
    });

  const accounts = rows.accounts
    .filter((row) => !row.disposedAt)
    .map((row) => {
      const cashEUR = state.cashByAccount[row.id] ?? row.openingCash;
      const inside = holdings.filter((holding) => holding.accountId === row.id);
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        typeLabel: ACCOUNT_TYPE_LABELS[row.type],
        cashEUR,
        holdings: inside,
        totalEUR: inside.reduce((acc, h) => acc.plus(h.valueEUR), dec(cashEUR)).toFixed(2),
        confirmedAt: confirmed("account", row.id, row.openingAsOf),
        openingAsOf: row.openingAsOf,
      };
    })
    .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name));

  const liabilityFacts = new Map(facts.liabilities.map((row) => [row.id, row]));
  const propertyNames = new Map(rows.properties.map((row) => [row.id, row.name]));
  const liabilities = rows.liabilities
    .filter((row) => !row.disposedAt)
    .map((row) => {
      const fact = liabilityFacts.get(row.id);
      return {
        id: row.id,
        name: fact?.name ?? row.name ?? "Debt",
        balanceEUR: fact?.balance ?? row.balance,
        rate: row.rate,
        payment: row.payment,
        propertyId: row.propertyId,
        propertyName: row.propertyId ? (propertyNames.get(row.propertyId) ?? null) : null,
        valuedAt: fact?.valuedAt ?? asOf,
      };
    });

  const propertyFacts = new Map(facts.properties.map((row) => [row.id, row]));
  const equity = new Map(
    snapshot.netWorth.value.propertyEquity.map((row) => [row.propertyId, row.equityEUR]),
  );
  const properties = rows.properties
    .filter((row) => !row.disposedAt)
    .map((row) => {
      const fact = propertyFacts.get(row.id);
      const valueEUR = fact?.value ?? row.value;
      const shareEUR = dec(valueEUR).times(row.ownershipPct).dividedBy(100).toFixed(2);
      return {
        id: row.id,
        name: row.name,
        valueEUR,
        ownershipPct: dec(row.ownershipPct).toString(),
        shareEUR,
        mortgageEUR: liabilities
          .filter((l) => l.propertyId === row.id)
          .reduce((acc, l) => acc.plus(l.balanceEUR), dec(0))
          .toFixed(2),
        equityEUR: equity.get(row.id) ?? shareEUR,
        valuedAt: fact?.valuedAt ?? row.valuedAt,
        purchasePrice: row.purchasePrice,
        rentMonthly: row.rentMonthly,
        costsMonthly: row.costsMonthly,
        isPrimaryResidence: row.isPrimaryResidence,
      };
    });

  const otherFacts = new Map((facts.otherAssets ?? []).map((row) => [row.id, row]));
  const otherAssets = rows.otherAssets
    .filter((row) => !row.disposedAt)
    .map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      valueEUR: otherFacts.get(row.id)?.value ?? row.value,
      includeInNetWorth: row.includeInNetWorth,
      valuedAt: otherFacts.get(row.id)?.valuedAt ?? row.valuedAt,
      note: row.note,
    }));

  const plans = rows.plans
    .filter((row) => !row.realisedAt)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      id: row.id,
      type: row.type,
      label: planLabel(row.type),
      date: row.date,
      timingUnknown: isTimingUnknown(row.date),
      amount: row.amount,
      amountTBD: isAmountTBD(row.amount),
      note: row.note,
    }));

  const holdingNames = new Map(rows.holdings.map((row) => [row.id, row.ticker ?? row.name]));
  const salesByYear = snapshot.tax.value.years.map((year) => ({
    ...year,
    sales: liveSales
      .filter((sale) => sale.soldAt.startsWith(String(year.year)) && sale.soldAt <= asOf)
      .sort((a, b) => b.soldAt.localeCompare(a.soldAt))
      .map((sale) => ({
        id: sale.id,
        holding: holdingNames.get(sale.holdingId) ?? "investment",
        soldAt: sale.soldAt,
        quantity: sale.quantity,
        proceedsEUR: sale.proceedsEUR,
        costBasisEUR: sale.costBasisEUR,
        costBasisSource: sale.costBasisSource,
        gainEUR:
          sale.costBasisEUR === null
            ? null
            : dec(sale.proceedsEUR).minus(sale.costBasisEUR).toFixed(2),
      })),
  }));

  const inputs = Object.fromEntries(
    rows.assumptions.map((row) => [
      row.key,
      {
        value: row.dateValue ?? row.value,
        lastReviewedAt: row.lastReviewedAt,
        source: row.source,
      },
    ]),
  );

  return {
    asOf,
    snapshot,
    accounts,
    properties,
    liabilities,
    otherAssets,
    plans,
    taxYears: salesByYear,
    inputs,
    names: {
      account: new Map(rows.accounts.map((row) => [row.id, row.name])),
      holding: holdingNames,
      property: propertyNames,
      liability: new Map(rows.liabilities.map((row) => [row.id, row.name ?? "Debt"])),
      other_asset: new Map(rows.otherAssets.map((row) => [row.id, row.name])),
    },
  };
}

export type Overview = Awaited<ReturnType<typeof loadOverview>>;

export async function loadSeries() {
  return netWorthSeries();
}

// The activity log: one entry per thing that happened. Entries written before
// the log existed carry raw observations; their names are resolved here.
export async function listActivity(names: Overview["names"], limit = 50) {
  const rows = await db
    .select()
    .from(dataUpdates)
    .orderBy(desc(dataUpdates.createdAt))
    .limit(limit);
  return rows.map((row) => {
    const changes = Array.isArray(row.changes) ? (row.changes as Record<string, unknown>[]) : [];
    const lines = changes.map((change) => {
      if (typeof change.label === "string") {
        return { label: change.label, value: String(change.value ?? "") };
      }
      const type = String(change.assetType ?? "");
      const id = String(change.assetId ?? "");
      const name = names[type as keyof Overview["names"]]?.get(id) ?? "item";
      const raw = String(change.value ?? "0") as Money;
      return {
        label: type === "holding" ? `${name} units` : name,
        value: type === "holding" ? formatUnits(raw) : formatEURWhole(raw),
      };
    });
    return {
      id: row.id,
      at: row.createdAt.toISOString(),
      asOf: row.asOf,
      kind: row.kind ?? "values",
      title: row.title ?? (lines.length === 1 ? `Updated ${lines[0].label}` : `Updated ${lines.length} values`),
      note: row.note,
      lines,
    };
  });
}
