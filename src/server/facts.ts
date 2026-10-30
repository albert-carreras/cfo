import { db, type Database } from "./db";
import {
  accounts,
  assumptions,
  fxRates,
  holdings,
  liabilities,
  marketPrices,
  movements,
  otherAssets,
  plannedEvents,
  properties,
  revaluations,
  sales,
  taxLots,
  taxSettlements,
} from "./db/schema";
import type { SnapshotFacts } from "@/calc/snapshot";

// The only I/O boundary between Postgres and the trust core: reads the record
// and maps rows into the pure calculator input. Closed (soft-closed) items
// stop counting; voided sales and tax payments are ignored. The raw rows ride
// along for screens that need names and details.

type FactsDatabase = Pick<Database, "select">;

export async function loadFacts(
  database: FactsDatabase = db,
  asOf = new Date().toISOString().slice(0, 10),
) {
  const [
    accountRows,
    holdingRows,
    propertyRows,
    otherRows,
    liabilityRows,
    assumptionRows,
    movementRows,
    priceRows,
    fxRows,
    lotRows,
    revaluationRows,
    planRows,
    saleRows,
    settlementRows,
  ] = await Promise.all([
    database.select().from(accounts),
    database.select().from(holdings),
    database.select().from(properties),
    database.select().from(otherAssets),
    database.select().from(liabilities),
    database.select().from(assumptions),
    database.select().from(movements),
    database.select().from(marketPrices),
    database.select().from(fxRates),
    database.select().from(taxLots),
    database.select().from(revaluations),
    database.select().from(plannedEvents),
    database.select().from(sales),
    database.select().from(taxSettlements),
  ]);

  const liveAccounts = accountRows.filter((row) => !row.disposedAt);
  const liveHoldings = holdingRows.filter((row) => !row.disposedAt);
  const liveProperties = propertyRows.filter((row) => !row.disposedAt);
  const liveOther = otherRows.filter((row) => !row.disposedAt);
  const liveLiabilities = liabilityRows.filter((row) => !row.disposedAt);
  const liveSales = saleRows.filter((row) => !row.voidedAt);
  const liveSettlements = settlementRows.filter((row) => !row.voidedAt);
  const propertyNameById = new Map(propertyRows.map((row) => [row.id, row.name]));

  // Latest dated observation of a property / debt / other asset on or before
  // asOf; it supersedes the stated value.
  const latestObservation = (assetType: string, assetId: string) =>
    revaluationRows
      .filter(
        (row) =>
          row.assetType === assetType &&
          row.assetId === assetId &&
          row.valuedAt <= asOf,
      )
      .sort(
        (a, b) =>
          b.valuedAt.localeCompare(a.valuedAt) ||
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id),
      )[0] ?? null;

  const facts: SnapshotFacts = {
    accounts: liveAccounts.map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      openingCash: row.openingCash,
      openingAsOf: row.openingAsOf,
    })),
    holdings: liveHoldings.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      isin: row.isin,
      name: row.ticker ?? row.name,
      openingQuantity: row.openingQuantity,
      openingAsOf: row.openingAsOf,
    })),
    movements: movementRows.map((row) => ({
      id: row.id,
      type: row.type,
      accountId: row.accountId,
      holdingId: row.holdingId,
      quantity: row.quantity,
      amount: row.amount,
      occurredAt: row.occurredAt,
      correctsId: row.correctsId,
      createdAt: row.createdAt.toISOString(),
    })),
    revaluations: revaluationRows
      .filter((row) => row.assetType === "account" || row.assetType === "holding")
      .map((row) => ({
        id: row.id,
        accountId: row.assetType === "account" ? row.assetId : undefined,
        holdingId: row.assetType === "holding" ? row.assetId : undefined,
        value: row.value,
        valuedAt: row.valuedAt,
        createdAt: row.createdAt.toISOString(),
      })),
    properties: liveProperties.map((row) => {
      const observation = latestObservation("property", row.id);
      return {
        id: row.id,
        name: row.name,
        value: observation?.value ?? row.value,
        ownershipPct: row.ownershipPct,
        valuedAt: observation?.valuedAt ?? row.valuedAt,
        rentMonthly: row.rentMonthly,
        costsMonthly: row.costsMonthly,
        isPrimaryResidence: row.isPrimaryResidence,
        purchasePrice: row.purchasePrice,
        inputId: observation?.id ?? row.id,
      };
    }),
    otherAssets: liveOther.map((row) => {
      const observation = latestObservation("other_asset", row.id);
      return {
        id: row.id,
        name: row.name,
        value: observation?.value ?? row.value,
        includeInNetWorth: row.includeInNetWorth,
        valuedAt: observation?.valuedAt ?? row.valuedAt,
        inputId: observation?.id ?? row.id,
      };
    }),
    liabilities: liveLiabilities.map((row) => {
      const observation = latestObservation("liability", row.id);
      return {
        id: row.id,
        name:
          row.name ??
          (row.propertyId
            ? `Mortgage · ${propertyNameById.get(row.propertyId) ?? "property"}`
            : "Loan"),
        propertyId: row.propertyId,
        balance: observation?.value ?? row.balance,
        valuedAt: observation?.valuedAt ?? row.createdAt.toISOString().slice(0, 10),
        inputId: observation?.id ?? row.id,
      };
    }),
    // Numeric assumptions only; date-typed ones (birth date) are context.
    assumptions: assumptionRows
      .filter((row) => row.value !== null)
      .map((row) => ({
        id: row.id,
        key: row.key,
        value: row.value as string,
        lastReviewedAt: row.lastReviewedAt,
      })),
    prices: priceRows.map((row) => ({
      id: row.id,
      isin: row.isin,
      price: row.price,
      currency: row.currency,
      asOf: row.asOf,
    })),
    fx: fxRows.map((row) => ({ id: row.id, quote: row.quote, rate: row.rate, asOf: row.asOf })),
    taxLots: lotRows.map((row) => ({
      id: row.id,
      holdingId: row.holdingId,
      buyDate: row.buyDate,
      quantity: row.quantity,
      costBasisEUR: row.costBasisEUR,
    })),
    sales: liveSales.map((row) => ({
      id: row.id,
      holdingId: row.holdingId,
      soldAt: row.soldAt,
      quantity: row.quantity,
      proceedsEUR: row.proceedsEUR,
      costBasisEUR: row.costBasisEUR,
    })),
    taxSettlements: liveSettlements.map((row) => ({
      id: row.id,
      year: row.year,
      paidAt: row.paidAt,
      amountEUR: row.amountEUR,
    })),
    plannedEvents: planRows.map((row) => ({
      id: row.id,
      type: row.type,
      date: row.date,
      amount: row.amount,
      realisedAt: row.realisedAt ? row.realisedAt.toISOString() : null,
    })),
  };

  return {
    facts,
    rows: {
      accounts: accountRows,
      holdings: holdingRows,
      properties: propertyRows,
      otherAssets: otherRows,
      liabilities: liabilityRows,
      assumptions: assumptionRows,
      movements: movementRows,
      revaluations: revaluationRows,
      taxLots: lotRows,
      plans: planRows,
      sales: saleRows,
      settlements: settlementRows,
    },
  };
}

export type FactsBundle = Awaited<ReturnType<typeof loadFacts>>;
