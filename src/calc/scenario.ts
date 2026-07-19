import Decimal from "decimal.js";
import { dec, formatEURCoarse, money, quantity, type Money } from "./money";
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
import { mortgageTerms, type MortgageValue } from "./mortgage";
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

export type ScenarioKind =
  | "sell-property"
  | "sell-position"
  | "planned-events"
  | "buy-house";

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
  // Buy-house only: the mortgage terms (mortgage.v1) and the funding plan.
  mortgage?: MortgageValue;
  fundingSales?: {
    holdingId: string;
    grossEUR: Money;
    gainEUR: Money;
  }[];
  // Upfront cash the plan could not cover from liquid cash + funding sales —
  // rendered as such, never silently absorbed.
  uncoveredShortfallEUR?: Money;
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

// The sale arithmetic, shared between the sell-property scenario and the
// buy-house scenario's chained sale: gross owner share, selling costs,
// mortgage repayment, CG tax (marginal on the savings scale, primary-residence
// exemption assumed), rough plusvalía, and the basisIncomplete flag when no
// purchase price is recorded (unknown tax must never read as 0).
type PropertySaleTerms = {
  property: SnapshotFacts["properties"][number];
  mortgages: SnapshotFacts["liabilities"];
  gross: Decimal;
  saleCosts: Decimal;
  mortgageDebt: Decimal;
  gain: Decimal | null;
  plusvalia: Decimal | null;
  cgTax: Decimal | null;
  oneOffTax: Decimal | null;
  basisIncomplete: boolean;
  netProceeds: Decimal;
};

function propertySaleTerms(args: {
  base: ScenarioBaseSnapshot;
  facts: SnapshotFacts;
  propertyId: string;
  config: typeof SCENARIO_ES_2026;
  taxConfig: TaxConfig;
}): PropertySaleTerms | null {
  const { base, facts, propertyId, config, taxConfig } = args;
  const property = facts.properties.find((p) => p.id === propertyId);
  if (!property) return null;

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
  // With no recorded basis the taxes are unknown: proceeds run PRE-TAX and the
  // caller labels every Δ an upper bound — unknown tax never reads as 0 tax.
  const basisIncomplete = oneOffTax === null;
  const netProceeds = gross
    .minus(saleCosts)
    .minus(mortgageDebt)
    .minus(oneOffTax ?? 0);

  return {
    property,
    mortgages,
    gross,
    saleCosts,
    mortgageDebt,
    gain,
    plusvalia,
    cgTax,
    oneOffTax,
    basisIncomplete,
    netProceeds,
  };
}

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

  const accountId = args.toAccountId ?? targetCashAccount(facts);
  const terms = propertySaleTerms({ base, facts, propertyId, config, taxConfig });
  if (!terms || !accountId) return null;
  const {
    property,
    mortgages,
    gross,
    saleCosts,
    mortgageDebt,
    cgTax,
    plusvalia,
    oneOffTax,
    basisIncomplete,
    netProceeds,
  } = terms;
  const purchasePrice =
    property.purchasePrice != null && dec(property.purchasePrice).greaterThan(0)
      ? property.purchasePrice
      : null;

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

// --- Buy a house (parameterized — the Ask tool's scenario) ---

export type BuyHouseParams = {
  priceEUR: Money;
  // Share of the price paid upfront (e.g. "0.20"); the rest is mortgaged.
  downPaymentRate: Money;
  mortgageRateAnnual: Money; // e.g. "0.03"
  termYears: number;
  // Sell just enough of these positions (in the given order, each capped at
  // the full position) to cover the upfront cash need beyond liquid cash.
  fundFromHoldingIds?: string[];
  // Chain the sale of an existing property first (a move, not a second home).
  sellPropertyId?: string;
  // Monthly rent that disappears on purchase — nets against the payment in
  // the adjusted monthlySpend assumption.
  monthlyRentSavedEUR?: Money;
  isPrimaryResidence?: boolean;
};

