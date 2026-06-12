import Decimal from "decimal.js";
import { dec, money, sum, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";
import type { TaxConfig, TaxScale } from "./config/taxES.es-cat.2026";
import type { WealthTaxConfig } from "./config/taxIP.es-cat.2026";
import { effectiveMovements } from "./movements";

// Spanish/Cataluña tax estimate. Pure, deterministic, versioned. Income tax
// runs over two distinct bases (the spine of Spanish IRPF):
//   savings base  = capital gains + dividends + interest  → state-only scale
//   general base  = pension withdrawal + net rental + other → state + Cataluña scales
// FIFO matches disposals against open tax lots; net losses carry forward four
// years. Wealth tax (IP, Cataluña scale) folds into the same
// estimate, including the IRPF–IP límite conjunto. Tax numbers are PLANNING
// estimates — the version that produced them travels with every figure, and
// everything the model leaves out is printed next to the number via the
// config-driven `exclusions` (principle #10). See docs/calculators.md.

// --- Progressive scale ---

// Marginal tax over a progressive scale. `[from, to)` per bracket; `to: null` is
// the open top band. A base ≤ 0 yields €0.
export function progressiveTax(baseEUR: Money, scale: TaxScale): Decimal {
  const base = dec(baseEUR);
  if (base.lessThanOrEqualTo(0)) return new Decimal(0);

  let tax = new Decimal(0);
  for (const b of scale) {
    if (base.lessThanOrEqualTo(b.from)) break;
    const upper = b.to === null ? base : Decimal.min(base, b.to);
    const span = upper.minus(b.from);
    if (span.greaterThan(0)) tax = tax.plus(span.times(dec(b.rate)));
  }
  return tax;
}

// --- FIFO capital gains ---

export type TaxLot = {
  id: string;
  holdingId: string;
  buyDate: string; // YYYY-MM-DD (FIFO order)
  quantity: Money;
  costBasisEUR: Money; // total EUR cost of the lot (price × qty + fees, at purchase FX)
};

export type Disposal = {
  id: string; // e.g. the sell-movement id (provenance)
  holdingId: string;
  quantity: Money;
  proceedsEUR: Money; // net proceeds in EUR for the whole disposal
  date: string;
};

export type DisposalGain = {
  disposalId: string;
  holdingId: string;
  date: string; // disposal date (lets the caller keep only one year's gains)
  quantity: Money;
  proceedsEUR: Money;
  costBasisEUR: Money; // matched cost basis (FIFO)
  gainEUR: Money; // RECOGNIZED gain: proceeds − matched cost − deferred loss
  // Loss deferred under the 2-month wash-sale rule (≥ 0; absent when the rule
  // is off or nothing was deferred). The deferred amount is added to the
  // repurchase lots' basis, so it is recognized when THOSE shares are sold.
  deferredLossEUR?: Money;
};

export type RemainingLot = {
  id: string;
  holdingId: string;
  buyDate: string;
  quantity: Money;
  costBasisEUR: Money;
};

export type CapitalGainsValue = {
  realizedGainEUR: Money; // net across all disposals (negative = net loss)
  disposals: DisposalGain[];
  remainingLots: RemainingLot[];
  inputs: string[];
};

// Shift a YYYY-MM-DD date by whole calendar months, clamping the day to the
// target month's end (Jan 31 + 1 month = Feb 28/29). Pure date arithmetic for
// the wash-sale window.
export function shiftMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ny}-${pad(nm)}-${pad(Math.min(d, lastDay))}`;
}

// Consumes lots oldest-first per holding. Gain = proceeds − matched cost basis,
// so the whole disposal's proceeds are always accounted for (any shares beyond
// the open lots carry zero basis). Pure: lots/disposals are copied, never mutated.
//
// `washSaleWindowMonths` (the norma antiaplicación, art. 33.5 LIRPF): a loss
// is deferred to the extent homogeneous shares bought within ±N months of the
// disposal are STILL HELD after it; the deferred loss is added to those
// repurchase lots' basis, so it surfaces when they are sold. Homogeneity is
// matched by holdingId only (stated in the config exclusions).
export function fifoCapitalGains(args: {
  lots: TaxLot[];
  disposals: Disposal[];
  washSaleWindowMonths?: number;
}): CapitalGainsValue {
  const { lots, disposals, washSaleWindowMonths } = args;
  const inputs = new Set<string>();

  // Mutable working copy of remaining quantity per lot, FIFO-ordered per
  // holding. `adjPerShare` carries wash-sale basis bumps on top of the lot's
  // original per-share cost.
  const byHolding = new Map<
    string,
    { lot: TaxLot; remaining: Decimal; adjPerShare: Decimal }[]
  >();
  for (const lot of lots) {
    const arr = byHolding.get(lot.holdingId) ?? [];
    arr.push({ lot, remaining: dec(lot.quantity), adjPerShare: new Decimal(0) });
    byHolding.set(lot.holdingId, arr);
  }
  for (const arr of byHolding.values()) {
    arr.sort((a, b) =>
      a.lot.buyDate < b.lot.buyDate
        ? -1
        : a.lot.buyDate > b.lot.buyDate
          ? 1
          : a.lot.id < b.lot.id
            ? -1
            : 1,
    );
  }

  const sortedDisposals = [...disposals].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
  );

  const disposalGains: DisposalGain[] = [];
  let realized = new Decimal(0);

  for (const d of sortedDisposals) {
    inputs.add(d.id);
    let toSell = dec(d.quantity);
    const proceeds = dec(d.proceedsEUR);
    let matchedCost = new Decimal(0);

    const arr = byHolding.get(d.holdingId) ?? [];
    for (const entry of arr) {
      if (toSell.lessThanOrEqualTo(0)) break;
      if (entry.remaining.lessThanOrEqualTo(0)) continue;
      // A lot can only cover a disposal if it was already bought; lots dated
      // after the disposal stay available for later sells (and for the
      // wash-sale window below, where future repurchases are the point).
      if (entry.lot.buyDate > d.date) continue;
      const take = Decimal.min(entry.remaining, toSell);
      // Per-share cost from the lot's ORIGINAL size keeps basis exact; any
      // wash-sale adjustment rides on top.
      const costPerShare = dec(entry.lot.costBasisEUR)
        .dividedBy(dec(entry.lot.quantity))
        .plus(entry.adjPerShare);
      matchedCost = matchedCost.plus(costPerShare.times(take));
      entry.remaining = entry.remaining.minus(take);
      toSell = toSell.minus(take);
      inputs.add(entry.lot.id);
    }

    const rawGain = proceeds.minus(matchedCost);

    // Wash-sale deferral: only on a loss, only to the extent shares bought
    // within the window are still open AFTER this disposal consumed its FIFO
    // match (a lot fully sold here cannot be its own repurchase).
    let deferred = new Decimal(0);
    if (washSaleWindowMonths && rawGain.isNegative()) {
      const from = shiftMonths(d.date, -washSaleWindowMonths);
      const to = shiftMonths(d.date, washSaleWindowMonths);
      const windowLots = arr.filter(
        (e) =>
          e.remaining.greaterThan(0) &&
          e.lot.buyDate >= from &&
          e.lot.buyDate <= to,
      );
      const heldInWindow = windowLots.reduce(
        (acc, e) => acc.plus(e.remaining),
        new Decimal(0),
      );
      const soldQty = dec(d.quantity);
      const lossPerShare = rawGain.negated().dividedBy(soldQty);
      let deferQty = Decimal.min(heldInWindow, soldQty);
      deferred = lossPerShare.times(deferQty);
      // The deferred loss bumps the repurchase lots' basis oldest-first; it
      // is recovered exactly when those shares are sold.
      for (const e of windowLots) {
        if (deferQty.lessThanOrEqualTo(0)) break;
        const alloc = Decimal.min(e.remaining, deferQty);
        e.adjPerShare = e.adjPerShare.plus(
          lossPerShare.times(alloc).dividedBy(e.remaining),
        );
        deferQty = deferQty.minus(alloc);
        inputs.add(e.lot.id);
      }
    }

    const gain = rawGain.plus(deferred);
    realized = realized.plus(gain);
    disposalGains.push({
      disposalId: d.id,
      holdingId: d.holdingId,
      date: d.date,
      quantity: dec(d.quantity).toString(),
      proceedsEUR: money(proceeds),
      costBasisEUR: money(matchedCost),
      gainEUR: money(gain),
      ...(deferred.greaterThan(0) ? { deferredLossEUR: money(deferred) } : {}),
    });
  }

  const remainingLots: RemainingLot[] = [];
  for (const arr of byHolding.values()) {
    for (const entry of arr) {
      if (entry.remaining.lessThanOrEqualTo(0)) continue;
      const costPerShare = dec(entry.lot.costBasisEUR)
        .dividedBy(dec(entry.lot.quantity))
        .plus(entry.adjPerShare);
      remainingLots.push({
        id: entry.lot.id,
        holdingId: entry.lot.holdingId,
        buyDate: entry.lot.buyDate,
        quantity: entry.remaining.toString(),
        costBasisEUR: money(costPerShare.times(entry.remaining)),
      });
    }
  }

  return {
    realizedGainEUR: money(realized),
    disposals: disposalGains,
    remainingLots,
    inputs: [...inputs],
  };
}

// --- Realized gains from the ledger (lots are DERIVED, never re-seeded) ---

// A ledger row, as far as lot derivation cares. `buy` opens a lot, `sell` is a
// disposal; everything else is ignored.
export type LotMovement = {
  id: string;
  type: string;
  holdingId: string | null;
  quantity: Money | null;
  amount: Money;
  occurredAt: string;
  correctsId?: string | null;
};

// The open-lot set is `opening tax_lots baseline + every buy`, consumed FIFO by
// every sell — exactly like cash/quantity in deriveState. So the tax_lots table
// only ever holds the OPENING lots; buys/sells you quick-log maintain the rest,
// and you never re-seed. Only the snapshot year's disposals feed the savings
// base, but ALL sells replay in date order so earlier years consume lots first.
export function realizedCapitalGains(args: {
  openingLots: TaxLot[];
  movements: LotMovement[];
  asOf: string;
  holdingOpeningAsOf?: Record<string, string>;
  washSaleWindowMonths?: number;
}): {
  realizedGainEUR: Money; // the asOf-year's net realized gain (negative = loss)
  perDisposal: DisposalGain[];
  remainingLots: RemainingLot[];
  inputs: string[];
} {
  const {
    openingLots,
    movements,
    asOf,
    holdingOpeningAsOf = {},
    washSaleWindowMonths,
  } = args;
  const taxYear = asOf.slice(0, 4);

  // Honor append-only corrections (a row superseded by a later correctsId) and
  // ignore anything dated after asOf — same rules as deriveState.
  const live = effectiveMovements(movements, asOf).filter(
    (movement) =>
      !movement.holdingId ||
      movement.occurredAt >=
        (holdingOpeningAsOf[movement.holdingId] ?? ""),
  );

  const buyLots: TaxLot[] = live
    .filter((m) => m.type === "buy" && m.holdingId && m.quantity)
    .map((m) => ({
      id: m.id,
      holdingId: m.holdingId as string,
      buyDate: m.occurredAt,
      quantity: m.quantity as Money,
      costBasisEUR: m.amount, // the EUR amount paid is the lot's cost basis
    }));

  const disposals: Disposal[] = live
    .filter((m) => m.type === "sell" && m.holdingId && m.quantity)
    .map((m) => ({
      id: m.id,
      holdingId: m.holdingId as string,
      quantity: m.quantity as Money,
      proceedsEUR: m.amount,
      date: m.occurredAt,
    }));

  const cg = fifoCapitalGains({
    lots: [
      ...openingLots.filter((lot) => lot.buyDate <= asOf),
      ...buyLots,
    ],
    disposals,
    washSaleWindowMonths,
  });

  const realized = sum(
    cg.disposals
      .filter((d) => d.date.slice(0, 4) === taxYear)
      .map((d) => d.gainEUR),
  );

  return {
    realizedGainEUR: money(realized),
    perDisposal: cg.disposals,
    remainingLots: cg.remainingLots,
    inputs: cg.inputs,
  };
}

// --- Rough rental-income model ---

export type RentalProperty = {
  id: string;
  rentMonthly: Money;
  costsMonthly: Money;
  ownershipPct: Money;
  isPrimaryResidence: boolean;
};

export type RentalValue = {
  grossEUR: Money;
  deductibleEUR: Money;
  netEUR: Money;
  taxableEUR: Money; // net, with the vivienda reduction on positive yield
  inputs: string[];
};

// Annualised, owner's-share rental income. The reduction applies only to a
// positive net yield of a residential let; a loss passes through unreduced (it
// can offset other general income). Primary residence and unrented properties
// are skipped. Rough — see the file header.
export function rentalIncome(args: {
  properties: RentalProperty[];
  reductionRate: Money;
}): RentalValue {
  const { properties, reductionRate } = args;
  const inputs = new Set<string>();

  let gross = new Decimal(0);
  let deductible = new Decimal(0);
  let taxable = new Decimal(0);

  for (const p of properties) {
    const rent = dec(p.rentMonthly);
    if (p.isPrimaryResidence || rent.lessThanOrEqualTo(0)) continue;
    inputs.add(p.id);

    const share = dec(p.ownershipPct).dividedBy(100);
    const g = rent.times(12).times(share);
    const d = dec(p.costsMonthly).times(12).times(share);
    const net = g.minus(d);
    const t = net.greaterThan(0)
      ? net.times(new Decimal(1).minus(dec(reductionRate)))
      : net;

    gross = gross.plus(g);
    deductible = deductible.plus(d);
    taxable = taxable.plus(t);
  }

  return {
    grossEUR: money(gross),
    deductibleEUR: money(deductible),
    netEUR: money(gross.minus(deductible)),
    taxableEUR: money(taxable),
    inputs: [...inputs],
  };
}

// --- Loss carry-forward (derived from the ledger, never stored) ---

export type LossCarryForwardValue = {
  availableEUR: Money; // prior losses still usable in the tax year (≥ 0)
  byYear: { year: string; remainingEUR: Money }[]; // origin year → what's left
  expiredEUR: Money; // losses that fell off the 4-year window, for honesty
};

// Spanish savings-base losses carry forward four tax years. The whole history
// is DERIVED by replaying the ledger's per-disposal gains year by year — no
// stored tax state, so corrections to old movements reprice the carry-forward
// automatically. Prior years consume the pool oldest-first with their net
// realized gains (gains only — prior-year dividends/interest and the legal
// 25% offset cap are not modelled; see the config exclusions). Losses from
// before the ledger's opening baseline enter via the `lossCarryForward`
// assumption; it never expires in-model — it's reviewed on the assumption's
// annual cadence and retired by the user when spent or stale.
export function lossCarryForward(args: {
  perDisposal: DisposalGain[]; // ALL years, as returned by realizedCapitalGains
  taxYear: string; // e.g. "2026" — losses from before taxYear−4 are expired
  preLedgerLossEUR?: Money; // positive = available losses predating the ledger
}): LossCarryForwardValue {
  const { perDisposal, taxYear, preLedgerLossEUR } = args;

  const netByYear = new Map<string, Decimal>();
  for (const d of perDisposal) {
    const year = d.date.slice(0, 4);
    if (year >= taxYear) continue;
    netByYear.set(year, (netByYear.get(year) ?? new Decimal(0)).plus(dec(d.gainEUR)));
  }

  // The pre-ledger assumption is the oldest pool entry, so in-ledger gains
  // consume it first (matching how a filer would use the oldest loss first).
  const pool: { year: string; remaining: Decimal }[] = [];
  const preLedger = Decimal.max(0, dec(preLedgerLossEUR));
  if (preLedger.greaterThan(0)) pool.push({ year: "pre-ledger", remaining: preLedger });

  for (const year of [...netByYear.keys()].sort()) {
    let net = netByYear.get(year) as Decimal;
    if (net.isNegative()) {
      pool.push({ year, remaining: net.negated() });
      continue;
    }
    for (const entry of pool) {
      if (net.lessThanOrEqualTo(0)) break;
      const used = Decimal.min(entry.remaining, net);
      entry.remaining = entry.remaining.minus(used);
      net = net.minus(used);
    }
  }

  const expiryFloor = String(Number(taxYear) - 4);
  let available = new Decimal(0);
  let expired = new Decimal(0);
  const byYear: LossCarryForwardValue["byYear"] = [];
  for (const entry of pool) {
    if (entry.remaining.lessThanOrEqualTo(0)) continue;
    if (entry.year !== "pre-ledger" && entry.year < expiryFloor) {
      expired = expired.plus(entry.remaining);
      continue;
    }
    available = available.plus(entry.remaining);
    byYear.push({ year: entry.year, remainingEUR: money(entry.remaining) });
  }

  return {
    availableEUR: money(available),
    byYear,
    expiredEUR: money(expired),
  };
}

// --- Wealth tax (Impuesto sobre el Patrimonio, Cataluña) ---

export type WealthTaxValue = {
  version: string; // the IP config's own version (the income version travels on the CalcResult)
  netBaseEUR: Money; // net wealth after the pension & vivienda exemptions
  taxableEUR: Money; // net base minus the mínimo exento, floored at 0
  grossQuotaEUR: Money; // scale applied, before the IRPF–IP cap
  limitReductionEUR: Money; // what the límite conjunto shaved off (≥ 0)
  quotaEUR: Money; // what's actually due
  exemptions: {
    pensionEUR: Money;
    primaryResidenceEUR: Money; // min(share of vivienda value, the €300k cap)
    exemptMinimumEUR: Money;
  };
};

// IP estimate over the snapshot's net worth. Exemptions modelled: pension
// plans (the snapshot's locked pile) and up to €300k of the owner's share of
// the primary residence. The límite conjunto (art. 31): IRPF quota + IP quota
// may not exceed `limitRate` (60%) of the IRPF bases; the reduction is capped
// at `maxReductionRate` (80%) of the IP quota, so at least 20% is always due.
// Simplified — the >1-year-gains carve-out and other special exemptions are
// printed as exclusions, not silently modelled.
export function wealthTaxES(args: {
  config: WealthTaxConfig;
  netWorthTotalEUR: Money;
  pensionEUR: Money;
  primaryResidenceValueEUR: Money; // owner's share of the vivienda habitual value
  irpfBasesEUR: Money; // savings base + general base (post-floor)
  irpfQuotaEUR: Money; // the income tax the orchestrator just computed
}): WealthTaxValue {
  const { config } = args;

  const primaryResidenceExempt = Decimal.min(
    dec(config.primaryResidenceExemptionMaxEUR),
    Decimal.max(0, dec(args.primaryResidenceValueEUR)),
  );
  const pensionExempt = Decimal.max(0, dec(args.pensionEUR));
  const netBase = dec(args.netWorthTotalEUR)
    .minus(pensionExempt)
    .minus(primaryResidenceExempt);
  const taxable = Decimal.max(0, netBase.minus(dec(config.exemptMinimumEUR)));
  const grossQuota = progressiveTax(money(taxable), config.scale);

  // Límite conjunto: cap the joint quotas at 60% of the IRPF bases, but never
  // reduce the IP quota by more than 80% of itself.
  const cap = dec(args.irpfBasesEUR).times(dec(config.limitRate));
  const excess = dec(args.irpfQuotaEUR).plus(grossQuota).minus(cap);
  const reduction = Decimal.min(
    Decimal.max(0, excess),
    grossQuota.times(dec(config.maxReductionRate)),
  );
  const quota = grossQuota.minus(reduction);

  return {
    version: config.version,
    netBaseEUR: money(netBase),
    taxableEUR: money(taxable),
    grossQuotaEUR: money(grossQuota),
    limitReductionEUR: money(reduction),
    quotaEUR: money(quota),
    exemptions: {
      pensionEUR: money(pensionExempt),
      primaryResidenceEUR: money(primaryResidenceExempt),
      exemptMinimumEUR: dec(config.exemptMinimumEUR).toFixed(2),
    },
  };
}

// --- Annual tax estimate (orchestrator) ---

export type TaxESValue = {
  year: number;
  savingsBaseEUR: Money; // capital gains + dividends + interest − carry-forward (floored at 0)
  savingsTaxEUR: Money;
  generalBaseEUR: Money; // pension + taxable rental + other (floored at 0)
  generalStateTaxEUR: Money;
  generalAutonomicTaxEUR: Money;
  generalTaxEUR: Money; // state + autonomic
  totalTaxEUR: Money; // income tax + wealth-tax quota (when modelled)
  // Wealth-tax fields — optional only because legacy STORED snapshots lack
  // them; taxES() always fills them.
  incomeTaxEUR?: Money; // savings + general (the legacy totalTaxEUR)
  lossCarryForwardUsedEUR?: Money; // prior losses consumed by this year's base
  lossCarryForwardRemainingEUR?: Money; // still available after this year
  wealth?: WealthTaxValue; // absent when the caller passes no wealth inputs
  // Personal/family minimums (2026.3) — optional only because older STORED
  // snapshots lack them; taxES() always fills them. The minimum is a credit at
  // the bottom of the scales (quota = scale(base) − scale(minimum)); the part
  // of the STATE minimum the general base can't absorb credits the savings
  // scale (the autonomic remainder doesn't — see the config exclusions).
  minimums?: {
    stateEUR: Money; // state minimum (personal + family)
    autonomicEUR: Money; // autonomic minimum (personal + family)
    savingsOffsetEUR: Money; // state minimum spilled onto the savings base
  };
  exclusions?: string[]; // config-driven; printed on the tax card
};

export function taxES(args: {
  snapshotId: string;
  config: TaxConfig;
  realizedCapitalGainsEUR: Money;
  dividendsEUR?: Money;
  interestEUR?: Money;
  pensionWithdrawalEUR?: Money;
  rentalTaxableEUR?: Money;
  otherGeneralIncomeEUR?: Money;
  // Prior-year losses still usable (from lossCarryForward). Reduces a positive
  // savings base, never below 0.
  lossCarryForwardEUR?: Money;
  // Family minimums (descendants/ascendants/disability) from the optional
  // `familyMinimum` assumption — added to the personal minimum on both the
  // state and the autonomic side.
  familyMinimumEUR?: Money;
  // Wealth-tax inputs. Absent ⇒ income tax only (the wealth field
  // stays out of the result rather than reading as a €0 liability).
  wealth?: {
    config: WealthTaxConfig;
    netWorthTotalEUR: Money;
    pensionEUR: Money;
    primaryResidenceValueEUR: Money;
  };
  inputs: string[];
}): CalcResult<TaxESValue> {
  const { snapshotId, config, inputs } = args;

  // Savings base: capital gains net of losses, plus dividends/interest. A net
  // loss is floored at 0 here and carries forward via lossCarryForward; prior
  // years' carry-forward reduces a positive base.
  const rawSavings = dec(args.realizedCapitalGainsEUR)
    .plus(dec(args.dividendsEUR))
    .plus(dec(args.interestEUR));
  const carryAvailable = Decimal.max(0, dec(args.lossCarryForwardEUR));
  const carryUsed = Decimal.min(carryAvailable, Decimal.max(0, rawSavings));
  const savingsBase = Decimal.max(0, rawSavings.minus(carryUsed));

  // General base: pension withdrawal (treated as general income) + taxable
  // rental + any other general income.
  const generalBase = Decimal.max(
    0,
    dec(args.pensionWithdrawalEUR)
      .plus(dec(args.rentalTaxableEUR))
      .plus(dec(args.otherGeneralIncomeEUR)),
  );

  // Personal/family minimums (2026.3). The minimum is taxed at the bottom of
  // each scale and credited: quota = scale(base) − scale(min(minimum, base)).
  // Cataluña's autonomic personal minimum rises for low total bases. The part
  // of the STATE minimum the general base can't absorb credits the savings
  // scale; the autonomic remainder is dropped (the savings quota is modelled
  // state-only — a config exclusion).
  const family = Decimal.max(0, dec(args.familyMinimumEUR));
  const totalBase = savingsBase.plus(generalBase);
  const stateMin = dec(config.personalMinimum.stateEUR).plus(family);
  const autonomicMin = (
    totalBase.lessThanOrEqualTo(
      dec(config.personalMinimum.autonomicLowIncome.thresholdEUR),
    )
      ? dec(config.personalMinimum.autonomicLowIncome.minimumEUR)
      : dec(config.personalMinimum.autonomicEUR)
  ).plus(family);
  const savingsOffset = Decimal.min(
    Decimal.max(0, stateMin.minus(generalBase)),
    savingsBase,
  );

  const savingsTax = progressiveTax(money(savingsBase), config.savings).minus(
    progressiveTax(money(savingsOffset), config.savings),
  );
  const generalStateTax = progressiveTax(
    money(generalBase),
    config.generalState,
  ).minus(
    progressiveTax(money(Decimal.min(stateMin, generalBase)), config.generalState),
  );
  const generalAutonomicTax = progressiveTax(
    money(generalBase),
    config.generalAutonomic,
  ).minus(
    progressiveTax(
      money(Decimal.min(autonomicMin, generalBase)),
      config.generalAutonomic,
    ),
  );
  const generalTax = generalStateTax.plus(generalAutonomicTax);
  const incomeTax = savingsTax.plus(generalTax);

  const wealth = args.wealth
    ? wealthTaxES({
        config: args.wealth.config,
        netWorthTotalEUR: args.wealth.netWorthTotalEUR,
        pensionEUR: args.wealth.pensionEUR,
        primaryResidenceValueEUR: args.wealth.primaryResidenceValueEUR,
        irpfBasesEUR: money(savingsBase.plus(generalBase)),
        irpfQuotaEUR: money(incomeTax),
      })
    : undefined;
  const totalTax = incomeTax.plus(wealth ? dec(wealth.quotaEUR) : 0);

  return {
    snapshotId,
    value: {
      year: config.year,
      savingsBaseEUR: money(savingsBase),
      savingsTaxEUR: money(savingsTax),
      generalBaseEUR: money(generalBase),
      generalStateTaxEUR: money(generalStateTax),
      generalAutonomicTaxEUR: money(generalAutonomicTax),
      generalTaxEUR: money(generalTax),
      totalTaxEUR: money(totalTax),
      incomeTaxEUR: money(incomeTax),
      lossCarryForwardUsedEUR: money(carryUsed),
      lossCarryForwardRemainingEUR: money(carryAvailable.minus(carryUsed)),
      minimums: {
        stateEUR: money(stateMin),
        autonomicEUR: money(autonomicMin),
        savingsOffsetEUR: money(savingsOffset),
      },
      ...(wealth ? { wealth } : {}),
      exclusions: [
        ...config.exclusions,
        ...(args.wealth ? args.wealth.config.exclusions : []),
      ],
    },
    source: VERSIONS.taxES.source,
    version: VERSIONS.taxES.version,
    inputs,
  };
}
