// The whitelisted keys the /manage assumption rows may set — the calculators'
// inputs plus the Ask profile's birthDate. Anything else stays on the script
// path (scripts/set-assumption.ts). Client-importable.
export const EDITABLE_ASSUMPTION_KEYS = [
  "monthlySpend",
  "monthlySpendConservative",
  "monthlySpendOptimistic",
  "safeWithdrawalRate",
  "expectedReturn",
  "longRunInflation",
  "inflation",
  "interestRate",
  "birthDate",
  "lossCarryForward",
  "familyMinimum",
] as const;

// Keys the monthly ECB feed refreshes (source "feed:ecb"). Still manually
// editable — a manual value holds until the month rolls over, then the feed
// takes the row back.
export const FEED_ASSUMPTION_KEYS = ["inflation", "interestRate"] as const;

// One plain sentence per key, shown under the key on /manage — what the number
// is and which calculator (if any) consumes it today.
export const ASSUMPTION_DESCRIPTIONS: Record<
  (typeof EDITABLE_ASSUMPTION_KEYS)[number],
  string
> = {
  monthlySpend:
    "Your coarse monthly spend in EUR — the source of truth for runway and the FIRE number.",
  monthlySpendConservative:
    "A higher spend variant for the conservative FIRE band.",
  monthlySpendOptimistic:
    "A lower spend variant for the optimistic FIRE band.",
  safeWithdrawalRate:
    "The fraction of the FIRE-counted portfolio you'd draw per year, e.g. 0.035 — sets the FIRE number.",
  expectedReturn:
    "Your NOMINAL long-run annual portfolio/ETF return guess as a fraction, e.g. 0.07. A labeled assumption, never a prediction — feeds the real-runway view, the property-vs-ETF comparison and the grown spread-sale variant.",
  longRunInflation:
    "Your long-run inflation FORECAST as a fraction, e.g. 0.02 — pairs with expectedReturn in the real-runway and property-yield views and discounts planned events to today's purchasing power. The auto-fed inflation row below is the current observation, shown for calibration.",
  inflation:
    "Observed annual inflation (Spain HICP, annual rate) — auto-updated monthly from the ECB feed. An observation for calibrating longRunInflation, not a forecast.",
  interestRate:
    "The ECB deposit facility rate as a fraction — the risk-free euro cash yield. Auto-updated monthly from the ECB feed.",
  birthDate:
    "Your date of birth — gives age context to scenarios and the Ask layer.",
  lossCarryForward:
    "Pre-ledger realised losses (EUR) still available to offset gains — the 4-year Spanish carry-forward.",
  familyMinimum:
    "Your IRPF mínimo personal y familiar in EUR, if it differs from the default.",
};

export type AssumptionRow = {
  key: string;
  value: string | null;
  dateValue: string | null;
  lastReviewedAt: string | null;
};

// The /manage table shows whitelisted keys first in EDITABLE_ASSUMPTION_KEYS
// order — unset ones included as empty rows, so the table is also the
// checklist of what can be set — then any script-only keys, alphabetically.
export function orderAssumptionRows(rows: AssumptionRow[]): AssumptionRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const whitelisted: AssumptionRow[] = EDITABLE_ASSUMPTION_KEYS.map(
    (key) =>
      byKey.get(key) ?? { key, value: null, dateValue: null, lastReviewedAt: null },
  );
  const extras = rows
    .filter((row) => !(EDITABLE_ASSUMPTION_KEYS as readonly string[]).includes(row.key))
    .sort((a, b) => a.key.localeCompare(b.key));
  return [...whitelisted, ...extras];
}