// The composed purchase: ITP at the progressive Cataluña scale + rough other
// costs, a French-amortization mortgage whose payment raises the monthlySpend
// assumption (so Δ runway is honest), upfront cash from liquid cash first,
// then optional funding sales (FIFO CG tax due next year), then an optional
// chained sale of an existing property. The full snapshot recomputes over the
// transformed facts; the diff is the advice's number.
export function buyHouseScenario(args: {
  base: ScenarioBaseSnapshot;
  facts: SnapshotFacts;
  compute: ComputeVariant;
  params: BuyHouseParams;
  holdingNameById?: Record<string, string>;
  propertyNameById?: Record<string, string>;
  config?: typeof SCENARIO_ES_2026;
  taxConfig?: TaxConfig;
}): CalcResult<ScenarioValue> | null {
  const {
    base,
    facts,
    compute,
    params,
    holdingNameById = {},
    propertyNameById = {},
    config = SCENARIO_ES_2026,
    taxConfig = TAX_ES_CAT_2026,
  } = args;

  const price = dec(params.priceEUR);
  const accountId = targetCashAccount(facts);
  if (!accountId || price.lessThanOrEqualTo(0) || params.termYears <= 0)
    return null;
  const downRate = Decimal.min(Decimal.max(dec(params.downPaymentRate), 0), 1);

  const itp = progressiveTax(money(price), config.propertyPurchaseItpScale);
  const otherCosts = price.times(dec(config.propertyPurchaseCostsRate));
  const downPayment = price.times(downRate);
  const principal = price.minus(downPayment);
  const upfront = downPayment.plus(itp).plus(otherCosts);

  const mortgage = mortgageTerms({
    snapshotId: base.snapshotId,
    principalEUR: money(principal),
    rateAnnual: params.mortgageRateAnnual,
    termYears: params.termYears,
  });
  const payment = dec(mortgage.value.monthlyPaymentEUR);

  const inputs: string[] = [accountId];
  const exclusions: string[] = [
    "ITP at the Cataluña general progressive scale (Decreto-ley 5/2025) — reduced rates (young buyers, VPO, familia numerosa, disability) and the 20% large-holder rate are not modelled; a NEW BUILD pays IVA 10% + AJD instead",
    "other purchase costs are a flat rough rate (notary, registry, gestoría, appraisal)",
    "the mortgage balance stays constant in the snapshot — amortization is not credited back over time; the payment enters through the monthlySpend assumption",
  ];
  const breakdown: ScenarioBreakdownRow[] = [
    { label: "Purchase price", valueEUR: money(price.negated()) },
    { label: "ITP (progressive scale)", valueEUR: money(itp.negated()) },
    {
      label: "Other purchase costs (rough)",
      valueEUR: money(otherCosts.negated()),
    },
    { label: "Mortgage principal (borrowed)", valueEUR: money(principal) },
    { label: "Upfront cash needed", valueEUR: money(upfront.negated()) },
    {
      label: "Monthly mortgage payment",
      valueEUR: money(payment.negated()),
    },
    {
      label: "Monthly payment at +2pt stress",
      valueEUR: money(dec(mortgage.value.stress.monthlyPaymentEUR).negated()),
    },
  ];

  const movements: DeriveMovement[] = [];
  let variantProperties = [...facts.properties];
  let variantLiabilities = [...facts.liabilities];

  // 1. Chained sale of an existing property (all of its sale arithmetic and
  // exclusions come from the shared sale terms).
  let chainedTax: Decimal | null = new Decimal(0);
  let basisIncomplete = false;
  let chainedProceeds = new Decimal(0);
  if (params.sellPropertyId) {
    const sale = propertySaleTerms({
      base,
      facts,
      propertyId: params.sellPropertyId,
      config,
      taxConfig,
    });
    if (!sale) return null;
    const soldName =
      propertyNameById[params.sellPropertyId] ?? "current property";
    chainedProceeds = sale.netProceeds;
    chainedTax = sale.oneOffTax;
    basisIncomplete = sale.basisIncomplete;
    variantProperties = variantProperties.filter(
      (p) => p.id !== params.sellPropertyId,
    );
    variantLiabilities = variantLiabilities.filter(
      (l) => l.propertyId !== params.sellPropertyId,
    );
    movements.push(
      cashMovement(
        `scenario-buy-house-sale-${params.sellPropertyId}`,
        accountId,
        sale.netProceeds,
        base.asOf,
      ),
    );
    inputs.push(params.sellPropertyId, ...sale.mortgages.map((l) => l.id));
    breakdown.push({
      label: `Net proceeds — selling ${soldName}`,
      valueEUR: sale.basisIncomplete ? null : money(sale.netProceeds),
    });
    exclusions.push(
      "the chained sale uses the sell-property model: rough plusvalía, primary-residence CG exemption assumed where it applies",
    );
    if (sale.basisIncomplete) {
      exclusions.unshift(
        "the chained sale's taxes are unknown (no purchase price recorded) — Δ figures are an upper bound",
      );
    }
  }

  // 2. Funding sales: liquid cash (plus chained proceeds) is assumed spendable
  // first; the listed positions sell only the remaining gap, in order.
  const available = Decimal.max(0, dec(base.netWorth.value.liquidEUR)).plus(
    chainedProceeds,
  );
  let gap = Decimal.max(0, upfront.minus(available));
  const fundingSales: NonNullable<ScenarioValue["fundingSales"]> = [];
  let fundingCgTax = new Decimal(0);
  if (gap.greaterThan(0) && (params.fundFromHoldingIds ?? []).length > 0) {
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
    const disposals: Disposal[] = [];
    const lots = replay.remainingLots;
    for (const holdingId of params.fundFromHoldingIds ?? []) {
      if (gap.lessThanOrEqualTo(0)) break;
      const holding = facts.holdings.find((h) => h.id === holdingId);
      const line = base.valuation.value.holdings.find(
        (h) => h.holdingId === holdingId,
      );
      if (!holding || !line || !line.priced) continue;
      const qty = dec(line.quantity);
      const unitPrice = dec(line.priceEUR);
      const positionValue = qty.times(unitPrice);
      if (positionValue.lessThanOrEqualTo(0)) continue;
      const gross = Decimal.min(gap, positionValue);
      const soldQty = gross.dividedBy(unitPrice);
      disposals.push({
        id: `buy-house-fund-${holdingId}`,
        holdingId,
        quantity: quantity(soldQty),
        proceedsEUR: money(gross),
        date: base.asOf,
      });
      movements.push(
        {
          id: `scenario-buy-house-fund-${holdingId}`,
          type: "sell",
          accountId: holding.accountId,
          holdingId,
          quantity: quantity(soldQty),
          amount: money(gross),
          occurredAt: base.asOf,
          correctsId: null,
        },
        // Proceeds move from the broker account to the cash target so the
        // purchase withdrawal below draws on one pile.
        cashMovement(
          `scenario-buy-house-fund-out-${holdingId}`,
          holding.accountId,
          gross.negated(),
          base.asOf,
        ),
        cashMovement(
          `scenario-buy-house-fund-in-${holdingId}`,
          accountId,
          gross,
          base.asOf,
        ),
      );
      inputs.push(
        holdingId,
        ...lots.filter((l) => l.holdingId === holdingId).map((l) => l.id),
        ...line.inputs,
      );
      gap = gap.minus(gross);
      fundingSales.push({
        holdingId,
        grossEUR: money(gross),
        gainEUR: "0.00", // filled from the FIFO result below
      });
    }
    if (disposals.length > 0) {
      const fifo = fifoCapitalGains({
        lots,
        disposals,
        washSaleWindowMonths: taxConfig.washSaleWindowMonths,
      });
      for (const [i, d] of fifo.disposals.entries()) {
        fundingSales[i].gainEUR = d.gainEUR;
        breakdown.push({
          label: `Sold to fund — ${holdingNameById[disposals[i].holdingId] ?? disposals[i].holdingId}`,
          valueEUR: d.proceedsEUR,
        });
      }
      fundingCgTax = marginalSavingsTax(
        base.taxES.value.savingsBaseEUR,
        dec(fifo.realizedGainEUR),
        taxConfig,
      );
      breakdown.push({
        label: "CG tax on funding sales (due next year)",
        valueEUR: money(fundingCgTax.negated()),
      });
      exclusions.push(
        "liquid cash is assumed spendable down to zero before any funding sale; the funding sale's CG tax is due next year and is not itself funded by further selling",
      );
    }
  }
  const uncovered = gap;
  if (uncovered.greaterThan(0)) {
    breakdown.push({
      label: "Uncovered cash shortfall",
      valueEUR: money(uncovered.negated()),
    });
  }

  // 3. The purchase itself: upfront cash out, the property in at face value,
  // the mortgage as a new liability.
  movements.push(
    cashMovement(
      "scenario-buy-house-upfront",
      accountId,
      upfront.negated(),
      base.asOf,
    ),
  );
  variantProperties = [
    ...variantProperties,
    {
      id: "scenario-buy-house-property",
      value: money(price),
      ownershipPct: "100",
      valuedAt: base.asOf,
      rentMonthly: "0",
      costsMonthly: "0",
      isPrimaryResidence: params.isPrimaryResidence ?? true,
      purchasePrice: money(price),
    },
  ];
  if (principal.greaterThan(0)) {
    variantLiabilities = [
      ...variantLiabilities,
      {
        id: "scenario-buy-house-mortgage",
        propertyId: "scenario-buy-house-property",
        balance: money(principal),
      },
    ];
  }

  // 4. The payment (net of any rent it replaces) raises the monthlySpend
  // assumption so runway, safe spend and status react honestly.
  const rentSaved = dec(params.monthlyRentSavedEUR ?? 0);
  const spendDelta = Decimal.max(0, payment.minus(rentSaved));
  const spendRow = facts.assumptions.find((a) => a.key === "monthlySpend");
  const variantAssumptions = spendRow
    ? facts.assumptions.map((a) =>
        a.key === "monthlySpend"
          ? { ...a, value: money(Decimal.max(0, dec(a.value).plus(spendDelta))) }
          : a,
      )
    : facts.assumptions;
  if (spendRow) inputs.push(spendRow.id);
  if (rentSaved.greaterThan(0)) {
    exclusions.push(
      "the monthly rent you stop paying nets against the mortgage payment in the adjusted spend",
    );
  } else {
    exclusions.push(
      "no rent replacement assumed — if you currently rent, pass the rent so the payment nets against it",
    );
  }

  const variantFacts: SnapshotFacts = {
    ...facts,
    properties: variantProperties,
    liabilities: variantLiabilities,
    movements: [...facts.movements, ...movements],
    assumptions: variantAssumptions,
  };
  const variant = compute(variantFacts);

  // Δ tax carries the one-off ITP and the chained sale's taxes; the funding
  // sales' CG is NOT added here — the variant's own tax estimate already picks
  // up the synthetic sell movements (as in the sell-position scenario).
  const oneOffForDiff = itp.plus(chainedTax ?? 0);
  const oneOffTaxTotal =
    chainedTax === null ? null : itp.plus(chainedTax).plus(fundingCgTax);

  return buildResult({
    base,
    inputs,
    value: {
      key: `buy-house:${money(price)}:${money(downRate)}:${money(dec(params.mortgageRateAnnual))}:${params.termYears}`,
      kind: "buy-house",
      label: `Buy home at ${formatEURCoarse(price)} (${downRate.times(100).toFixed(0)}% down, ${dec(params.mortgageRateAnnual).times(100).toFixed(2)}% over ${params.termYears}y)`,
      irreversible: true,
      diff: diffSnapshots(base, variant, money(oneOffForDiff)),
      oneOffTaxEUR: oneOffTaxTotal === null ? null : money(oneOffTaxTotal),
      proceedsEUR: money(upfront.negated()),
      ...(basisIncomplete ? { basisIncomplete: true } : {}),
      breakdown,
      mortgage: mortgage.value,
      ...(fundingSales.length > 0 ? { fundingSales } : {}),
      ...(uncovered.greaterThan(0)
        ? { uncoveredShortfallEUR: money(uncovered) }
        : {}),
      exclusions,
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
