import { dec, money, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";
import { CONCENTRATION_CEILINGS } from "./config/concentration";

// Concentration — where the pile clusters: single position, single
// broker, real estate, Spain. Pure; classifies against the versioned ceilings,
// never shames. It is the natural trigger source for "maybe move this there"
// (recommendationTriggers reads the `above` flags). Percentages are plain
// numbers rounded to 0.1 — coarse on purpose, like the rest of the surface.

export type ConcentrationDimension = {
  pct: number; // share of the dimension's denominator, 0.1 precision
  valueEUR: Money;
  ceilingPct: number;
  above: boolean;
};

export type ConcentrationValue = {
  investableEUR: Money;
  totalEUR: Money;
  // One entry per held position / per broker account; empty when the
  // denominator is not positive (nothing to classify).
  positions: ({ holdingId: string; isin: string } & ConcentrationDimension)[];
  brokers: ({ accountId: string } & ConcentrationDimension)[];
  realEstate: ConcentrationDimension | null;
  spain: ConcentrationDimension | null;
};

export type ConcentrationHolding = {
  holdingId: string;
  accountId: string;
  isin: string;
  valueEUR: Money;
  inputs: string[];
};

function share(
  value: ReturnType<typeof dec>,
  denominator: ReturnType<typeof dec>,
  ceilingPct: number,
): ConcentrationDimension {
  const pct = Number(value.dividedBy(denominator).times(100).toFixed(1));
  return { pct, valueEUR: money(value), ceilingPct, above: pct > ceilingPct };
}

export function concentration(args: {
  snapshotId: string;
  holdings: ConcentrationHolding[]; // held positions only (qty > 0), valued
  accounts: { id: string; type: string }[];
  cashByAccount: Record<string, Money>;
  netWorth: {
    investableEUR: Money;
    totalEUR: Money;
    illiquidEUR: Money;
  };
  netWorthInputs: string[];
  ceilings?: typeof CONCENTRATION_CEILINGS;
}): CalcResult<ConcentrationValue> {
  const {
    snapshotId,
    holdings,
    accounts,
    cashByAccount,
    netWorth,
    netWorthInputs,
    ceilings = CONCENTRATION_CEILINGS,
  } = args;

  const investable = dec(netWorth.investableEUR);
  const total = dec(netWorth.totalEUR);
  const inputs = new Set<string>(netWorthInputs);

  // Single position: each holding's share of investable assets.
  const positions: ConcentrationValue["positions"] = investable.greaterThan(0)
    ? holdings.map((h) => {
        for (const id of h.inputs) inputs.add(id);
        return {
          holdingId: h.holdingId,
          isin: h.isin,
          ...share(dec(h.valueEUR), investable, ceilings.singlePositionPctOfInvestable),
        };
      })
    : [];

  // Single broker: cash + holdings per broker account, share of investable.
  const brokers: ConcentrationValue["brokers"] = [];
  if (investable.greaterThan(0)) {
    for (const account of accounts) {
      if (account.type !== "broker") continue;
      const holdingsValue = holdings
        .filter((h) => h.accountId === account.id)
        .reduce((acc, h) => acc.plus(dec(h.valueEUR)), dec(0));
      const value = holdingsValue.plus(dec(cashByAccount[account.id] ?? 0));
      inputs.add(account.id);
      brokers.push({
        accountId: account.id,
        ...share(value, investable, ceilings.singleBrokerPctOfInvestable),
      });
    }
  }

  // Real estate: property EQUITY (net of mortgages — netWorth's illiquid
  // bucket) as a share of total net worth.
  const realEstate = total.greaterThan(0)
    ? share(dec(netWorth.illiquidEUR), total, ceilings.realEstatePctOfNetWorth)
    : null;

  // Spain exposure: property equity (properties are assumed Spanish) plus
  // ES-ISIN holdings, share of total net worth. Cash is excluded — its
  // exposure is the currency, not the country.
  const spainHoldings = holdings
    .filter((h) => h.isin.startsWith("ES"))
    .reduce((acc, h) => acc.plus(dec(h.valueEUR)), dec(0));
  const spain = total.greaterThan(0)
    ? share(
        dec(netWorth.illiquidEUR).plus(spainHoldings),
        total,
        ceilings.spainPctOfNetWorth,
      )
    : null;

  return {
    snapshotId,
    value: {
      investableEUR: money(investable),
      totalEUR: money(total),
      positions,
      brokers,
      realEstate,
      spain,
    },
    source: VERSIONS.concentration.source,
    version: VERSIONS.concentration.version,
    inputs: [...inputs],
  };
}
