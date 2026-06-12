import type { AccountType } from "@/calc/netWorth";
import type { MovementType } from "@/calc/derive";
import type { SnapshotFacts } from "@/calc/snapshot";

// Mirrors plannedEventTypeEnum in the schema. Forecasts, not facts — stored facts
// consumed only by the scenario engine; never affect today's net worth.
type PlannedEventType =
  | "house_purchase"
  | "property_sale"
  | "job_exit"
  | "pension_withdrawal"
  | "rental_start"
  | "inheritance";

// The synthetic fixture: a realistic-but-made-up portfolio (~€300k ETFs,
// 3 apartments, a pension, one mortgage). Committed to git and DOUBLES AS THE
// TEST FIXTURE — every row has a stable, explicit id so provenance is stable and
// the seed and the unit tests share identical data. Real numbers go in later via
// a git-ignored seed.local.ts of the same shape.

export const BASELINE = "2026-01-01"; // dated opening baseline
export const FIXTURE_AS_OF = "2026-06-09";

// Full DB rows (a superset of calc/snapshot's SnapshotFacts, so the same object
// feeds both the DB seed and computeSnapshot).
export type Fixture = {
  accounts: {
    id: string;
    type: AccountType;
    name: string;
    currency: string;
    openingCash: string;
    openingAsOf: string;
  }[];
  holdings: {
    id: string;
    accountId: string;
    isin: string;
    ticker: string | null;
    name: string;
    currency: string;
    openingQuantity: string;
    openingAsOf: string;
  }[];
  // Open tax lots (the purchases you still hold at the baseline) — what Spanish
  // FIFO capital-gains needs going forward. Optional so a pre-existing
  // seed.local.ts without lots still type-checks; absent ⇒ no FIFO basis.
  taxLots?: {
    id: string;
    holdingId: string;
    buyDate: string;
    quantity: string;
    price: string;
    fees: string;
    fxRate: string;
    costBasisEUR: string;
  }[];
  properties: {
    id: string;
    name: string;
    value: string;
    purchasePrice: string;
    ownershipPct: string;
    rentMonthly: string;
    costsMonthly: string;
    isPrimaryResidence: boolean;
    emotionalValue: number | null;
    valuedAt: string;
  }[];
  liabilities: {
    id: string;
    type: "mortgage";
    propertyId: string | null;
    rate: string;
    balance: string;
    payment: string;
  }[];
  assumptions: {
    id: string;
    key: string;
    // Numeric assumptions set `value`; date-typed ones (birthDate) set
    // `dateValue`. Optional so a pre-existing seed.local.ts still type-checks.
    value: string | null;
    dateValue?: string | null;
    source: string;
    lastReviewedAt: string;
  }[];
  movements: {
    id: string;
    type: MovementType;
    accountId: string;
    holdingId: string | null;
    quantity: string | null;
    amount: string;
    currency: string;
    occurredAt: string;
    note: string | null;
    correctsId: string | null;
    // Both legs of an own-account transfer share one group id.
    // Optional so a pre-existing seed.local.ts still type-checks.
    transferGroupId?: string | null;
  }[];
  // Dated value statements: the account re-anchors to the latest one
  // (value = statement + movements since its date). Optional — absent means
  // every account derives from its opening baseline.
  revaluations?: {
    id: string;
    assetType: "account";
    assetId: string;
    value: string;
    valuedAt: string;
    note: string | null;
    createdAt: string;
  }[];
  monthlySpend: {
    id: string;
    month: string;
    amount: string;
    note: string | null;
    createdAt: string;
  }[];
  prices: { id: string; isin: string; price: string; currency: string; asOf: string }[];
  fx: { id: string; base: string; quote: string; rate: string; asOf: string }[];
  // Forecasts (future home, inheritances). Optional: the synthetic fixture omits
  // them. Not read by computeSnapshot's base case; consumed by the scenario engine.
  plannedEvents?: {
    id: string;
    type: PlannedEventType;
    date: string;
    amount: string;
    probability: string;
    includedInBaseCase: boolean;
    note: string | null;
  }[];
};

