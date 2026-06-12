import Decimal from "decimal.js";
import { dec, money, quantity, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";
import { SCENARIO_ES_2026 } from "./config/scenarios";
import { TAX_ES_CAT_2026 } from "./config/taxES.es-cat.2026";
import type { TaxConfig } from "./config/taxES.es-cat.2026";
import {
  fifoCapitalGains,
  progressiveTax,
  realizedCapitalGains,
  type Disposal,
} from "./taxES";
import type { ValuationValue } from "./valuation";
import type { NetWorthValue } from "./netWorth";
import type { FireValue } from "./fire";
import type { StatusValue } from "./status";
import type { TaxESValue } from "./taxES";
import type { DeriveMovement } from "./derive";
import type { PropertyYieldLine } from "./propertyYield";
import type { SnapshotFacts } from "./snapshot";

// The scenario engine — the gap between a ledger with commentary and
// the actual gestor. A scenario is a pure, versioned transform over
// SnapshotFacts; the FULL snapshot recomputes over the transformed facts and
// the DIFF (Δ net worth, Δ runway, Δ safe spend, Δ tax) is the advice's
// number. Provenance = the base snapshotId + the fact ids the scenario
// touched. The voice may narrate and compare these; it never originates them
// (invariant #2). Every scenario prints its exclusions next to its figures —
// the models here are deliberately rough (principle #10).

// What a scenario reads from a snapshot. StrategicSnapshot satisfies this
// structurally; declared here (not imported as a value) so snapshot.ts can
// call into this module without a value-level import cycle.
export type ScenarioBaseSnapshot = {
  snapshotId: string;
  asOf: string;
  valuation: CalcResult<ValuationValue>;
  netWorth: CalcResult<NetWorthValue>;
  fire: CalcResult<FireValue>;
  status: CalcResult<StatusValue>;
  taxES: CalcResult<TaxESValue>;
};

// The caller provides the recompute (computeSnapshot with scenarios disabled),
// keeping this module free of I/O and of a circular import.
export type ComputeVariant = (facts: SnapshotFacts) => ScenarioBaseSnapshot;

export type MoneyDelta = { baseEUR: Money; variantEUR: Money; deltaEUR: Money };

export type ScenarioDiff = {
  netWorthTotal: MoneyDelta;
  fireCounted: MoneyDelta;
  runwayYears: {
    base: number | null;
    variant: number | null;
    delta: number | null;
  };
  safeMonthlySpend: {
    baseEUR: Money | null;
    variantEUR: Money | null;
    deltaEUR: Money | null;
  };
  // The asOf tax year's estimate; the variant side INCLUDES the scenario's
  // one-off taxes (sale CG tax, plusvalía) so Δ tax is the honest total.
  taxYear: MoneyDelta;
  status: { base: StatusValue; variant: StatusValue };
};

export type ScenarioBreakdownRow = {
  label: string;
  // null = unknown (e.g. CG tax without a recorded purchase price) — rendered
  // as such, never as 0.
  valueEUR: Money | null;
  // Planned events only: today's purchasing power of the (nominal) amount at
  // the longRunInflation assumption — an illustration; headline totals stay
  // undiscounted face values. Absent when the assumption is unset.
  presentValueEUR?: Money | null;
};

export type ScenarioTranche = {
  year: number;
  quantity: Money;
  proceedsEUR: Money;
  gainEUR: Money;
  taxEUR: Money;
};

export type ScenarioKind = "sell-property" | "sell-position" | "planned-events";

export type ScenarioValue = {
  key: string; // stable id, e.g. "sell-property:<propertyId>"
  kind: ScenarioKind;
  label: string;
  irreversible: boolean; // the manual-review gate applies (principle #9)
  diff: ScenarioDiff;
  // One-off taxes the sale itself triggers (CG + plusvalía); null = unknown.
  oneOffTaxEUR: Money | null;
  proceedsEUR: Money | null; // net cash the scenario moves into the pile
  // Sell-property with no recorded purchase basis (2026.7): the sale taxes are
  // unknown, so proceeds are null and the Δ figures are an UPPER BOUND (they
  // exclude the unknown taxes) — surfaced as a badge, never silently as 0 tax.
  basisIncomplete?: boolean;
  breakdown: ScenarioBreakdownRow[];
  // Sell-position only: the at-once vs spread-over-years comparison.
  tranches?: ScenarioTranche[];
  atOnceTaxEUR?: Money;
  spreadTaxEUR?: Money;
  spreadTaxSavingEUR?: Money;
  // The GROWN spread variant: future tranches priced at today's price grown
  // at the nominal expectedReturn assumption. Present only when that
  // assumption is set; the 0%-growth fields above stay as the comparison and
  // the at-once leg / headline diff NEVER grow (the pile is not marked up).
  tranchesGrown?: ScenarioTranche[];
  spreadTaxGrownEUR?: Money;
  // Neutral difference: atOnceTax − spreadTaxGrown. MAY BE NEGATIVE (growth
  // can make spreading cost more tax) — render "saves"/"costs more" by sign.
  spreadTaxDeltaGrownEUR?: Money;
  grownAtReturnAnnual?: Money; // the assumption, echoed for display
  // Sell-property only (propertyYield.v1): the unlevered yield vs the assumed
  // real ETF return — absent when the assumptions are unset.
  yieldComparison?: PropertyYieldLine;
  exclusions: string[]; // what the rough model leaves out — printed on the card
};

function moneyDelta(
  base: Money,
  variant: Money,
  oneOff: Decimal = new Decimal(0),
): MoneyDelta {
  const v = dec(variant).plus(oneOff);
  return {
    baseEUR: money(base),
    variantEUR: money(v),
    deltaEUR: money(v.minus(dec(base))),
  };
}

function diffSnapshots(
  base: ScenarioBaseSnapshot,
  variant: ScenarioBaseSnapshot,
  oneOffTaxEUR: Money | null,
): ScenarioDiff {
  const baseFire = base.fire.value;
  const variantFire = variant.fire.value;
  const runwayBase = baseFire.runwayYears;
  const runwayVariant = variantFire.runwayYears;
  const safeBase = baseFire.safeMonthlySpendEUR;
  const safeVariant = variantFire.safeMonthlySpendEUR;
  return {
    netWorthTotal: moneyDelta(
      base.netWorth.value.totalEUR,
      variant.netWorth.value.totalEUR,
    ),
    fireCounted: moneyDelta(
      base.netWorth.value.fireCountedEUR,
      variant.netWorth.value.fireCountedEUR,
    ),
    runwayYears: {
      base: runwayBase,
      variant: runwayVariant,
      delta:
        runwayBase === null || runwayVariant === null
          ? null
          : Number((runwayVariant - runwayBase).toFixed(2)),
    },
    safeMonthlySpend: {
      baseEUR: safeBase,
      variantEUR: safeVariant,
      deltaEUR:
        safeBase === null || safeVariant === null
          ? null
          : money(dec(safeVariant).minus(dec(safeBase))),
    },
    taxYear: moneyDelta(
      base.taxES.value.totalTaxEUR,
      variant.taxES.value.totalTaxEUR,
      dec(oneOffTaxEUR ?? 0),
    ),
    status: { base: base.status.value, variant: variant.status.value },
  };
}

function buildResult(args: {
  base: ScenarioBaseSnapshot;
  value: ScenarioValue;
  inputs: string[];
}): CalcResult<ScenarioValue> {
  return {
    snapshotId: args.base.snapshotId,
    value: args.value,
    source: VERSIONS.scenario.source,
    version: VERSIONS.scenario.version,
    inputs: [...new Set(args.inputs)],
  };
}

// Proceeds land in (or leave) real cash: a synthetic movement dated asOf, so
// the derivation applies it regardless of opening baselines or revaluation
// re-anchors. Ids are namespaced so they can never collide with ledger rows.
function cashMovement(
  id: string,
  accountId: string,
  amountEUR: Decimal,
  asOf: string,
): DeriveMovement {
  return {
    id,
    type: amountEUR.isNegative() ? "withdraw" : "deposit",
    accountId,
    holdingId: null,
    quantity: null,
    amount: amountEUR.abs().toFixed(2),
    occurredAt: asOf,
    correctsId: null,
  };
}

// Deterministic destination for scenario cash: the first bank account (by id),
// else the first account of any type.
function targetCashAccount(facts: SnapshotFacts): string | null {
  const sorted = [...facts.accounts].sort((a, b) => (a.id < b.id ? -1 : 1));
  return (sorted.find((a) => a.type === "bank") ?? sorted[0])?.id ?? null;
}

// Marginal Spanish savings-scale tax of an extra gain on top of the year's
// existing savings base. A non-positive gain is 0 — loss offsetting against
// the rest of the base is deliberately not modelled (listed as an exclusion).
function marginalSavingsTax(
  savingsBaseEUR: Money,
  gain: Decimal,
  config: TaxConfig,
): Decimal {
  if (gain.lessThanOrEqualTo(0)) return new Decimal(0);
  const base = Decimal.max(0, dec(savingsBaseEUR));
  return progressiveTax(money(base.plus(gain)), config.savings).minus(
    progressiveTax(money(base), config.savings),
  );
}

// --- Sell a property ---

export function sellPropertyScenario(args: {
  base: ScenarioBaseSnapshot;
  facts: SnapshotFacts;
  compute: ComputeVariant;
  propertyId: string;
  propertyName?: string;
  toAccountId?: string;
  // The property's unlevered-yield-vs-ETF line (propertyYield.v1), surfaced
  // on the card with its own exclusion. Optional — absent when the return/
  // inflation assumptions are unset.
  yieldComparison?: PropertyYieldLine | null;
  config?: typeof SCENARIO_ES_2026;
  taxConfig?: TaxConfig;
}): CalcResult<ScenarioValue> | null {
  const {
    base,
    facts,
    compute,
    propertyId,
    propertyName,
    yieldComparison = null,
    config = SCENARIO_ES_2026,
    taxConfig = TAX_ES_CAT_2026,
  } = args;

  const property = facts.properties.find((p) => p.id === propertyId);
  const accountId = args.toAccountId ?? targetCashAccount(facts);
  if (!property || !accountId) return null;

  const share = dec(property.ownershipPct).dividedBy(100);
  const gross = dec(property.value).times(share);
  const saleCosts = gross.times(dec(config.propertySaleCostsRate));
  const mortgages = facts.liabilities.filter((l) => l.propertyId === propertyId);
  const mortgageDebt = mortgages.reduce(
    (acc, l) => acc.plus(dec(l.balance)),
    new Decimal(0),
  );

  // A non-positive purchase price is an unrecorded basis (a defaulted 0 must
  // never read as "acquired for free"), so the tax is unknown, not enormous.
  const purchasePrice =
    property.purchasePrice != null && dec(property.purchasePrice).greaterThan(0)
      ? property.purchasePrice
      : null;
  const gain =
    purchasePrice === null
      ? null
      : dec(property.value)
          .minus(dec(purchasePrice))
          .times(share)
          .minus(saleCosts);
  const plusvalia =
    gain === null
      ? null
      : gain.greaterThan(0)
        ? gain.times(dec(config.plusvaliaRateOfGain))
        : new Decimal(0);
  // Primary residence: the IRPF gain is assumed exempt (reinvestment in a new
  // vivienda habitual, or the over-65 exemption) — stated in the exclusions.
  const cgTax = property.isPrimaryResidence
    ? new Decimal(0)
    : gain === null
      ? null
      : marginalSavingsTax(base.taxES.value.savingsBaseEUR, gain, taxConfig);

  const oneOffTax =
    cgTax === null || plusvalia === null ? null : cgTax.plus(plusvalia);
  // With no recorded basis the taxes are unknown: the variant recomputes with
  // the PRE-TAX proceeds and every Δ is labelled an upper bound — unknown tax
  // must never silently read as 0 tax.
  const basisIncomplete = oneOffTax === null;
  const netProceeds = gross
    .minus(saleCosts)
    .minus(mortgageDebt)
    .minus(oneOffTax ?? 0);

  const variantFacts: SnapshotFacts = {
    ...facts,
    properties: facts.properties.filter((p) => p.id !== propertyId),
    liabilities: facts.liabilities.filter((l) => l.propertyId !== propertyId),
    movements: [
      ...facts.movements,
      cashMovement(
        `scenario-sell-property-${propertyId}`,
        accountId,
        netProceeds,
        base.asOf,
      ),
    ],
  };
  const variant = compute(variantFacts);

  const exclusions = [
    "plusvalía municipal is a flat rough estimate of the gain",
    property.isPrimaryResidence
      ? "primary-residence CG exemption assumed (reinvestment or over-65) — plusvalía municipal still due"
      : "primary-residence reinvestment and over-65 reliefs not modelled",
  ];
  if (yieldComparison?.realGap != null) {
    exclusions.push(
      "yield comparison is UNLEVERED (mortgage financing not modelled) and the ETF side uses your expectedReturn assumption — a judgment input, never a market prediction",
    );
  }
  if (purchasePrice === null) {
    exclusions.unshift(
      property.isPrimaryResidence
        ? "plusvalía unknown — no purchase price recorded"
        : "capital-gains tax and plusvalía unknown — no purchase price recorded",
    );
  }
  if (basisIncomplete) {
    exclusions.unshift(
      "Δ figures EXCLUDE the unknown sale taxes — treat them as an upper bound",
    );
  }

  return buildResult({
    base,
    inputs: [propertyId, ...mortgages.map((l) => l.id), accountId],
    value: {
      key: `sell-property:${propertyId}`,
      kind: "sell-property",
      label: `Sell ${propertyName ?? "property"}`,
      irreversible: true,
      diff: diffSnapshots(base, variant, money(oneOffTax ?? 0)),
      oneOffTaxEUR: oneOffTax === null ? null : money(oneOffTax),
      proceedsEUR: basisIncomplete ? null : money(netProceeds),
      ...(basisIncomplete ? { basisIncomplete: true } : {}),
      breakdown: [
        { label: "Gross sale (owner share)", valueEUR: money(gross) },
        { label: "Selling costs", valueEUR: money(saleCosts.negated()) },
        { label: "Mortgage repaid", valueEUR: money(mortgageDebt.negated()) },
        {
          label: "Capital-gains tax (savings scale)",
          valueEUR: cgTax === null ? null : money(cgTax.negated()),
        },
        {
          label: "Plusvalía municipal (rough)",
          valueEUR: plusvalia === null ? null : money(plusvalia.negated()),
        },
        {
          label: "Net proceeds to cash",
          valueEUR: basisIncomplete ? null : money(netProceeds),
        },
      ],
      ...(yieldComparison ? { yieldComparison } : {}),
      exclusions,
    },
  });
}

// --- Sell a position (at once vs spread over years) ---

export function sellPositionScenario(args: {
  base: ScenarioBaseSnapshot;
  facts: SnapshotFacts;
  compute: ComputeVariant;
  holdingId: string;
  holdingName?: string;
  config?: typeof SCENARIO_ES_2026;
  taxConfig?: TaxConfig;
}): CalcResult<ScenarioValue> | null {
  const {
    base,
    facts,
    compute,
    holdingId,
    holdingName,
    config = SCENARIO_ES_2026,
    taxConfig = TAX_ES_CAT_2026,
  } = args;

  const holding = facts.holdings.find((h) => h.id === holdingId);
  const line = base.valuation.value.holdings.find(
    (h) => h.holdingId === holdingId,
  );
  if (!holding || !line || !line.priced) return null;
  const qty = dec(line.quantity);
  if (qty.lessThanOrEqualTo(0)) return null;

  const price = dec(line.priceEUR);
  const grossProceeds = qty.times(price);

  // The position's open lots TODAY: the same ledger replay the tax estimate
  // uses (opening lots + buys, consumed by every sell so far).
  const replay = realizedCapitalGains({
    openingLots: facts.taxLots ?? [],
    movements: facts.movements,
    asOf: base.asOf,
    washSaleWindowMonths: taxConfig.washSaleWindowMonths,
    holdingOpeningAsOf: {
      ...(facts.holdingOpeningAsOf ?? {}),
      ...Object.fromEntries(facts.holdings.map((h) => [h.id, h.openingAsOf])),
    },
  });
  const openLots = replay.remainingLots.filter((l) => l.holdingId === holdingId);

  // At once: total gain, marginal on top of this year's savings base.
  const atOnce = fifoCapitalGains({
    lots: openLots,
    disposals: [
      {
        id: "at-once",
        holdingId,
        quantity: quantity(qty),
        proceedsEUR: money(grossProceeds),
        date: base.asOf,
      },
    ],
    washSaleWindowMonths: taxConfig.washSaleWindowMonths,
  });
  const atOnceTax = marginalSavingsTax(
    base.taxES.value.savingsBaseEUR,
    dec(atOnce.realizedGainEUR),
    taxConfig,
  );

  // Spread: equal tranches over N calendar years at TODAY's price, FIFO
  // continuing across tranches. Year one taxes marginally on top of this
  // year's savings base; later years tax the tranche standalone.
  const years = config.positionSpreadYears;
  const startYear = Number(base.asOf.slice(0, 4));
  const perTranche = qty.dividedBy(years);
  const disposals: Disposal[] = Array.from({ length: years }, (_, i) => {
    const q =
      i === years - 1 ? qty.minus(perTranche.times(years - 1)) : perTranche;
    return {
      id: `tranche-${startYear + i}`,
      holdingId,
      quantity: quantity(q),
      proceedsEUR: money(q.times(price)),
      date: i === 0 ? base.asOf : `${startYear + i}-06-30`,
    };
  });
  const spread = fifoCapitalGains({
    lots: openLots,
    disposals,
    washSaleWindowMonths: taxConfig.washSaleWindowMonths,
  });
  const tranches: ScenarioTranche[] = spread.disposals.map((d, i) => {
    const gain = dec(d.gainEUR);
    const tax =
      i === 0
        ? marginalSavingsTax(base.taxES.value.savingsBaseEUR, gain, taxConfig)
        : progressiveTax(money(Decimal.max(0, gain)), taxConfig.savings);
    return {
      year: startYear + i,
      quantity: d.quantity,
      proceedsEUR: d.proceedsEUR,
      gainEUR: d.gainEUR,
      taxEUR: money(tax),
    };
  });
  const spreadTax = tranches.reduce(
    (acc, t) => acc.plus(dec(t.taxEUR)),
    new Decimal(0),
  );

  // The GROWN spread variant: tranche i sells at price·(1+r)^i — whole-year
  // exponent, documented rough like the mid-year tranche dates. r is the
  // nominal expectedReturn ASSUMPTION; the at-once leg and the snapshot diff
  // stay at today's price (growth never inflates the headline — the pile is
  // not marked up; only this tax comparison uses the assumption).
  const returnRow =
    facts.assumptions.find((a) => a.key === "expectedReturn") ?? null;
  let grown: {
    tranches: ScenarioTranche[];
    spreadTaxGrown: Decimal;
    returnRowId: string;
    returnAnnual: Money;
  } | null = null;
  if (returnRow !== null) {
    const onePlusR = dec(1).plus(dec(returnRow.value));
    if (onePlusR.greaterThan(0)) {
      const grownDisposals: Disposal[] = disposals.map((d, i) => ({
        ...d,
        id: `tranche-grown-${startYear + i}`,
        proceedsEUR: money(
          dec(d.quantity).times(price.times(onePlusR.pow(i))),
        ),
      }));
      const grownSpread = fifoCapitalGains({
        lots: openLots,
        disposals: grownDisposals,
        washSaleWindowMonths: taxConfig.washSaleWindowMonths,
      });
      const tranchesGrown: ScenarioTranche[] = grownSpread.disposals.map(
        (d, i) => {
          const gain = dec(d.gainEUR);
          const tax =
            i === 0
              ? marginalSavingsTax(
                  base.taxES.value.savingsBaseEUR,
                  gain,
                  taxConfig,
                )
              : progressiveTax(money(Decimal.max(0, gain)), taxConfig.savings);
          return {
            year: startYear + i,
            quantity: d.quantity,
            proceedsEUR: d.proceedsEUR,
            gainEUR: d.gainEUR,
            taxEUR: money(tax),
          };
        },
      );
      grown = {
        tranches: tranchesGrown,
        spreadTaxGrown: tranchesGrown.reduce(
          (acc, t) => acc.plus(dec(t.taxEUR)),
          new Decimal(0),
        ),
        returnRowId: returnRow.id,
        returnAnnual: returnRow.value,
      };
    }
  }

  // The snapshot diff models the AT-ONCE sale: a synthetic sell movement, so
  // the variant's own FIFO tax estimate picks the gain up deterministically.
  const variantFacts: SnapshotFacts = {
    ...facts,
    movements: [
      ...facts.movements,
      {
        id: `scenario-sell-position-${holdingId}`,
        type: "sell",
        accountId: holding.accountId,
        holdingId,
        quantity: quantity(qty),
        amount: money(grossProceeds),
        occurredAt: base.asOf,
        correctsId: null,
      },
    ],
  };
  const variant = compute(variantFacts);

  return buildResult({
    base,
    inputs: [
      holdingId,
      ...openLots.map((l) => l.id),
      ...line.inputs,
      ...(grown ? [grown.returnRowId] : []),
    ],
    value: {
      key: `sell-position:${holdingId}`,
      kind: "sell-position",
      label: `Sell all ${holdingName ?? line.isin}`,
      irreversible: true,
      diff: diffSnapshots(base, variant, null),
      oneOffTaxEUR: money(atOnceTax),
      proceedsEUR: money(grossProceeds.minus(atOnceTax)),
      breakdown: [
        { label: "Gross proceeds at today's price", valueEUR: money(grossProceeds) },
        { label: "Realized gain (FIFO)", valueEUR: money(atOnce.realizedGainEUR) },
        {
          label: "Capital-gains tax if sold at once",
          valueEUR: money(atOnceTax.negated()),
        },
        {
          label: `Capital-gains tax spread over ${years} years`,
          valueEUR: money(spreadTax.negated()),
        },
      ],
      tranches,
      atOnceTaxEUR: money(atOnceTax),
      spreadTaxEUR: money(spreadTax),
      spreadTaxSavingEUR: money(atOnceTax.minus(spreadTax)),
      ...(grown
        ? {
            tranchesGrown: grown.tranches,
            spreadTaxGrownEUR: money(grown.spreadTaxGrown),
            spreadTaxDeltaGrownEUR: money(
              atOnceTax.minus(grown.spreadTaxGrown),
            ),
            grownAtReturnAnnual: grown.returnAnnual,
          }
        : {}),
      exclusions: [
        grown
          ? "0%-growth tranches assume today's price; the grown variant uses your expectedReturn assumption (a judgment input, never a market prediction); both assume today's tax tables"
          : "future tranches assume today's price and tax tables",
        "future-year savings income assumed zero outside the tranche",
        "broker fees not modelled; wash-sale deferrals apply as in the tax estimate (recent repurchases defer a loss)",
      ],
    },
  });
}

// --- Planned events (base case vs optimistic) ---

export function plannedEventsScenario(args: {
  base: ScenarioBaseSnapshot;
  facts: SnapshotFacts;
  compute: ComputeVariant;
  mode: "base" | "optimistic";
}): CalcResult<ScenarioValue> | null {
  const { base, facts, compute, mode } = args;
  const accountId = targetCashAccount(facts);
  if (!accountId) return null;

  // Forecasts, not facts (docs/data-model.md): unrealised events only — the
  // base case honors includedInBaseCase, optimistic adds the rest at full
  // amount (probabilities deliberately not weighted; listed as an exclusion).
  const events = (facts.plannedEvents ?? []).filter(
    (e) => !e.realisedAt && (mode === "optimistic" || e.includedInBaseCase),
  );
  if (events.length === 0) return null;

  // Today's-purchasing-power illustration per event row, at the
  // longRunInflation FORECAST assumption. yearsUntil = max(0, days)/365.25;
  // a past-dated unrealised event discounts by factor 1. Headline totals
  // remain undiscounted face values.
  const inflationRow =
    facts.assumptions.find((a) => a.key === "longRunInflation") ?? null;
  const onePlusI =
    inflationRow === null ? null : dec(1).plus(dec(inflationRow.value));
  const presentValue = (amount: Money, date: string): Money | null => {
    if (onePlusI === null || !onePlusI.greaterThan(0)) return null;
    const days =
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${base.asOf}T00:00:00Z`)) /
      86400000;
    const years = Math.max(0, days) / 365.25;
    return money(dec(amount).dividedBy(onePlusI.pow(years)));
  };

  // Direction by event type (2026.6): each kind has the inherent sign its
  // realisation would write — a purchase can never read as a windfall.
  const pensionAccountId =
    [...facts.accounts]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .find((a) => a.type === "pension")?.id ?? null;

  const syntheticMovements: DeriveMovement[] = [];
  const syntheticProperties: SnapshotFacts["properties"] = [];
  const breakdown: ScenarioBreakdownRow[] = [];
  const extraExclusions = new Set<string>();
  const extraInputs: string[] = [];
  let netCash = new Decimal(0);

  for (const e of events) {
    // The entered amount is a magnitude — the TYPE owns the sign, so a
    // purchase can never read as a windfall however it was entered.
    const amount = dec(e.amount).abs();
    const rowLabel = `${e.type.replace(/_/g, " ")} · ${e.date}`;
    const pvField = (signed: Decimal) => {
      const pv = presentValue(money(signed), e.date);
      return pv === null ? {} : { presentValueEUR: pv };
    };

    switch (e.type) {
      // Cash leaves and an illiquid property of the same value appears —
      // wealth-neutral in nominal terms; fireCounted/runway drop honestly.
      case "house_purchase": {
        syntheticMovements.push(
          cashMovement(
            `scenario-planned-${mode}-${e.id}`,
            accountId,
            amount.negated(),
            base.asOf,
          ),
        );
        syntheticProperties.push({
          id: `scenario-planned-house-${e.id}`,
          value: money(amount),
          ownershipPct: "100",
          valuedAt: base.asOf,
          rentMonthly: "0",
          costsMonthly: "0",
          isPrimaryResidence: false,
          purchasePrice: money(amount),
        });
        netCash = netCash.minus(amount);
        breakdown.push({ label: rowLabel, valueEUR: money(amount.negated()), ...pvField(amount.negated()) });
        extraExclusions.add(
          "a house purchase swaps cash for an illiquid property at face value — purchase costs and taxes on top are not modelled",
        );
        break;
      }
      // Locked pension money becomes cash: both legs, so net worth stays flat
      // while fireCounted/runway rise — and the variant's tax estimate counts
      // the withdraw leg as a rescate in this year's general base.
      case "pension_withdrawal": {
        if (pensionAccountId) {
          syntheticMovements.push(
            cashMovement(
              `scenario-planned-${mode}-${e.id}-out`,
              pensionAccountId,
              amount.negated(),
              base.asOf,
            ),
            cashMovement(
              `scenario-planned-${mode}-${e.id}-in`,
              accountId,
              amount,
              base.asOf,
            ),
          );
          extraInputs.push(pensionAccountId);
          extraExclusions.add(
            "a pension withdrawal moves locked pension money into cash (wealth-neutral before tax); the Δ tax row carries the rescate",
          );
        } else {
          syntheticMovements.push(
            cashMovement(`scenario-planned-${mode}-${e.id}`, accountId, amount, base.asOf),
          );
          extraExclusions.add(
            "no pension account exists — the pension withdrawal is applied as a plain cash inflow",
          );
        }
        netCash = netCash.plus(amount);
        breakdown.push({ label: rowLabel, valueEUR: money(amount), ...pvField(amount) });
        break;
      }
      // The forecast isn't linked to a property fact, so only the cash side
      // can be modelled here — stated, and pointed at the real scenario.
      case "property_sale": {
        syntheticMovements.push(
          cashMovement(`scenario-planned-${mode}-${e.id}`, accountId, amount, base.asOf),
        );
        netCash = netCash.plus(amount);
        breakdown.push({ label: rowLabel, valueEUR: money(amount), ...pvField(amount) });
        extraExclusions.add(
          "a planned property sale is not linked to a property fact — the property is not removed, so the Δ overstates net worth; use the sell-property scenario for the full swap",
        );
        break;
      }
      // No money moves by itself.
      case "job_exit":
      case "rental_start": {
        breakdown.push({ label: rowLabel, valueEUR: null });
        extraExclusions.add(
          "job exit / rental start move no money by themselves — review the spend and rent assumptions instead",
        );
        break;
      }
      // inheritance (and any future kind): money arrives.
      default: {
        syntheticMovements.push(
          cashMovement(`scenario-planned-${mode}-${e.id}`, accountId, amount, base.asOf),
        );
        netCash = netCash.plus(amount);
        breakdown.push({ label: rowLabel, valueEUR: money(amount), ...pvField(amount) });
      }
    }
  }

  const variantFacts: SnapshotFacts = {
    ...facts,
    movements: [...facts.movements, ...syntheticMovements],
    properties: [...facts.properties, ...syntheticProperties],
  };
  const variant = compute(variantFacts);

  return buildResult({
    base,
    inputs: [
      ...events.map((e) => e.id),
      accountId,
      ...extraInputs,
      ...(onePlusI !== null && inflationRow !== null ? [inflationRow.id] : []),
    ],
    value: {
      key: `planned-events:${mode}`,
      kind: "planned-events",
      label:
        mode === "base"
          ? "Planned events (base case)"
          : "Planned events (optimistic)",
      irreversible: false,
      diff: diffSnapshots(base, variant, null),
      oneOffTaxEUR: null,
      proceedsEUR: money(netCash),
      breakdown,
      exclusions: [
        "event amounts are forecasts you entered, applied at face value with each type's inherent direction",
        "probabilities not weighted; amounts apply as of today regardless of the event date",
        ...extraExclusions,
        ...(onePlusI !== null
          ? [
              "today's-purchasing-power figures use your longRunInflation assumption; headline totals remain undiscounted face values",
            ]
          : []),
      ],
    },
  });
}

// --- The standard decision set the snapshot carries ---

// One scenario per live property, per held priced position, plus the planned-
// event base/optimistic views. Pure: names come in as plain maps so this stays
// importable from computeSnapshot without touching the server layer.
export function standardScenarios(args: {
  base: ScenarioBaseSnapshot;
  facts: SnapshotFacts;
  compute: ComputeVariant;
  propertyNameById?: Record<string, string>;
  holdingNameById?: Record<string, string>;
  // propertyYield.v1 lines by property id — ride onto the sell-property cards.
  yieldByPropertyId?: Record<string, PropertyYieldLine>;
  // The tax tables the snapshot selected for its asOf year (the registry's
  // pick) — defaults to 2026 for direct callers.
  taxConfig?: TaxConfig;
}): CalcResult<ScenarioValue>[] {
  const {
    base,
    facts,
    compute,
    propertyNameById = {},
    holdingNameById = {},
    yieldByPropertyId = {},
    taxConfig = TAX_ES_CAT_2026,
  } = args;

  const held = new Set(
    base.valuation.value.holdings
      .filter((h) => h.priced && dec(h.quantity).greaterThan(0))
      .map((h) => h.holdingId),
  );

  return [
    ...facts.properties.map((p) =>
      sellPropertyScenario({
        base,
        facts,
        compute,
        propertyId: p.id,
        propertyName: propertyNameById[p.id],
        yieldComparison: yieldByPropertyId[p.id] ?? null,
        taxConfig,
      }),
    ),
    ...facts.holdings
      .filter((h) => held.has(h.id))
      .map((h) =>
        sellPositionScenario({
          base,
          facts,
          compute,
          holdingId: h.id,
          holdingName: holdingNameById[h.id],
          taxConfig,
        }),
      ),
    plannedEventsScenario({ base, facts, compute, mode: "base" }),
    plannedEventsScenario({ base, facts, compute, mode: "optimistic" }),
  ].filter((s): s is CalcResult<ScenarioValue> => s !== null);
}
