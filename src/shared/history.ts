import { dec } from "@/calc/money";

// Signed EUR net-worth delta between a snapshot and the one before it
// (chronologically). Returns null when there is no earlier snapshot to compare
// against — the caller renders an em dash for that first row.
export function netWorthDeltaLabel(
  current: string,
  previous: string | null | undefined,
): string | null {
  if (previous == null) return null;
  const delta = dec(current).minus(previous);
  const magnitude = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(delta.abs().toNumber());
  if (delta.isZero()) return `±${magnitude}`;
  return `${delta.isPositive() ? "+" : "−"}${magnitude}`;
}
