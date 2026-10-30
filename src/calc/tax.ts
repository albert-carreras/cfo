import Decimal from "decimal.js";
import { dec, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";
import { ES_SAVINGS_SCALE, taxDueDate } from "./config/taxEs";

// Realised gains and the tax to keep aside for them. Pure.
//   cost basis  = FIFO over the holding's purchase lots (Spain's rule for
//                 homogeneous securities), oldest first
//   gain        = net proceeds − cost basis, per sale
//   tax         = the savings scale over the year's net gain (losses offset
//                 gains within the same year; never below zero)
// Not modelled: interest and dividends (also savings base), loss
// carry-forwards from earlier years, property sales. The UI says so.

export type TaxLot = {
  id: string;
  holdingId: string;
  buyDate: string;
  quantity: Money;
  costBasisEUR: Money;
};

export type Sale = {
  id: string;
  holdingId: string;
  soldAt: string;
  quantity: Money;
  proceedsEUR: Money;
  // Null when the purchase lots do not cover the sale and none was entered.
  costBasisEUR: Money | null;
};

export type TaxSettlement = {
  id: string;
  year: number;
  paidAt: string;
  amountEUR: Money;
};

// Cost of `quantity` units taken FIFO from `lots` after `alreadySold` units
// were taken by earlier sales. Null when the lots cannot cover the sale: an
// unknown basis is never guessed.
export function fifoCostBasis(args: {
  lots: TaxLot[];
  alreadySold: Money;
  quantity: Money;
}): Money | null {
  const lots = [...args.lots].sort(
    (a, b) => a.buyDate.localeCompare(b.buyDate) || a.id.localeCompare(b.id),
  );
  let skip = dec(args.alreadySold);
  let need = dec(args.quantity);
  let cost = dec(0);
  for (const lot of lots) {
    if (need.lessThanOrEqualTo(0)) break;
    let available = dec(lot.quantity);
    if (skip.greaterThan(0)) {
      const used = Decimal.min(skip, available);
      skip = skip.minus(used);
      available = available.minus(used);
    }
    if (available.lessThanOrEqualTo(0)) continue;
    const take = Decimal.min(need, available);
    cost = cost.plus(dec(lot.costBasisEUR).times(take).dividedBy(lot.quantity));
    need = need.minus(take);
  }
  return need.greaterThan(0) ? null : cost.toFixed(2);
}

export function savingsTax(gainEUR: Money, scale = ES_SAVINGS_SCALE): Money {
  let remaining = Decimal.max(0, dec(gainEUR));
  let floor = dec(0);
  let tax = dec(0);
  for (const bracket of scale.brackets) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const width =
      bracket.upTo === null ? remaining : dec(bracket.upTo).minus(floor);
    const taxed = Decimal.min(remaining, width);
    tax = tax.plus(taxed.times(bracket.rate));
    remaining = remaining.minus(taxed);
    if (bracket.upTo !== null) floor = dec(bracket.upTo);
  }
  return tax.toFixed(2);
}

export type TaxYear = {
  year: number;
  saleCount: number;
  proceedsEUR: Money;
  // Net gain over the sales whose cost basis is known.
  gainEUR: Money;
  unknownBasisCount: number;
  taxEUR: Money;
  dueBy: string;
  settled: { paidAt: string; amountEUR: Money } | null;
};

export type TaxValue = {
  years: TaxYear[]; // newest first
  // Estimated tax for every year not yet marked paid.
  dueEUR: Money;
  scaleVersion: string;
};

export function taxSummary(args: {
  snapshotId: string;
  asOf: string;
  sales: Sale[];
  settlements: TaxSettlement[];
  scale?: typeof ES_SAVINGS_SCALE;
}): CalcResult<TaxValue> {
  const { snapshotId, asOf, settlements, scale = ES_SAVINGS_SCALE } = args;
  const sales = args.sales.filter((sale) => sale.soldAt <= asOf);
  const byYear = new Map<number, Sale[]>();
  for (const sale of sales) {
    const year = Number(sale.soldAt.slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), sale]);
  }

  let due = dec(0);
  const years: TaxYear[] = [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, rows]) => {
      const known = rows.filter((row) => row.costBasisEUR !== null);
      const gain = known.reduce(
        (acc, row) =>
          acc.plus(dec(row.proceedsEUR)).minus(dec(row.costBasisEUR)),
        dec(0),
      );
      const tax = savingsTax(gain.toFixed(2), scale);
      const settlement = settlements
        .filter((row) => row.year === year && row.paidAt <= asOf)
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0];
      if (!settlement) due = due.plus(tax);
      return {
        year,
        saleCount: rows.length,
        proceedsEUR: rows
          .reduce((acc, row) => acc.plus(dec(row.proceedsEUR)), dec(0))
          .toFixed(2),
        gainEUR: gain.toFixed(2),
        unknownBasisCount: rows.length - known.length,
        taxEUR: tax,
        dueBy: taxDueDate(year),
        settled: settlement
          ? { paidAt: settlement.paidAt, amountEUR: settlement.amountEUR }
          : null,
      };
    });

  return {
    snapshotId,
    value: { years, dueEUR: due.toFixed(2), scaleVersion: scale.version },
    source: VERSIONS.tax.source,
    version: VERSIONS.tax.version,
    inputs: [...sales.map((row) => row.id), ...settlements.map((row) => row.id)],
  };
}
