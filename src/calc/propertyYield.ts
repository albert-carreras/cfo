import { dec, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";

// Unlevered property yield vs the assumed ETF return — the deterministic half
// of "should I keep this flat?". UNLEVERED on purpose: rent/value ignores
// mortgage financing and owner equity (the facts expose only balances, not
// interest), so this is the property's own productivity, not a return on
// equity — every surface must say so. The ETF side is the user's nominal
// `expectedReturn` ASSUMPTION deflated by their `longRunInflation` FORECAST —
// a labeled judgment input, never a market prediction this app originates.
// Ownership share cancels out of a yield, so figures are full-property. Pure.

export type PropertyYieldLine = {
  propertyId: string;
  grossYield: Money; // rent·12 / value
  netYield: Money; // (rent − costs)·12 / value — may be negative
  isPrimaryResidence: boolean;
  // Real (inflation-adjusted) comparison — present only when both assumptions
  // are set; an honest unknown is an absent field.
  realNetYield: Money | null; // (1+netYield)/(1+i) − 1
  etfRealReturn: Money | null; // (1+expectedReturn)/(1+i) − 1
  realGap: Money | null; // realNetYield − etfRealReturn (negative = the ETF assumption wins)
};

export type PropertyYieldValue = { properties: PropertyYieldLine[] };

export function propertyYield(args: {
  snapshotId: string;
  properties: {
    id: string;
    value: Money;
    rentMonthly: Money;
    costsMonthly: Money;
    isPrimaryResidence: boolean;
  }[];
  expectedReturnAnnual: Money | null; // nominal assumption
  longRunInflationAnnual: Money | null; // forecast assumption
  inputs: string[]; // property ids + the assumption row ids used (provenance)
}): CalcResult<PropertyYieldValue> {
  const {
    snapshotId,
    properties,
    expectedReturnAnnual,
    longRunInflationAnnual,
    inputs,
  } = args;

  const expectedReturn =
    expectedReturnAnnual === null ? null : dec(expectedReturnAnnual);
  const inflation =
    longRunInflationAnnual === null ? null : dec(longRunInflationAnnual);
  const onePlusI = inflation === null ? null : dec(1).plus(inflation);
  const comparable =
    expectedReturn !== null && onePlusI !== null && onePlusI.greaterThan(0);

  const etfReal = comparable
    ? dec(1).plus(expectedReturn!).dividedBy(onePlusI!).minus(1)
    : null;

  const lines: PropertyYieldLine[] = properties
    // value ≤ 0 has no meaningful yield — skipped, never divided by.
    .filter((p) => dec(p.value).greaterThan(0))
    .map((p) => {
      const value = dec(p.value);
      const gross = dec(p.rentMonthly).times(12).dividedBy(value);
      const net = dec(p.rentMonthly)
        .minus(dec(p.costsMonthly))
        .times(12)
        .dividedBy(value);
      const realNet = comparable
        ? dec(1).plus(net).dividedBy(onePlusI!).minus(1)
        : null;
      return {
        propertyId: p.id,
        grossYield: gross.toFixed(6),
        netYield: net.toFixed(6),
        isPrimaryResidence: p.isPrimaryResidence,
        realNetYield: realNet === null ? null : realNet.toFixed(6),
        etfRealReturn: etfReal === null ? null : etfReal.toFixed(6),
        realGap:
          realNet === null || etfReal === null
            ? null
            : realNet.minus(etfReal).toFixed(6),
      };
    });

  return {
    snapshotId,
    value: { properties: lines },
    source: VERSIONS.propertyYield.source,
    version: VERSIONS.propertyYield.version,
    inputs,
  };
}
