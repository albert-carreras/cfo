import { TAX_ES_CAT_2026, type TaxConfig } from "./taxES.es-cat.2026";
import { TAX_IP_CAT_2026, type WealthTaxConfig } from "./taxIP.es-cat.2026";

// The tax tables, selectable by tax year. The snapshot asks for its asOf
// year; until that year's tables land (a sibling config file + an entry
// here), the LATEST AVAILABLE year ≤ the requested one is selected and
// `fallback: true` says so — the freshness loop already turns that into the
// soft "tax tables stale" flag, and the result keeps carrying the selected
// config's OWN year/version (the estimate stays honestly labelled as
// computed under the older tables).
const TAX_CONFIGS_BY_YEAR: Record<
  number,
  { income: TaxConfig; wealth: WealthTaxConfig }
> = {
  2026: { income: TAX_ES_CAT_2026, wealth: TAX_IP_CAT_2026 },
};

export function selectTaxConfigs(year: number): {
  income: TaxConfig;
  wealth: WealthTaxConfig;
  fallback: boolean;
} {
  const exact = TAX_CONFIGS_BY_YEAR[year];
  if (exact) return { ...exact, fallback: false };
  const years = Object.keys(TAX_CONFIGS_BY_YEAR)
    .map(Number)
    .sort((a, b) => a - b);
  const best =
    [...years].reverse().find((y) => y <= year) ?? years[0];
  return { ...TAX_CONFIGS_BY_YEAR[best], fallback: true };
}
