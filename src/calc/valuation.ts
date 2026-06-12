import { dec, sum, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";

// holdings × cached price × FX → asset values. Pure. The price/FX tables hold a
// running daily history, so each ISIN/quote may have many rows — the
// latest asOf wins, deterministically (asOf, then id, breaks ties).

export type ValuationHolding = { id: string; isin: string };
export type PriceRow = {
  id: string;
  isin: string;
  price: Money;
  currency: string;
  asOf: string;
};
export type FxRow = { id: string; quote: string; rate: Money; asOf: string };

export type HoldingValue = {
  holdingId: string;
  isin: string;
  quantity: Money;
  priceEUR: Money;
  valueEUR: Money;
  priced: boolean; // false = no price, or no FX for its currency (counted as 0, flagged by data quality)
  priceAsOf: string | null; // date of the price row used (drives the freshness check)
  fxAsOf: string | null;
  valuationAsOf: string | null;
  inputs: string[];
};

export type ValuationValue = {
  holdings: HoldingValue[];
  totalEUR: Money;
};

// Latest row per key: max asOf, ties broken by id so DB row order never matters.
function latestBy<T extends { id: string; asOf: string }>(
  rows: T[],
  key: (row: T) => string,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) {
    const prev = out.get(key(row));
    if (
      !prev ||
      row.asOf > prev.asOf ||
      (row.asOf === prev.asOf && row.id > prev.id)
    ) {
      out.set(key(row), row);
    }
  }
  return out;
}

export function valuation(args: {
  snapshotId: string;
  asOf: string;
  holdings: ValuationHolding[];
  quantityByHolding: Record<string, Money>;
  quantityInputsByHolding?: Record<string, string[]>;
  prices: PriceRow[];
  fx: FxRow[];
}): CalcResult<ValuationValue> {
  const {
    snapshotId,
    asOf,
    holdings,
    quantityByHolding,
    quantityInputsByHolding = {},
    prices,
    fx,
  } = args;

  const priceByIsin = latestBy(
    prices.filter((price) => price.asOf <= asOf),
    (p) => p.isin,
  );
  const fxByQuote = latestBy(
    fx.filter((rate) => rate.asOf <= asOf),
    (f) => f.quote,
  );
  const inputs = new Set<string>();

  const lines: HoldingValue[] = holdings.map((h) => {
    const lineInputs = new Set(quantityInputsByHolding[h.id] ?? [h.id]);
    for (const id of lineInputs) inputs.add(id);
    const qty = dec(quantityByHolding[h.id] ?? 0);
    const price = priceByIsin.get(h.isin);

    const unpriced = (priceAsOf: string | null = null): HoldingValue => ({
      holdingId: h.id,
      isin: h.isin,
      quantity: qty.toString(),
      priceEUR: "0.00",
      valueEUR: "0.00",
      priced: false,
      priceAsOf,
      fxAsOf: null,
      valuationAsOf: null,
      inputs: [...lineInputs],
    });

    if (!price) return unpriced();
    lineInputs.add(price.id);
    inputs.add(price.id);

    let priceEUR = dec(price.price);
    let fxAsOf: string | null = null;
    if (price.currency !== "EUR") {
      const f = fxByQuote.get(price.currency);
      // No FX rate for the price's currency: we can't value this honestly, so
      // it counts as 0 and stays priced:false — never silently treated as EUR.
      if (!f) return unpriced(price.asOf);
      priceEUR = priceEUR.times(dec(f.rate));
      fxAsOf = f.asOf;
      lineInputs.add(f.id);
      inputs.add(f.id);
    }

    const valuationAsOf =
      fxAsOf && fxAsOf < price.asOf ? fxAsOf : price.asOf;
    return {
      holdingId: h.id,
      isin: h.isin,
      quantity: qty.toString(),
      priceEUR: priceEUR.toFixed(2),
      valueEUR: qty.times(priceEUR).toFixed(2),
      priced: true,
      priceAsOf: price.asOf,
      fxAsOf,
      valuationAsOf,
      inputs: [...lineInputs],
    };
  });

  return {
    snapshotId,
    value: { holdings: lines, totalEUR: sum(lines.map((l) => l.valueEUR)).toFixed(2) },
    source: VERSIONS.valuation.source,
    version: VERSIONS.valuation.version,
    inputs: [...inputs],
  };
}
