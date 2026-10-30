// Spain's savings-base scale (base liquidable del ahorro, territorio común),
// in force since 1 Jan 2025 (Ley 7/2024) and unchanged for 2026. It is uniform
// across the autonomous communities; País Vasco and Navarra have their own.
// Gains from selling securities are taxed on this scale in the following
// spring's return. Bump the version when the scale changes.
export type TaxBracket = {
  // Upper bound of the bracket in EUR; null = no upper bound.
  upTo: number | null;
  rate: string;
};

export const ES_SAVINGS_SCALE = {
  version: "esSavings.2025.1",
  brackets: [
    { upTo: 6_000, rate: "0.19" },
    { upTo: 50_000, rate: "0.21" },
    { upTo: 200_000, rate: "0.23" },
    { upTo: 300_000, rate: "0.27" },
    { upTo: null, rate: "0.30" },
  ] satisfies TaxBracket[],
} as const;

// The annual return for tax year Y is due by 30 June of Y+1.
export function taxDueDate(year: number): string {
  return `${year + 1}-06-30`;
}
