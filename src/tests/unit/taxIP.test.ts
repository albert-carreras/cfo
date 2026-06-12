import { describe, expect, it } from "vitest";
import { progressiveTax, taxES, wealthTaxES } from "@/calc/taxES";
import { TAX_ES_CAT_2026 } from "@/calc/config/taxES.es-cat.2026";
import { TAX_IP_CAT_2026 } from "@/calc/config/taxIP.es-cat.2026";

const ip = TAX_IP_CAT_2026;

describe("Cataluña IP scale (progressiveTax over the wealth brackets)", () => {
  // Anchors reproduce the published cuota íntegra table to the cent.
  it("matches the published cuota at the first bracket top (€167,129.45 → €350.97)", () => {
    expect(progressiveTax("167129.45", ip.scale).toFixed(2)).toBe("350.97");
  });

  it("matches the published cuota at the third bracket top (€668,499.75 → €2,632.21)", () => {
    expect(progressiveTax("668499.75", ip.scale).toFixed(2)).toBe("2632.21");
  });

  it("computes a mid-bracket base marginally (€1M → €5,764.88)", () => {
    expect(progressiveTax("1000000", ip.scale).toFixed(2)).toBe("5764.88");
  });
});

describe("wealthTaxES (exemptions + límite conjunto)", () => {
  it("yields €0 below the mínimo exento after the pension & vivienda exemptions", () => {
    const w = wealthTaxES({
      config: ip,
      netWorthTotalEUR: "700000",
      pensionEUR: "100000",
      primaryResidenceValueEUR: "250000",
      irpfBasesEUR: "30000",
      irpfQuotaEUR: "5000",
    });
    expect(w.netBaseEUR).toBe("350000.00");
    expect(w.taxableEUR).toBe("0.00");
    expect(w.quotaEUR).toBe("0.00");
  });

  it("caps the vivienda exemption at €300k and applies the €500k mínimo", () => {
    const w = wealthTaxES({
      config: ip,
      netWorthTotalEUR: "1500000",
      pensionEUR: "100000",
      primaryResidenceValueEUR: "400000", // exempt only up to 300k
      irpfBasesEUR: "100000",
      irpfQuotaEUR: "20000", // cap (60k) not binding: 20k + 2.3k < 60k
    });
    expect(w.exemptions.primaryResidenceEUR).toBe("300000.00");
    expect(w.netBaseEUR).toBe("1100000.00");
    expect(w.taxableEUR).toBe("600000.00");
    expect(w.grossQuotaEUR).toBe("2272.58");
    expect(w.limitReductionEUR).toBe("0.00");
    expect(w.quotaEUR).toBe("2272.58");
  });

  it("the IRPF–IP cap reduces the quota when income is low", () => {
    const w = wealthTaxES({
      config: ip,
      netWorthTotalEUR: "1500000",
      pensionEUR: "0",
      primaryResidenceValueEUR: "0",
      irpfBasesEUR: "5000", // cap = 3,000
      irpfQuotaEUR: "950",
    });
    expect(w.grossQuotaEUR).toBe("5764.88");
    expect(w.limitReductionEUR).toBe("3714.88");
    expect(w.quotaEUR).toBe("2050.00");
  });

  it("at least 20% of the quota is always due (the 80% reduction floor)", () => {
    const w = wealthTaxES({
      config: ip,
      netWorthTotalEUR: "1500000",
      pensionEUR: "0",
      primaryResidenceValueEUR: "0",
      irpfBasesEUR: "0", // a no-income year — the cap alone would zero the IP
      irpfQuotaEUR: "0",
    });
    expect(w.grossQuotaEUR).toBe("5764.88");
    expect(w.quotaEUR).toBe("1152.98"); // 20% of the gross quota
  });
});

describe("taxES with wealth folded in", () => {
  it("totalTaxEUR = income tax + IP quota, with both exclusion lists printed", () => {
    const r = taxES({
      snapshotId: "s",
      config: TAX_ES_CAT_2026,
      realizedCapitalGainsEUR: "10000", // income tax 1,980
      wealth: {
        config: ip,
        netWorthTotalEUR: "1600000",
        pensionEUR: "100000",
        primaryResidenceValueEUR: "0",
      },
      inputs: ["nw_total"],
    });
    // savings 1,980 minus the unabsorbed state minimum's credit
    // (5,550 × 19% = 1,054.50) — no general income to absorb it.
    expect(r.value.incomeTaxEUR).toBe("925.50");
    expect(r.value.wealth?.version).toBe("taxIP.es-cat.2026.1");
    // taxable 1M → gross 5,764.88; bases 10,000 → cap 6,000; excess
    // 925.50 + 5,764.88 − 6,000 = 690.38 shaved off.
    expect(r.value.wealth?.grossQuotaEUR).toBe("5764.88");
    expect(r.value.wealth?.limitReductionEUR).toBe("690.38");
    expect(r.value.wealth?.quotaEUR).toBe("5074.50");
    expect(r.value.totalTaxEUR).toBe("6000.00"); // exactly the 60% cap
    expect(r.value.exclusions).toEqual([
      ...TAX_ES_CAT_2026.exclusions,
      ...ip.exclusions,
    ]);
  });
});