// The structural view as the pure calculator input — shared by the seed script
// and the unit tests so both compute over exactly the same shape. Numeric
// assumptions only (date-typed ones feed the Ask layer's profile, never
// calculators); revaluation rows map from the generic DB shape (assetId) to
// the derive shape (accountId).
export function toSnapshotFacts(data: Fixture): SnapshotFacts {
  return {
    ...data,
    assumptions: data.assumptions.filter(
      (a): a is (typeof data.assumptions)[number] & { value: string } =>
        a.value !== null,
    ),
    revaluations: (data.revaluations ?? []).map((reval) => ({
      id: reval.id,
      accountId: reval.assetId,
      value: reval.value,
      valuedAt: reval.valuedAt,
      createdAt: reval.createdAt,
    })),
  };
}

export const fixture: Fixture = {
  accounts: [
    { id: "acc_bank", type: "bank", name: "Bank — current account", currency: "EUR", openingCash: "15000", openingAsOf: BASELINE },
    { id: "acc_broker", type: "broker", name: "Broker (ETFs)", currency: "EUR", openingCash: "2000", openingAsOf: BASELINE },
    { id: "acc_pension", type: "pension", name: "Pension plan", currency: "EUR", openingCash: "85000", openingAsOf: "2026-03-31" },
  ],

  holdings: [
    { id: "hold_vwce", accountId: "acc_broker", isin: "IE00BK5BQT80", ticker: "VWCE", name: "Vanguard FTSE All-World", currency: "EUR", openingQuantity: "2000", openingAsOf: BASELINE },
    { id: "hold_smh", accountId: "acc_broker", isin: "US92189F7915", ticker: "SMH", name: "VanEck Semiconductor ETF", currency: "USD", openingQuantity: "300", openingAsOf: BASELINE },
    { id: "hold_aggh", accountId: "acc_broker", isin: "IE00BDBRDM35", ticker: "AGGH", name: "iShares Core Global Aggregate Bond", currency: "EUR", openingQuantity: "500", openingAsOf: BASELINE },
  ],

  // Open lots backing the broker holdings (sum to each holding's openingQuantity).
  // costBasisEUR is the EUR cost at purchase (price × qty × fxRate + fees); SMH was
  // bought in USD, so its basis is FX-converted. FIFO consumes these oldest-first.
  taxLots: [
    { id: "lot_vwce_1", holdingId: "hold_vwce", buyDate: "2020-01-15", quantity: "1200", price: "80", fees: "0", fxRate: "1", costBasisEUR: "96000" },
    { id: "lot_vwce_2", holdingId: "hold_vwce", buyDate: "2023-06-20", quantity: "800", price: "110", fees: "0", fxRate: "1", costBasisEUR: "88000" },
    { id: "lot_smh_1", holdingId: "hold_smh", buyDate: "2021-03-01", quantity: "300", price: "150", fees: "0", fxRate: "0.90", costBasisEUR: "40500" },
    { id: "lot_aggh_1", holdingId: "hold_aggh", buyDate: "2022-09-01", quantity: "500", price: "5.20", fees: "0", fxRate: "1", costBasisEUR: "2600" },
  ],

  properties: [
    { id: "prop_home", name: "Apartment — city centre (home)", value: "320000", purchasePrice: "250000", ownershipPct: "100", rentMonthly: "0", costsMonthly: "200", isPrimaryResidence: true, emotionalValue: 5, valuedAt: "2026-04-01" },
    { id: "prop_rent_a", name: "Apartment — rental A", value: "180000", purchasePrice: "150000", ownershipPct: "100", rentMonthly: "900", costsMonthly: "150", isPrimaryResidence: false, emotionalValue: 1, valuedAt: "2026-04-01" },
    { id: "prop_rent_b", name: "Apartment — rental B (50% share)", value: "150000", purchasePrice: "140000", ownershipPct: "50", rentMonthly: "700", costsMonthly: "120", isPrimaryResidence: false, emotionalValue: 1, valuedAt: "2026-04-01" },
  ],

  liabilities: [
    { id: "liab_home_mortgage", type: "mortgage", propertyId: "prop_home", rate: "0.021", balance: "140000", payment: "850" },
  ],

  assumptions: [
    { id: "assum_swr", key: "safeWithdrawalRate", value: "0.035", source: "rule of thumb (3.5%)", lastReviewedAt: BASELINE },
    // The coarse spend assumption — the source of truth for FIRE /
    // runway; the monthly_spend rows below are optional calibration only.
    { id: "assum_spend", key: "monthlySpend", value: "3200", source: "user (coarse annual figure)", lastReviewedAt: BASELINE },
    { id: "assum_spend_cons", key: "monthlySpendConservative", value: "3600", source: "user (coarse annual figure)", lastReviewedAt: BASELINE },
    { id: "assum_spend_opt", key: "monthlySpendOptimistic", value: "2800", source: "user (coarse annual figure)", lastReviewedAt: BASELINE },
    // fire.v2 contract: expectedReturn is the NOMINAL long-run return;
    // longRunInflation is the forecast it pairs with. The `inflation` row is
    // the ECB-fed OBSERVATION, kept for calibration and never consumed.
    { id: "assum_return", key: "expectedReturn", value: "0.07", source: "long-run nominal portfolio estimate", lastReviewedAt: BASELINE },
    { id: "assum_lri", key: "longRunInflation", value: "0.02", source: "user forecast", lastReviewedAt: BASELINE },
    { id: "assum_inflation", key: "inflation", value: "0.02", source: "feed:ecb", lastReviewedAt: BASELINE },
    // Date-typed: feeds the Ask layer's profile (age), never the calculators.
    { id: "assum_birth", key: "birthDate", value: null, dateValue: "1988-07-14", source: "user", lastReviewedAt: BASELINE },
  ],

  // A few post-baseline ledger rows so recompute is demonstrable.
  movements: [
    { id: "mov_dep_bank", type: "deposit", accountId: "acc_bank", holdingId: null, quantity: null, amount: "5000", currency: "EUR", occurredAt: "2026-02-15", note: "Savings", correctsId: null },
    { id: "mov_buy_vwce", type: "buy", accountId: "acc_broker", holdingId: "hold_vwce", quantity: "10", amount: "1254", currency: "EUR", occurredAt: "2026-03-10", note: "Monthly DCA", correctsId: null },
    { id: "mov_exp_bank", type: "expense", accountId: "acc_bank", holdingId: null, quantity: null, amount: "1200", currency: "EUR", occurredAt: "2026-04-05", note: "Big one-off", correctsId: null },
    // A two-leg own-account transfer: net worth must not move.
    { id: "mov_tr_out", type: "withdraw", accountId: "acc_bank", holdingId: null, quantity: null, amount: "2000", currency: "EUR", occurredAt: "2026-05-20", note: "Top up broker", correctsId: null, transferGroupId: "tg_2026_05_20" },
    { id: "mov_tr_in", type: "transfer", accountId: "acc_broker", holdingId: null, quantity: null, amount: "2000", currency: "EUR", occurredAt: "2026-05-20", note: "Top up broker", correctsId: null, transferGroupId: "tg_2026_05_20" },
  ],

  // A dated pension statement: the pension re-anchors to it — the
  // opening 85000 @ 2026-03-31 is superseded by 86400 @ 2026-05-31.
  revaluations: [
    { id: "reval_pension_q2", assetType: "account", assetId: "acc_pension", value: "86400", valuedAt: "2026-05-31", note: "Q2 statement", createdAt: "2026-06-01T09:00:00.000Z" },
  ],

  monthlySpend: [
    { id: "spend_2026_04", month: "2026-04", amount: "3200", note: null, createdAt: "2026-05-02T09:00:00.000Z" },
    { id: "spend_2026_05", month: "2026-05", amount: "3100", note: null, createdAt: "2026-06-02T09:00:00.000Z" },
  ],

  prices: [
    { id: "price_vwce", isin: "IE00BK5BQT80", price: "125.40", currency: "EUR", asOf: "2026-06-01" },
    { id: "price_smh", isin: "US92189F7915", price: "270.00", currency: "USD", asOf: "2026-06-01" },
    { id: "price_aggh", isin: "IE00BDBRDM35", price: "4.80", currency: "EUR", asOf: "2026-06-01" },
  ],

  fx: [{ id: "fx_usd", base: "EUR", quote: "USD", rate: "0.92", asOf: "2026-06-01" }],
};
