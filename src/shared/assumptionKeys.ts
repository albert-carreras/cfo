// Planning inputs editable in the Data workspace. Numeric trust-core inputs
// sit beside decision-context inputs that travel only in the Markdown pack.
export const EDITABLE_ASSUMPTION_KEYS = [
  "monthlySpend",
  "monthlySpendConservative",
  "monthlySpendOptimistic",
  "monthlyNetIncome",
  "monthlyHousingCost",
  "safeWithdrawalRate",
  "expectedReturn",
  "longRunInflation",
  "inflation",
  "interestRate",
  "birthDate",
] as const;

// Keys the monthly ECB feed refreshes (source "feed:ecb"). Still manually
// editable — a manual value holds until the month rolls over, then the feed
// takes the row back.
export const FEED_ASSUMPTION_KEYS = ["inflation", "interestRate"] as const;

// The keys a person actually edits in the Data workspace: every editable key
// except the two the ECB feed owns (those render read-only). Used by the
// one-save planning-inputs form and its batch action.
export const PLANNING_INPUT_KEYS = EDITABLE_ASSUMPTION_KEYS.filter(
  (key) => !(FEED_ASSUMPTION_KEYS as readonly string[]).includes(key),
);

// Short human labels shown ahead of the raw camelCase key on the Data page.
export const ASSUMPTION_LABELS: Record<
  (typeof EDITABLE_ASSUMPTION_KEYS)[number],
  string
> = {
  monthlySpend: "Monthly spending",
  monthlySpendConservative: "Monthly spending — conservative",
  monthlySpendOptimistic: "Monthly spending — optimistic",
  monthlyNetIncome: "Monthly net income",
  monthlyHousingCost: "Monthly housing cost",
  safeWithdrawalRate: "Safe withdrawal rate",
  expectedReturn: "Expected annual return",
  longRunInflation: "Long-run inflation",
  inflation: "Observed inflation (ECB)",
  interestRate: "Risk-free rate (ECB)",
  birthDate: "Date of birth",
};

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
  monthlyNetIncome:
    "Your current net monthly income — exported for decisions such as housing and work changes; it does not inflate net worth.",
  monthlyHousingCost:
    "Current recurring rent, mortgage and housing costs per month — exported separately from general spending.",
  safeWithdrawalRate:
    "The fraction of the FIRE-counted portfolio you'd draw per year, e.g. 0.035 — sets the FIRE number.",
  expectedReturn:
    "Your nominal long-run annual portfolio return assumption, e.g. 0.07 — used only by the labeled real-return illustration.",
  longRunInflation:
    "Your long-run inflation assumption, e.g. 0.02 — paired with expectedReturn in the labeled real-return illustration.",
  inflation:
    "Observed annual inflation (Spain HICP, annual rate) — auto-updated monthly from the ECB feed. An observation for calibrating longRunInflation, not a forecast.",
  interestRate:
    "The ECB deposit facility rate as a fraction — the risk-free euro cash yield. Auto-updated monthly from the ECB feed.",
  birthDate:
    "Your date of birth — gives age context to the exported financial brief.",
};

export type AssumptionRow = {
  key: string;
  value: string | null;
  dateValue: string | null;
  lastReviewedAt: string | null;
};

// The Data table shows whitelisted keys first in EDITABLE_ASSUMPTION_KEYS
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
