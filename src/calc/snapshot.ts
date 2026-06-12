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
import { spendCalibration } from "./spendCalibration";
import { status, type StatusValue } from "./status";
import {
  taxES,
  rentalIncome,
  realizedCapitalGains,
  lossCarryForward,
  type TaxESValue,
} from "./taxES";
import { selectTaxConfigs } from "./config/taxRegistry";
import { concentration, type ConcentrationValue } from "./concentration";
import {
  recommendationTriggers,
  type RecommendationTriggersValue,
  type UnrealizedPosition,
} from "./recommendationTriggers";
import { propertyYield, type PropertyYieldValue } from "./propertyYield";
import { standardScenarios, type ScenarioValue } from "./scenario";
import type { CalcResult } from "./types";
import { dec, sum, type Money } from "./money";
import { effectiveMovements } from "./movements";

// Assembles ONE strategic snapshot: derive current state, then run every core
// calculator over it. Pure — `snapshotId`, `asOf` and `reviewDue` are passed in,
// so the same facts always produce the same snapshot. The home page and the
// exit-criterion test both call this.

export type SnapshotFacts = {
  accounts: {
    id: string;
    type: AccountType;
    openingCash: Money;
    openingAsOf: string;
    // Optional display name — used only in human-readable flag labels.
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
  // Dated value statements — re-anchor an account's derivation:
  // value = latest revaluation + movements since its date. Optional: absent ⇒
  // every account derives from its opening baseline.
  revaluations?: DeriveRevaluation[];
  properties: {
    id: string;
    value: Money;
    ownershipPct: Money;
    valuedAt: string;
    rentMonthly: Money;
    costsMonthly: Money;
    isPrimaryResidence: boolean;
    // Optional purchase basis — the sell-property scenario's CG
    // input; absent ⇒ the scenario states the tax as unknown, never 0.
    purchasePrice?: Money | null;
  }[];
  liabilities: { id: string; propertyId: string | null; balance: Money }[];
  assumptions: { id: string; key: string; value: Money; lastReviewedAt: string }[];
  prices: { id: string; isin: string; price: Money; currency: string; asOf: string }[];
  fx: { id: string; quote: string; rate: Money; asOf: string }[];
  monthlySpend: { id: string; month: string; amount: Money; createdAt: string }[];
  // Open tax lots (FIFO basis). Optional: absent ⇒ no realized-gain basis.
  taxLots?: {
    id: string;
    holdingId: string;
    buyDate: string;
    quantity: Money;
    costBasisEUR: Money;
  }[];
  // Forecasts, not facts: consumed ONLY by the scenario engine —
  // the base-case calculators never see them (netWorth's rule).
  plannedEvents?: {
    id: string;
    type: string;
    date: string;
    amount: Money; // a magnitude — the event TYPE owns the direction (2026.6)
    probability: Money;
    includedInBaseCase: boolean;
    realisedAt?: string | null; // absent = not yet realised
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
  taxES: CalcResult<TaxESValue>;
  // Optional only because legacy STORED snapshots lack them;
  // computeSnapshot always fills them (scenarios only at the top level — the
  // counterfactual variants inside the engine don't nest their own).
  concentration?: CalcResult<ConcentrationValue>;
  recommendationTriggers?: CalcResult<RecommendationTriggersValue>;
  scenarios?: CalcResult<ScenarioValue>[];
  // propertyYield.v1 — optional only because earlier STORED snapshots lack it.
  propertyYield?: CalcResult<PropertyYieldValue>;
};

function minDate(dates: string[]): string | null {
  return dates.length === 0 ? null : dates.reduce((a, b) => (a < b ? a : b));
}

export function computeSnapshot(args: {
  snapshotId: string;
  asOf: string;
  reviewDue: boolean;
  facts: SnapshotFacts;
  // Scenario variants recompute the snapshot WITHOUT their own
  // scenario set (no nesting). Display names ride along for scenario labels.
  withScenarios?: boolean;
  propertyNameById?: Record<string, string>;
  holdingNameById?: Record<string, string>;
}): StrategicSnapshot {
  const { snapshotId, asOf, reviewDue, facts, withScenarios = true } = args;

  const derived = deriveState({
    accounts: facts.accounts.map((a) => ({
      id: a.id,
      openingCash: a.openingCash,
      openingAsOf: a.openingAsOf,
    })),
    holdings: facts.holdings.map((h) => ({
      id: h.id,
      accountId: h.accountId,
      openingQuantity: h.openingQuantity,
      openingAsOf: h.openingAsOf,
    })),
    movements: facts.movements,
    revaluations: facts.revaluations,
    asOf,
  });

  const val = valuation({
    snapshotId,
    asOf,
    holdings: facts.holdings.map((h) => ({ id: h.id, isin: h.isin })),
    quantityByHolding: derived.quantityByHolding,
    quantityInputsByHolding: derived.quantityInputsByHolding,
    prices: facts.prices,
    fx: facts.fx,
  });

  const accountByHolding = new Map(facts.holdings.map((h) => [h.id, h.accountId]));
  const nw = netWorth({
    snapshotId,
    accounts: facts.accounts.map((a) => ({ id: a.id, type: a.type })),
    cashByAccount: derived.cashByAccount,
    cashInputsByAccount: derived.cashInputsByAccount,
    holdingValues: val.value.holdings.map((h) => ({
      holdingId: h.holdingId,
      accountId: accountByHolding.get(h.holdingId) ?? "",
      valueEUR: h.valueEUR,
      inputs: h.inputs,
    })),
    properties: facts.properties.map((p) => ({
      id: p.id,
      value: p.value,
      ownershipPct: p.ownershipPct,
    })),
    liabilities: facts.liabilities.map((l) => ({
      id: l.id,
      propertyId: l.propertyId,
      balance: l.balance,
    })),
  });

  // Spend is the coarse ASSUMPTION — entered like the SWR, reviewed
  // yearly. The monthly-spend log only calibrates it (a soft flag below).
  const byKey = (key: string) =>
    facts.assumptions.find((assumption) => assumption.key === key);
  const spendAssumption = byKey("monthlySpend");
  const spendConservative = byKey("monthlySpendConservative");
  const spendOptimistic = byKey("monthlySpendOptimistic");
  const swr = byKey("safeWithdrawalRate");
  // The real-view pair (fire.v2): the NOMINAL expectedReturn and the
  // longRunInflation FORECAST (the ECB-fed `inflation` row is an observation
  // and deliberately not consumed here).
  const expectedReturn = byKey("expectedReturn");
  const longRunInflation = byKey("longRunInflation");

  const fr = fire({
    snapshotId,
    liquidEUR: nw.value.liquidEUR,
    investableEUR: nw.value.investableEUR,
    fireCountedEUR: nw.value.fireCountedEUR,
    monthlySpendEUR: spendAssumption?.value ?? null,
    monthlySpendConservativeEUR: spendConservative?.value ?? null,
    monthlySpendOptimisticEUR: spendOptimistic?.value ?? null,
    safeWithdrawalRate: swr?.value ?? null,
    expectedReturnAnnual: expectedReturn?.value ?? null,
    longRunInflationAnnual: longRunInflation?.value ?? null,
    inputs: [
      ...nw.inputs,
      ...[
        spendAssumption?.id,
        spendConservative?.id,
        spendOptimistic?.id,
        swr?.id,
        expectedReturn?.id,
        longRunInflation?.id,
      ].filter((x): x is string => Boolean(x)),
    ],
  });

  // A quiet ledger can no longer flip the home to Data stale: the spend input
  // is the assumption on its ANNUAL review cadence, not a required monthly log.
  const freshness: FreshnessInput[] = [
    {
      id: spendAssumption?.id ?? "monthly-spend-assumption",
      sourceIds: spendAssumption ? [spendAssumption.id] : undefined,
      label: "Monthly spend assumption",
      lastUpdated: spendAssumption?.lastReviewedAt ?? null,
      cadence: "annually",
      required: true,
    },
  ];

  // Market prices: every CURRENTLY HELD holding (qty > 0) must carry a fresh
  // price. One unpriced/unconvertible holding ⇒ lastUpdated null ⇒ missing;
  // otherwise the OLDEST price in use sets the freshness (weekly grace — the
  // feed updates daily). Required: stale prices make net worth wrong.
  const held = val.value.holdings.filter((h) => Number(h.quantity) > 0);
  if (held.length > 0) {
    const anyUnpriced = held.some((h) => !h.priced || h.valuationAsOf === null);
    freshness.push({
      id: "market-prices",
      sourceIds: held.flatMap((holding) => holding.inputs),
      label: "Market prices",
      lastUpdated: anyUnpriced
        ? null
        : minDate(held.map((h) => h.valuationAsOf as string)),
      cadence: "weekly",
      required: true,
    });
  }

  const propertyValuedAt = minDate(facts.properties.map((p) => p.valuedAt));
  if (facts.properties.length > 0) {
    freshness.push({
      id: "property-valuations",
      sourceIds: facts.properties.map((property) => property.id),
      label: "Property valuations",
      lastUpdated: propertyValuedAt,
      cadence: "quarterly",
      required: false,
    });
  }

  // Pension freshness reads the latest dated revaluation — before
  // revaluations existed a pension went permanently stale with no legal way to
  // update it, since the opening baseline never moves.
  const pension = facts.accounts.find((a) => a.type === "pension");
  if (pension) {
    const pensionRevals = (facts.revaluations ?? []).filter(
      (reval) => reval.accountId === pension.id && reval.valuedAt <= asOf,
    );
    const latestReval =
      pensionRevals.length === 0
        ? null
        : pensionRevals.reduce((a, b) => (a.valuedAt >= b.valuedAt ? a : b));
    freshness.push({
      id: pension.id,
      sourceIds: latestReval ? [pension.id, latestReval.id] : [pension.id],
      label: "Pension value",
      lastUpdated: latestReval?.valuedAt ?? pension.openingAsOf,
      cadence: "quarterly",
      required: false,
    });
  }

  freshness.push({
    id: swr?.id ?? "safe-withdrawal-rate",
    sourceIds: swr ? [swr.id] : undefined,
    label: "Safe withdrawal rate",
    lastUpdated: swr?.lastReviewedAt ?? null,
    cadence: "annually",
    required: true,
  });

  // Tax-table currency: the versioned tables must cover the
  // snapshot's tax year. The registry selects by asOf year, falling back to
  // the latest available tables when the year's haven't landed — and the
  // fallback IS the stale signal here. Year-rollover ⇒ missing immediately;
  // within the covered year the annual cadence doubles as the review
  // reminder. A soft flag (not required): outdated tables make the tax
  // ESTIMATE stale, not net worth — the review proposes the bump.
  const taxConfigs = selectTaxConfigs(Number(asOf.slice(0, 4)));
  freshness.push({
    id: "tax-tables",
    label: `Tax tables (${taxConfigs.income.version}, ${taxConfigs.wealth.version})`,
    lastUpdated:
      Number(asOf.slice(0, 4)) > taxConfigs.income.year
        ? null
        : `${taxConfigs.income.year}-01-01`,
    cadence: "annually",
    required: false,
  });

  // The SWR and the spend family have their own freshness entries above; the
  // conservative/optimistic refinements ride on the base assumption's review.
  const otherAssumptions = facts.assumptions.filter(
    (assumption) =>
      assumption.key !== "safeWithdrawalRate" &&
      !assumption.key.startsWith("monthlySpend"),
  );
  const assumptionsReviewedAt = minDate(
    otherAssumptions.map((a) => a.lastReviewedAt),
  );
  if (otherAssumptions.length > 0) {
    freshness.push({
      id: "assumptions",
      sourceIds: otherAssumptions.map((assumption) => assumption.id),
      label: "Assumptions",
      lastUpdated: assumptionsReviewedAt,
      cadence: "annually",
      required: false,
    });
  }

  // Spend calibration: when enough recent months are logged, their
  // trailing average checks the assumption. Divergence ⇒ a SOFT flag, never
  // Data stale; too few logs ⇒ silence (the log is optional by design).
  const calibration = spendCalibration({
    asOf,
    assumptionEUR: spendAssumption?.value ?? null,
    logs: facts.monthlySpend,
  });
  const flags: SoftFlag[] = [];

  // Negative cash: the symmetric guard to the negative-holding block
  // in quick-log. A warn, not a block — negative cash usually means a missing
  // movement or a one-legged transfer, and honesty beats refusing the entry.
  for (const account of facts.accounts) {
    const cash = derived.cashByAccount[account.id];
    if (cash !== undefined && dec(cash).isNegative()) {
      flags.push({
        id: `negative-cash-${account.id}`,
        sourceIds: derived.cashInputsByAccount[account.id],
        label: `Cash is negative in ${account.name ?? account.id} — a movement may be missing or a transfer one-legged`,
      });
    }
  }

  if (calibration?.divergent) {
    flags.push({
      id: "spend-calibration",
      sourceIds: [
        ...calibration.inputs,
        ...(spendAssumption ? [spendAssumption.id] : []),
      ],
      label: `Spend assumption looks off (logged spend runs ${calibration.divergencePct}% vs the assumption)`,
    });
  }

  const dq = dataQuality({ snapshotId, asOf, inputs: freshness, flags });

  // Tax estimate for the asOf year. Realized capital gains are DERIVED from the
  // ledger: the opening tax-lot baseline + every buy form the FIFO queue, every
  // sell consumes it (so buys/sells you quick-log maintain lots — no re-seeding).
  // Dividends come from `dividend` movements; rental from the rough vivienda
  // model. Pension withdrawals that ACTUALLY happened (withdraw legs on a
  // pension account in the tax year) feed the general base; hypothetical ones
  // stay 0 here and live in scenarios (irreversible, principle #6).
  const taxYear = String(Number(asOf.slice(0, 4)));
  const cg = realizedCapitalGains({
    openingLots: facts.taxLots ?? [],
    movements: facts.movements,
    asOf,
    washSaleWindowMonths: taxConfigs.income.washSaleWindowMonths,
    holdingOpeningAsOf: {
      ...(facts.holdingOpeningAsOf ?? {}),
      ...Object.fromEntries(
        facts.holdings.map((holding) => [holding.id, holding.openingAsOf]),
      ),
    },
  });

  const accountOpeningAsOf = new Map(
    Object.entries({
      ...(facts.accountOpeningAsOf ?? {}),
      ...Object.fromEntries(
        facts.accounts.map((account) => [account.id, account.openingAsOf]),
      ),
    }),
  );
  const dividendMovs = effectiveMovements(facts.movements, asOf).filter(
    (m) =>
      m.type === "dividend" &&
      m.occurredAt.slice(0, 4) === taxYear &&
      m.occurredAt >= (accountOpeningAsOf.get(m.accountId) ?? ""),
  );
  const dividendsEUR = sum(dividendMovs.map((m) => m.amount)).toFixed(2);

  // Realised pension withdrawals: in Spain any rescate is general income. The
  // withdraw leg on a pension-type account is the honest, ledger-derived
  // signal (a pension-to-pension transfer would count too — stated in the
  // config's exclusions).
  const pensionAccountIds = new Set(
    facts.accounts.filter((a) => a.type === "pension").map((a) => a.id),
  );
  const pensionWithdrawalMovs = effectiveMovements(facts.movements, asOf).filter(
    (m) =>
      m.type === "withdraw" &&
      pensionAccountIds.has(m.accountId) &&
      m.occurredAt.slice(0, 4) === taxYear &&
      m.occurredAt >= (accountOpeningAsOf.get(m.accountId) ?? ""),
  );
  const pensionWithdrawalEUR = sum(
    pensionWithdrawalMovs.map((m) => m.amount),
  ).toFixed(2);

  const rental = rentalIncome({
    properties: facts.properties,
    reductionRate: taxConfigs.income.rentalReductionRate,
  });

  // Loss carry-forward: derived by replaying ALL prior years'
  // disposals — no stored tax state. Pre-ledger losses enter via the optional
  // `lossCarryForward` assumption.
  const preLedgerLoss = byKey("lossCarryForward");
  const carry = lossCarryForward({
    perDisposal: cg.perDisposal,
    taxYear,
    preLedgerLossEUR: preLedgerLoss?.value,
  });

  // Wealth tax: IP over the snapshot's net worth. The locked pile
  // IS the pension exemption; the vivienda exemption takes the owner's share
  // of the primary residence's value, capped in the calculator at €300k.
  const primaryResidenceValueEUR = sum(
    facts.properties
      .filter((p) => p.isPrimaryResidence)
      .map((p) => dec(p.value).times(dec(p.ownershipPct)).dividedBy(100).toFixed(2)),
  ).toFixed(2);

  // Family minimums (2026.3): not derivable from the ledger — the optional
  // `familyMinimum` assumption carries them (reviewed on the annual cadence).
  const familyMinimum = byKey("familyMinimum");

  const tax = taxES({
    snapshotId,
    config: taxConfigs.income,
    realizedCapitalGainsEUR: cg.realizedGainEUR,
    dividendsEUR,
    rentalTaxableEUR: rental.taxableEUR,
    pensionWithdrawalEUR,
    lossCarryForwardEUR: carry.availableEUR,
    familyMinimumEUR: familyMinimum?.value,
    wealth: {
      config: taxConfigs.wealth,
      netWorthTotalEUR: nw.value.totalEUR,
      pensionEUR: nw.value.lockedEUR,
      primaryResidenceValueEUR,
    },
    inputs: [
      ...cg.inputs,
      ...dividendMovs.map((m) => m.id),
      ...pensionWithdrawalMovs.map((m) => m.id),
      ...rental.inputs,
      ...nw.inputs,
      ...(preLedgerLoss ? [preLedgerLoss.id] : []),
      ...(familyMinimum ? [familyMinimum.id] : []),
    ],
  });

  const st = status({
    snapshotId,
    runwayMonths: fr.value.runwayMonths,
    monthlySpendEUR: spendAssumption?.value ?? null,
    safeMonthlySpendEUR: fr.value.safeMonthlySpendEUR,
    dataQuality: dq.value,
    reviewDue,
  });

  // Concentration: where the pile clusters, classified against the
  // versioned ceilings. Feeds the recommendation triggers below.
  const heldLines = val.value.holdings.filter((h) =>
    dec(h.quantity).greaterThan(0),
  );
  const conc = concentration({
    snapshotId,
    holdings: heldLines.map((h) => ({
      holdingId: h.holdingId,
      accountId: accountByHolding.get(h.holdingId) ?? "",
      isin: h.isin,
      valueEUR: h.valueEUR,
      inputs: h.inputs,
    })),
    accounts: facts.accounts,
    cashByAccount: derived.cashByAccount,
    netWorth: nw.value,
    netWorthInputs: nw.inputs,
  });

  // Unrealized P/L per held position (open-lot basis vs market value) — the
  // harvestable-losses trigger's input. Unpriced lines are skipped: an honest
  // 0-valued line must not read as a giant harvestable loss.
  const lotsByHolding = new Map<string, { costEUR: ReturnType<typeof dec>; ids: string[] }>();
  for (const lot of cg.remainingLots) {
    const entry = lotsByHolding.get(lot.holdingId) ?? { costEUR: dec(0), ids: [] };
    entry.costEUR = entry.costEUR.plus(dec(lot.costBasisEUR));
    entry.ids.push(lot.id);
    lotsByHolding.set(lot.holdingId, entry);
  }
  const unrealized: UnrealizedPosition[] = heldLines
    .filter((h) => h.priced && lotsByHolding.has(h.holdingId))
    .map((h) => {
      const entry = lotsByHolding.get(h.holdingId)!;
      return {
        holdingId: h.holdingId,
        costBasisEUR: entry.costEUR.toFixed(2),
        valueEUR: h.valueEUR,
        sourceIds: [h.holdingId, ...entry.ids],
      };
    });

  const triggers = recommendationTriggers({
    snapshotId,
    concentration: conc.value,
    liquidEUR: nw.value.liquidEUR,
    monthlySpendEUR: spendAssumption?.value ?? null,
    safeMonthlySpendEUR: fr.value.safeMonthlySpendEUR,
    realizedGainsEUR: cg.realizedGainEUR,
    unrealized,
    inputs: [...conc.inputs, ...fr.inputs],
  });

  // Unlevered property yield vs the assumed real ETF return (propertyYield.v1)
  // — same assumption pair as the fire real view, same degradation rule (the
  // real fields go absent when either assumption is unset).
  const py = propertyYield({
    snapshotId,
    properties: facts.properties,
    expectedReturnAnnual: expectedReturn?.value ?? null,
    longRunInflationAnnual: longRunInflation?.value ?? null,
    inputs: [
      ...facts.properties.map((p) => p.id),
      ...[expectedReturn?.id, longRunInflation?.id].filter(
        (x): x is string => Boolean(x),
      ),
    ],
  });

  const snapshot: StrategicSnapshot = {
    snapshotId,
    asOf,
    valuation: val,
    netWorth: nw,
    fire: fr,
    dataQuality: dq,
    status: st,
    taxES: tax,
    concentration: conc,
    recommendationTriggers: triggers,
    propertyYield: py,
  };

  // The standard decision set: each scenario re-runs this function
  // over transformed facts — withScenarios:false stops the recursion at one
  // level (a counterfactual carries no counterfactuals of its own).
  if (withScenarios) {
    snapshot.scenarios = standardScenarios({
      base: snapshot,
      facts,
      compute: (variantFacts) =>
        computeSnapshot({
          snapshotId,
          asOf,
          reviewDue,
          facts: variantFacts,
          withScenarios: false,
        }),
      propertyNameById: args.propertyNameById,
      holdingNameById: args.holdingNameById,
      yieldByPropertyId: Object.fromEntries(
        py.value.properties.map((line) => [line.propertyId, line]),
      ),
      taxConfig: taxConfigs.income,
    });
  }

  return snapshot;
}
