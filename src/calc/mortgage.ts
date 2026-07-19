import Decimal from "decimal.js";
import { dec, money, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";

// French (constant-payment) amortization — the standard Spanish mortgage
// shape. Pure arithmetic over caller-supplied terms: no facts consumed, so
// `inputs` is empty and provenance is the echoed terms themselves. The stress
// leg reprices the same loan at +2 points — a fixed, versioned convention
// (bump the version to change it), not a rate forecast.

export const MORTGAGE_STRESS_RATE_PTS = "0.02";

export type MortgageValue = {
  principalEUR: Money;
  rateAnnual: Money; // e.g. "0.03"
  termYears: number;
  monthlyPaymentEUR: Money;
  totalInterestEUR: Money;
  totalPaidEUR: Money;
  stress: {
    rateAnnual: Money;
    monthlyPaymentEUR: Money;
    deltaMonthlyEUR: Money;
  };
};

// payment = P·i / (1 − (1+i)^−n) at monthly rate i = r/12; a 0% rate
// degenerates to straight-line P/n.
export function monthlyPayment(
  principalEUR: Money,
  rateAnnual: Money,
  termYears: number,
): Decimal {
  const principal = dec(principalEUR);
  const months = new Decimal(termYears).times(12);
  if (principal.lessThanOrEqualTo(0) || months.lessThanOrEqualTo(0))
    return new Decimal(0);
  const i = dec(rateAnnual).dividedBy(12);
  if (i.isZero()) return principal.dividedBy(months);
  const factor = i.plus(1).pow(months.negated());
  return principal.times(i).dividedBy(new Decimal(1).minus(factor));
}

export function mortgageTerms(args: {
  snapshotId: string;
  principalEUR: Money;
  rateAnnual: Money;
  termYears: number;
}): CalcResult<MortgageValue> {
  const { snapshotId, principalEUR, rateAnnual, termYears } = args;
  const payment = monthlyPayment(principalEUR, rateAnnual, termYears);
  const totalPaid = payment.times(termYears * 12);
  const stressRate = dec(rateAnnual).plus(dec(MORTGAGE_STRESS_RATE_PTS));
  const stressPayment = monthlyPayment(
    principalEUR,
    money(stressRate),
    termYears,
  );

  return {
    snapshotId,
    value: {
      principalEUR: money(principalEUR),
      rateAnnual: money(rateAnnual),
      termYears,
      monthlyPaymentEUR: money(payment),
      totalInterestEUR: money(totalPaid.minus(dec(principalEUR))),
      totalPaidEUR: money(totalPaid),
      stress: {
        rateAnnual: money(stressRate),
        monthlyPaymentEUR: money(stressPayment),
        deltaMonthlyEUR: money(stressPayment.minus(payment)),
      },
    },
    source: VERSIONS.mortgage.source,
    version: VERSIONS.mortgage.version,
    inputs: [],
  };
}
