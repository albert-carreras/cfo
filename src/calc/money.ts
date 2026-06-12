import Decimal from "decimal.js";

// Money / prices / FX / quantities flow through the system as exact decimal
// strings (the shape Postgres `numeric` gives us). All arithmetic goes through
// decimal.js — never a raw JS float — so the trust core stays boringly correct.

export type Money = string;

// Plenty of precision for chained qty × price × fx; half-up at the cents boundary.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

type Numeric = Money | number | Decimal | null | undefined;

export function dec(x: Numeric): Decimal {
  if (x instanceof Decimal) return x;
  if (x === null || x === undefined || x === "") return new Decimal(0);
  return new Decimal(x);
}

export function sum(values: Numeric[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0));
}

// Round to cents for storage/display. EUR figures in a CalcResult are always
// cents-rounded; internal computation keeps full precision until this boundary.
export function money(value: Numeric): Money {
  return dec(value).toFixed(2);
}

// Quantities (e.g. fractional shares) keep full precision — never cents-rounded.
export function quantity(value: Numeric): Money {
  return dec(value).toString();
}

export function toNum(value: Numeric): number {
  return dec(value).toNumber();
}

const eurFormatter = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
});

export function formatEUR(value: Numeric): string {
  return eurFormatter.format(dec(value).toNumber());
}

// Coarse by design: the calm surface thinks in years and percent,
// not euros — a ±€1,000/month imprecision must not matter anywhere it is shown.
// Full precision stays in the calculators and the provenance depth; only the
// presentation coarsens.

const eurCoarseFormatter = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

// Three significant figures (net worth lands on the nearest ~€1k).
export function formatEURCoarse(value: Numeric): string {
  const d = dec(value);
  const rounded = d.isZero() ? d : d.toSignificantDigits(3);
  return eurCoarseFormatter.format(rounded.toNumber());
}

// Runway is presented in years: one decimal under a decade (where the next
// review can still hinge on it), whole years above.
export function formatYearsCoarse(years: number): string {
  const rounded = years < 10 ? years.toFixed(1) : String(Math.round(years));
  return `${rounded} years`;
}
