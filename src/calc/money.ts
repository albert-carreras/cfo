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

const eurWholeFormatter = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

// Whole euros: what every screen shows. Cents stay in the stored figures.
export function formatEURWhole(value: Numeric): string {
  return eurWholeFormatter.format(dec(value).toNumber());
}

// Units of a security: grouped, up to 6 decimals, no trailing zeros.
export function formatUnits(value: Numeric): string {
  return dec(value).toNumber().toLocaleString("en-GB", { maximumFractionDigits: 6 });
}
