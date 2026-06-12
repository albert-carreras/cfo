import { dec } from "@/calc/money";

// FX provider: the ECB daily reference rates (eurofxref-daily.xml). Official,
// free, no key — one fetch covers every currency we hold. The parser is a pure
// function so the feed's correctness is Vitest-tested without network.

export const ECB_DAILY_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export type EcbDaily = {
  asOf: string; // YYYY-MM-DD (ECB business day)
  // ECB publishes QUOTE PER EUR (e.g. USD 1.08). Kept as published here; the
  // inversion to our schema's EUR-per-unit happens in eurPerUnit().
  quotePerEur: Record<string, string>;
};

// The XML is flat and stable: <Cube time="..."> wrapping <Cube currency="USD"
// rate="1.0852"/> rows — a regex pass is robust enough and keeps us dependency-free.
export function parseEcbDailyXml(xml: string): EcbDaily {
  const time = xml.match(/<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']/);
  if (!time) throw new Error("ECB XML: no <Cube time=...> found");

  const quotePerEur: Record<string, string> = {};
  const row = /<Cube\s+currency=["']([A-Z]{3})["']\s+rate=["']([\d.]+)["']/g;
  for (const m of xml.matchAll(row)) {
    quotePerEur[m[1]] = m[2];
  }
  if (Object.keys(quotePerEur).length === 0) {
    throw new Error("ECB XML: no currency rows found");
  }
  return { asOf: time[1], quotePerEur };
}

// Our fx_rates semantic: rate = EUR per 1 unit of quote (amount × rate = EUR).
// ECB publishes the inverse, so a USD 1.0852 row becomes 1/1.0852 ≈ 0.92148...
export function eurPerUnit(daily: EcbDaily, quote: string): string | null {
  const r = daily.quotePerEur[quote];
  if (!r || dec(r).isZero()) return null;
  return dec(1).dividedBy(dec(r)).toFixed(8);
}

export async function fetchEcbDaily(): Promise<EcbDaily> {
  const res = await fetch(ECB_DAILY_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`ECB fetch failed: HTTP ${res.status}`);
  return parseEcbDailyXml(await res.text());
}
