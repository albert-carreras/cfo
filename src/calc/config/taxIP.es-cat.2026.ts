import type { Money } from "../money";
import type { TaxScale } from "./taxES.es-cat.2026";

// Spanish wealth tax (Impuesto sobre el Patrimonio, IP) for a Cataluña
// resident, tax year 2026. Versioned config-as-code like the IRPF tables —
// when the law changes, add a sibling file and bump the version, never edit
// these numbers in place.
//
// Sources (researched June 2026):
//   - Cataluña autonomic IP scale per Decreto Legislativo 1/2024 (12 March
//     2024), first transitional provision, extended by Decret-llei 10/2024
//     while the ITSGF remains in force: nine brackets, 0.21% → 3.48% above
//     €20M. The bracket cuotas below reproduce the published table to the
//     cent (e.g. €350.97 at €167,129.45; €448,713.93 at €20M).
//   - Mínimo exento in Cataluña: €500,000 (the roadmap's reason this phase
//     exists — IP is likely a currently accruing liability, not an edge case).
//   - Vivienda habitual exemption: up to €300,000 of the taxpayer's share of
//     the primary residence (state rule, Ley 19/1991 art. 4.Nueve).
//   - Límite conjunto (Ley 19/1991 art. 31): IRPF quota + IP quota may not
//     exceed 60% of the IRPF taxable bases; the IP reduction is capped at 80%
//     of the IP quota (so at least 20% is always due).

const IP_CAT: TaxScale = [
  { from: 0, to: 167_129.45, rate: "0.0021" },
  { from: 167_129.45, to: 334_252.88, rate: "0.00315" },
  { from: 334_252.88, to: 668_499.75, rate: "0.00525" },
  { from: 668_499.75, to: 1_336_999.51, rate: "0.00945" },
  { from: 1_336_999.51, to: 2_673_999.01, rate: "0.01365" },
  { from: 2_673_999.01, to: 5_347_998.03, rate: "0.01785" },
  { from: 5_347_998.03, to: 10_695_996.06, rate: "0.02205" },
  { from: 10_695_996.06, to: 20_000_000, rate: "0.0275" },
  { from: 20_000_000, to: null, rate: "0.0348" },
];

export type WealthTaxConfig = {
  version: string;
  year: number;
  scale: TaxScale;
  exemptMinimumEUR: Money;
  primaryResidenceExemptionMaxEUR: Money;
  // Límite conjunto IRPF+IP: quotas capped at `limitRate` of the IRPF bases;
  // the IP quota can be reduced by at most `maxReductionRate` of itself.
  limitRate: Money;
  maxReductionRate: Money;
  // What this model deliberately leaves out — printed on the tax card
  // (principle #10: show the source, not a disclaimer). Kept in config so the
  // list is versioned with the tables it describes.
  exclusions: string[];
};

export const TAX_IP_CAT_2026: WealthTaxConfig = {
  version: "taxIP.es-cat.2026.1",
  year: 2026,
  scale: IP_CAT,
  exemptMinimumEUR: "500000",
  primaryResidenceExemptionMaxEUR: "300000",
  limitRate: "0.60",
  maxReductionRate: "0.80",
  exclusions: [
    "ISGF (solidarity tax) not computed — only bites above €3M net and paid IP is deductible against it",
    "IP valued at today's snapshot (purchase price for property, latest market price for positions) — not the legal max-of-three / 31-Dec basis",
    "the IRPF–IP cap is simplified: the >1-year-gains carve-out is not modelled",
    "business-asset and other special IP exemptions beyond pension plans and €300k of the primary residence",
  ],
};
