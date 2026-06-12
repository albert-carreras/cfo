import type { Money } from "../money";

// Spanish IRPF tax tables for a Cataluña resident, tax year 2026. Versioned
// config-as-code (like thresholds.ts / cadence.ts) so the calculators stay pure
// and the `version` string travels with every figure (principle #10). When the
// 2027 tables land, add a sibling `taxES.es-cat.2027.ts` and bump the version —
// never edit these numbers in place.
//
// Sources (researched June 2026):
//   - Savings base scale (escala del ahorro), state-only: 19/21/23/27/30%, the
//     top band raised to 30% from 2025. Identical in every CCAA — Cataluña does
//     not modify it.
//   - State half-scale (gravamen estatal, Ley 35/2006 art. 63.1).
//   - Cataluña autonomic scale per Decret-llei 5/2025 (in force 2026): the first
//     bracket was lowered to 9.5% and the scale recut to 8 brackets.
//   General IRPF for a Cataluña resident = stateScale(base) + catalunaScale(base),
//   both progressive scales applied to the same general base.

// A progressive bracket: `[from, to)` in EUR with a marginal `rate` (decimal
// string). `to: null` is the open-ended top band.
export type TaxBracket = { from: number; to: number | null; rate: Money };
export type TaxScale = TaxBracket[];

// Savings base — capital gains + dividends + interest. State-only.
const SAVINGS: TaxScale = [
  { from: 0, to: 6_000, rate: "0.19" },
  { from: 6_000, to: 50_000, rate: "0.21" },
  { from: 50_000, to: 200_000, rate: "0.23" },
  { from: 200_000, to: 300_000, rate: "0.27" },
  { from: 300_000, to: null, rate: "0.30" },
];

// General base, state half-scale (gravamen estatal).
const GENERAL_STATE: TaxScale = [
  { from: 0, to: 12_450, rate: "0.095" },
  { from: 12_450, to: 20_200, rate: "0.12" },
  { from: 20_200, to: 35_200, rate: "0.15" },
  { from: 35_200, to: 60_000, rate: "0.185" },
  { from: 60_000, to: 300_000, rate: "0.225" },
  { from: 300_000, to: null, rate: "0.245" },
];

// General base, Cataluña autonomic scale (Decret-llei 5/2025).
const GENERAL_AUTONOMIC_CAT: TaxScale = [
  { from: 0, to: 12_500, rate: "0.095" },
  { from: 12_500, to: 22_000, rate: "0.125" },
  { from: 22_000, to: 33_000, rate: "0.16" },
  { from: 33_000, to: 53_000, rate: "0.19" },
  { from: 53_000, to: 90_000, rate: "0.215" },
  { from: 90_000, to: 120_000, rate: "0.235" },
  { from: 120_000, to: 175_000, rate: "0.245" },
  { from: 175_000, to: null, rate: "0.255" },
];

export type TaxConfig = {
  version: string;
  source: string;
  year: number;
  savings: TaxScale;
  generalState: TaxScale;
  generalAutonomic: TaxScale;
  // Reducción por arrendamiento de vivienda. Applied to positive net rental of a
  // long-term residential let. Rough model — the post-2024 reform tiers this
  // (50/60/70/90%). Without contract metadata, this model uses the conservative
  // 50% tier; exceptional and transitional cases remain out of scope.
  rentalReductionRate: Money;
  // Norma antiaplicación (art. 33.5 LIRPF): a loss on homogeneous securities is
  // deferred when they are repurchased within this many months before or after
  // the sale (2 for listed securities).
  washSaleWindowMonths: number;
  // Mínimo personal (art. 57 LIRPF + the Cataluña autonomic minimum). Applied
  // as a credit at the bottom of the scales: quota = scale(base) −
  // scale(minimum). Family minimums (descendants/ascendants/disability) are
  // not derivable from the ledger — they enter via the optional
  // `familyMinimum` assumption, added to both sides.
  personalMinimum: {
    stateEUR: Money;
    autonomicEUR: Money;
    // Cataluña raises the autonomic minimum for low total bases.
    autonomicLowIncome: { thresholdEUR: Money; minimumEUR: Money };
  };
  // What the income-tax model deliberately leaves out — printed on the tax
  // card together with the wealth-tax exclusions (principle #10: show the
  // source, not a disclaimer). Versioned with the tables it describes.
  exclusions: string[];
};

// 2026.2: the tables are unchanged from 2026.1 — the bump covers
// the model around them: the 4-year loss carry-forward now reduces the
// savings base, the card's exclusions are config-driven, and wealth tax is
// folded into the same estimate (see taxIP.es-cat.2026.ts).
// 2026.3 (backlog, 2026-06-11): tables still unchanged — the bump adds the
// 2-month wash-sale deferral (homogeneous = same holding) and the personal/
// family minimums (state 5,550 €; Cataluña 6,105 € when the total base stays
// under 12,450 €; family minimums via the `familyMinimum` assumption).
// 2026.4 (2026-06-12): tables unchanged — FIFO matching now skips lots bought
// after the disposal date (a sell can never consume a future purchase; the
// wash-sale window still sees future repurchases, as art. 33.5 intends).
// 2026.5 (2026-06-12): tables unchanged — realised pension withdrawals (the
// withdraw legs on pension accounts in the tax year) now feed the general
// base; realisation writes them as atomic two-leg transfers.
export const TAX_ES_CAT_2026: TaxConfig = {
  version: "taxES.es-cat.2026.5",
  source: "taxES.v1",
  year: 2026,
  savings: SAVINGS,
  generalState: GENERAL_STATE,
  generalAutonomic: GENERAL_AUTONOMIC_CAT,
  rentalReductionRate: "0.50",
  washSaleWindowMonths: 2,
  personalMinimum: {
    stateEUR: "5550",
    autonomicEUR: "5550",
    autonomicLowIncome: { thresholdEUR: "12450", minimumEUR: "6105" },
  },
  exclusions: [
    "dividends & interest enter the savings base as the net cash logged — withholding already paid is not reconstructed",
    "a loss carry-forward offsets the whole savings base (the 25% dividend/interest offset cap is not modelled)",
    "wash-sale homogeneity is matched per holding only; detailed plusvalía municipal stays out of scope",
    "family minimums enter via the familyMinimum assumption — descendants/ascendants are not derived; the autonomic minimum never credits the savings base",
    "mortgage interest & depreciation on rentals; the pre-2007 pension lump-sum reduction",
    "every withdraw leg on a pension account counts as a rescate — a pension-to-pension plan transfer is not distinguished, and contributions are not deducted",
  ],
};
