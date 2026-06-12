import { db, type Database } from "./db";
import {
  accounts,
  assumptions,
  fxRates,
  holdings,
  liabilities,
  marketPrices,
  monthlySpend,
  movements,
  plannedEvents,
  properties,
  revaluations,
  taxLots,
} from "./db/schema";
import type { SnapshotFacts } from "@/calc/snapshot";

// Reads the Brain and maps DB rows into the pure calculator input shape. Disposed
// facts (soft-closed) stop counting; the ledger is read whole. This is the only
// I/O boundary between Postgres and the deterministic core.

export type FactsBundle = {
  facts: SnapshotFacts;
  accountNameById: Record<string, string>;
  holdingNameById: Record<string, string>;
  propertyNameById: Record<string, string>;
  sourceLabelById: Record<string, string>;
};

type FactsDatabase = Pick<Database, "select">;

export async function loadFacts(
  database: FactsDatabase = db,
): Promise<FactsBundle> {
  const [accs, holds, props, liabs, assums, movs, spend, prices, fx, lots, revals, events] =
    await Promise.all([
      database.select().from(accounts),
      database.select().from(holdings),
      database.select().from(properties),
      database.select().from(liabilities),
      database.select().from(assumptions),
      database.select().from(movements),
      database.select().from(monthlySpend),
      database.select().from(marketPrices),
      database.select().from(fxRates),
      database.select().from(taxLots),
      database.select().from(revaluations),
      database.select().from(plannedEvents),
    ]);

  const liveAccs = accs.filter((a) => !a.disposedAt);
  const liveHolds = holds.filter((h) => !h.disposedAt);
  const liveProps = props.filter((p) => !p.disposedAt);
  const liveLiabs = liabs.filter((l) => !l.disposedAt);
  const accountNameById = Object.fromEntries(accs.map((a) => [a.id, a.name]));
  const holdingNameById = Object.fromEntries(
    holds.map((h) => [h.id, h.ticker ?? h.name]),
  );
  const holdingNameByIsin = new Map(
    holds.map((holding) => [
      holding.isin,
      holding.ticker ?? holding.name,
    ]),
  );
  const propertyNameById = new Map(
    props.map((property) => [property.id, property.name]),
  );

  const facts: SnapshotFacts = {
    accounts: liveAccs.map((a) => ({
      id: a.id,
      type: a.type,
      name: a.name,
      openingCash: a.openingCash,
      openingAsOf: a.openingAsOf,
    })),
    holdings: liveHolds.map((h) => ({
      id: h.id,
      accountId: h.accountId,
      isin: h.isin,
      openingQuantity: h.openingQuantity,
      openingAsOf: h.openingAsOf,
    })),
    accountOpeningAsOf: Object.fromEntries(
      accs.map((account) => [account.id, account.openingAsOf]),
    ),
    holdingOpeningAsOf: Object.fromEntries(
      holds.map((holding) => [holding.id, holding.openingAsOf]),
    ),
    movements: movs.map((m) => ({
      id: m.id,
      type: m.type,
      accountId: m.accountId,
      holdingId: m.holdingId,
      quantity: m.quantity,
      amount: m.amount,
      occurredAt: m.occurredAt,
      correctsId: m.correctsId,
    })),
    // Dated value statements — account re-anchors only for now.
    revaluations: revals
      .filter((r) => r.assetType === "account")
      .map((r) => ({
        id: r.id,
        accountId: r.assetId,
        value: r.value,
        valuedAt: r.valuedAt,
        createdAt: r.createdAt.toISOString(),
      })),
    properties: liveProps.map((p) => ({
      id: p.id,
      value: p.value,
      ownershipPct: p.ownershipPct,
      valuedAt: p.valuedAt,
      rentMonthly: p.rentMonthly,
      costsMonthly: p.costsMonthly,
      isPrimaryResidence: p.isPrimaryResidence,
      purchasePrice: p.purchasePrice,
    })),
    liabilities: liveLiabs.map((l) => ({
      id: l.id,
      propertyId: l.propertyId,
      balance: l.balance,
    })),
    // Numeric assumptions feed the calculators; date-typed ones (birthDate)
    // are read by the Ask layer directly and never enter the freshness loop.
    assumptions: assums
      .filter((a) => a.value !== null)
      .map((a) => ({
        id: a.id,
        key: a.key,
        value: a.value as string,
        lastReviewedAt: a.lastReviewedAt,
      })),
    prices: prices.map((p) => ({
      id: p.id,
      isin: p.isin,
      price: p.price,
      currency: p.currency,
      asOf: p.asOf,
    })),
    fx: fx.map((f) => ({ id: f.id, quote: f.quote, rate: f.rate, asOf: f.asOf })),
    monthlySpend: spend.map((r) => ({
      id: r.id,
      month: r.month,
      amount: r.amount,
      createdAt: r.createdAt.toISOString(),
    })),
    // Tax basis remains relevant after a holding is disposed, even though the
    // holding itself no longer appears in valuation.
    taxLots: lots.map((l) => ({
      id: l.id,
      holdingId: l.holdingId,
      buyDate: l.buyDate,
      quantity: l.quantity,
      costBasisEUR: l.costBasisEUR,
    })),
    // Forecasts, not facts — consumed only by the scenario engine.
    plannedEvents: events.map((e) => ({
      id: e.id,
      type: e.type,
      date: e.date,
      amount: e.amount,
      probability: e.probability,
      includedInBaseCase: e.includedInBaseCase,
      realisedAt: e.realisedAt ? e.realisedAt.toISOString() : null,
    })),
  };

  const sourceLabelById = Object.fromEntries([
    ...accs.map((account) => [
      account.id,
      `${account.name} opening balance · ${account.openingAsOf}`,
    ]),
    ...holds.map((holding) => [
      holding.id,
      `${holding.ticker ?? holding.name} opening quantity · ${holding.openingAsOf}`,
    ]),
    ...movs.map((movement) => [
      movement.id,
      `${movement.type} · ${accountNameById[movement.accountId] ?? movement.accountId} · ${movement.occurredAt}`,
    ]),
    ...props.map((property) => [
      property.id,
      `${property.name} valuation · ${property.valuedAt}`,
    ]),
    ...liabs.map((liability) => [
      liability.id,
      `${liability.type}${liability.propertyId ? ` · ${propertyNameById.get(liability.propertyId) ?? liability.propertyId}` : ""} · ${liability.updatedAt.toISOString().slice(0, 10)}`,
    ]),
    ...assums.map((assumption) => [
      assumption.id,
      `${assumption.key} · reviewed ${assumption.lastReviewedAt}`,
    ]),
    ...spend.map((row) => [
      row.id,
      `Monthly spending · ${row.month}`,
    ]),
    ...revals.map((reval) => [
      reval.id,
      `${accountNameById[reval.assetId] ?? reval.assetId} revaluation · ${reval.valuedAt}`,
    ]),
    ...prices.map((price) => [
      price.id,
      `${holdingNameByIsin.get(price.isin) ?? price.isin} price · ${price.asOf}`,
    ]),
    ...fx.map((rate) => [
      rate.id,
      `EUR per ${rate.quote} FX · ${rate.asOf}`,
    ]),
    ...lots.map((lot) => [
      lot.id,
      `${holdingNameById[lot.holdingId] ?? lot.holdingId} opening tax lot · ${lot.buyDate}`,
    ]),
    ...events.map((event) => [
      event.id,
      `planned ${event.type} · ${event.date}`,
    ]),
  ]);

  return {
    facts,
    accountNameById,
    holdingNameById,
    propertyNameById: Object.fromEntries(propertyNameById),
    sourceLabelById,
  };
}
